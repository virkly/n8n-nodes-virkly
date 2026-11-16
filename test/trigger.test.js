// Virkly Trigger against a fake /v1/changes feed (npm run build first). No network.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { VirklyTrigger } = require('../dist/nodes/VirklyTrigger/VirklyTrigger.node.js');
const {
	BANKRUPT_STATUS,
	MAX_PAGES,
	MIN_POLL_INTERVAL_MS,
	WINDOW_MS,
	changesRequest,
	latestChange,
	parseCvrList,
	pollChanges,
} = require('../dist/nodes/VirklyTrigger/changes.js');
const { USER_AGENT } = require('../dist/nodes/Virkly/transport.js');

const HOUR = 60 * 60 * 1000;
const T0 = new Date('2026-11-16T06:00:00Z');
const at = (ms) => new Date(T0.getTime() + ms);

/**
 * A fake feed with the server's contract: rows ordered by recordedAt, `since` inclusive, cursor =
 * index of the last row read, `type` filter, `limit` per page. Rows are added with `record`.
 */
function fakeFeed({ pageSize } = {}) {
	const rows = [];
	const calls = [];
	let seq = 0;
	const fetch = async (qs) => {
		calls.push(qs);
		const types = qs.type.split(',');
		const limit = pageSize ?? qs.limit;
		const start = qs.cursor
			? Number(qs.cursor) + 1
			: rows.findIndex((r) => r.recordedAt >= qs.since) === -1
				? rows.length
				: rows.findIndex((r) => r.recordedAt >= qs.since);
		const read = rows.slice(start, start + limit);
		const last = read.length ? start + read.length - 1 : qs.cursor ? Number(qs.cursor) : null;
		return {
			statusCode: 200,
			body: {
				changes: read.filter((r) => types.includes(r.type)),
				nextCursor: last === null ? null : String(last),
				hasMore: start + limit < rows.length,
			},
		};
	};
	const record = (when, change) => {
		seq++;
		rows.push({
			cvr: '24256790',
			name: `Company ${seq}`,
			type: 'name',
			oldValue: 'Old',
			newValue: `New ${seq}`,
			description: null,
			changedAt: when.toISOString(),
			recordedAt: when.toISOString(),
			...change,
		});
	};
	return { fetch, record, calls, rows };
}

const all = { types: ['status', 'name'], cvrs: null, bankruptOnly: false };

test('the first poll stores "now" and emits nothing from before activation, without an API call', async () => {
	const feed = fakeFeed();
	feed.record(at(-HOUR), { name: 'Before activation' });
	const state = {};
	assert.deepEqual(await pollChanges(state, feed.fetch, all, T0), []);
	assert.equal(feed.calls.length, 0);
	assert.equal(state.since, T0.toISOString());

	feed.record(at(30 * 60 * 1000), { name: 'After activation' });
	const items = await pollChanges(state, feed.fetch, all, at(HOUR));
	assert.deepEqual(
		items.map((c) => c.name),
		['After activation'],
	);
});

test('two polls emit each change exactly once, with the feed fields unchanged', async () => {
	const feed = fakeFeed();
	const state = {};
	await pollChanges(state, feed.fetch, all, T0);
	feed.record(at(10 * 60 * 1000));
	feed.record(at(20 * 60 * 1000), { type: 'status', oldValue: 'NORMAL', newValue: 'OPLØST' });
	const first = await pollChanges(state, feed.fetch, all, at(HOUR));
	feed.record(at(HOUR + 10 * 60 * 1000));
	const second = await pollChanges(state, feed.fetch, all, at(2 * HOUR));
	const third = await pollChanges(state, feed.fetch, all, at(3 * HOUR));

	assert.deepEqual(first, feed.rows.slice(0, 2));
	assert.deepEqual(second, feed.rows.slice(2));
	assert.deepEqual(third, []);
	assert.equal(
		state.since,
		undefined,
		'the cursor replaces the start time once the feed returns one',
	);
	assert.deepEqual(feed.calls.at(-1), { type: 'status,name', limit: 500, cursor: '2' });
});

test('a poll sooner than the minimum interval makes no API call', async () => {
	const feed = fakeFeed();
	const state = {};
	await pollChanges(state, feed.fetch, all, T0);
	feed.record(at(60 * 1000));
	assert.deepEqual(await pollChanges(state, feed.fetch, all, at(MIN_POLL_INTERVAL_MS - 1)), []);
	assert.equal(feed.calls.length, 0);
	assert.equal((await pollChanges(state, feed.fetch, all, at(MIN_POLL_INTERVAL_MS))).length, 1);
});

test('the CVR filter keeps only the listed companies', async () => {
	const feed = fakeFeed();
	const state = {};
	const filter = { ...all, cvrs: parseCvrList('2425 6790\n10007127').cvrs };
	await pollChanges(state, feed.fetch, filter, T0);
	feed.record(at(60 * 1000), { cvr: '24256790' });
	feed.record(at(2 * 60 * 1000), { cvr: '99999999' });
	feed.record(at(3 * 60 * 1000), { cvr: '10007127' });
	const items = await pollChanges(state, feed.fetch, filter, at(HOUR));
	assert.deepEqual(
		items.map((c) => c.cvr),
		['24256790', '10007127'],
	);
});

test('the bankrupt preset asks for status changes and keeps only UNDER KONKURS', async () => {
	const feed = fakeFeed();
	const state = {};
	const filter = { types: ['status'], cvrs: null, bankruptOnly: true };
	await pollChanges(state, feed.fetch, filter, T0);
	feed.record(at(60 * 1000), { type: 'status', oldValue: 'NORMAL', newValue: BANKRUPT_STATUS });
	feed.record(at(2 * 60 * 1000), { type: 'status', oldValue: 'NORMAL', newValue: 'OPLØST' });
	feed.record(at(3 * 60 * 1000), { type: 'name' });
	const items = await pollChanges(state, feed.fetch, filter, at(HOUR));
	assert.equal(BANKRUPT_STATUS, 'UNDER KONKURS');
	assert.deepEqual(items, [feed.rows[0]]);
	assert.equal(feed.calls[0].type, 'status');
});

test('the page cap carries over: the next poll continues where the last one stopped', async () => {
	const feed = fakeFeed({ pageSize: 1 });
	const state = {};
	await pollChanges(state, feed.fetch, all, T0);
	for (let i = 0; i < MAX_PAGES + 5; i++) feed.record(at((i + 1) * 1000));
	const first = await pollChanges(state, feed.fetch, all, at(HOUR));
	assert.equal(feed.calls.length, MAX_PAGES, 'stops at the cap…');
	const second = await pollChanges(state, feed.fetch, all, at(2 * HOUR));
	assert.equal(first.length, MAX_PAGES);
	assert.deepEqual(
		[...first, ...second],
		feed.rows,
		'…and the next poll emits the rest, each once',
	);
});

test('an error on a later page emits what was read, then retries from there', async () => {
	const feed = fakeFeed({ pageSize: 1 });
	const state = {};
	await pollChanges(state, feed.fetch, all, T0);
	for (let i = 0; i < 3; i++) feed.record(at((i + 1) * 1000));
	let fail = true;
	const flaky = async (qs) =>
		qs.cursor === '0' && fail
			? { statusCode: 500, body: { error: { message: 'boom' } } }
			: feed.fetch(qs);
	const first = await pollChanges(state, flaky, all, at(HOUR));
	fail = false;
	const second = await pollChanges(state, flaky, all, at(2 * HOUR));
	assert.deepEqual([...first, ...second], feed.rows);
});

test('a failing first page throws an error the user can act on', async () => {
	const state = { cursor: '3' };
	const quota = async () => ({
		statusCode: 429,
		body: { error: { code: 'QUOTA_EXCEEDED', message: 'Monthly quota reached.' } },
	});
	await assert.rejects(pollChanges(state, quota, all, T0), /virkly\.io\/pricing/);
	assert.equal(state.cursor, '3', 'the position is kept');
});

test('a cursor older than the plan window restarts at the oldest readable point', async () => {
	const feed = fakeFeed();
	const state = { cursor: 'old', lastPollAt: at(-10 * 24 * HOUR).toISOString() };
	const windowed = async (qs) =>
		qs.cursor === 'old'
			? { statusCode: 403, body: { error: { code: 'CHANGES_WINDOW', message: '7 days' } } }
			: feed.fetch(qs);
	feed.record(at(-HOUR));
	const items = await pollChanges(state, windowed, all, T0);
	assert.equal(feed.calls[0].since, new Date(T0.getTime() - WINDOW_MS).toISOString());
	assert.equal(items.length, 1);
});

test('a stored start older than the plan window restarts too, and a second refusal is an error', async () => {
	const feed = fakeFeed();
	const state = {
		since: at(-10 * 24 * HOUR).toISOString(),
		lastPollAt: at(-2 * HOUR).toISOString(),
	};
	const refuseOld = async (qs) =>
		qs.since < new Date(T0.getTime() - WINDOW_MS - 1000).toISOString()
			? { statusCode: 403, body: { error: { code: 'CHANGES_WINDOW', message: '7 days' } } }
			: feed.fetch(qs);
	assert.deepEqual(await pollChanges(state, refuseOld, all, T0), []);
	assert.equal(state.since, new Date(T0.getTime() - WINDOW_MS).toISOString());
	const always = async () => ({
		statusCode: 403,
		body: { error: { code: 'CHANGES_WINDOW', message: '7 days' } },
	});
	await assert.rejects(pollChanges({ cursor: 'x' }, always, all, T0), /7 days/);
});

test('a 404 from the feed is an error, not an empty page', async () => {
	const missing = async () => ({ statusCode: 404, body: {} });
	await assert.rejects(latestChange(missing, all, T0), /no change feed/);
});

test('latestChange returns the newest matching change, or null', async () => {
	const feed = fakeFeed({ pageSize: 2 });
	feed.record(at(-3 * HOUR), { type: 'status', newValue: BANKRUPT_STATUS, cvr: '11111111' });
	feed.record(at(-2 * HOUR), { type: 'status', newValue: BANKRUPT_STATUS, cvr: '22222222' });
	feed.record(at(-HOUR), { type: 'status', newValue: 'OPLØST' });
	const bankrupt = { types: ['status'], cvrs: null, bankruptOnly: true };
	assert.equal((await latestChange(feed.fetch, bankrupt, T0)).cvr, '22222222');
	assert.equal(feed.calls[0].since, new Date(T0.getTime() - WINDOW_MS).toISOString());
	const none = { ...bankrupt, cvrs: parseCvrList('33333333').cvrs };
	assert.equal(await latestChange(feed.fetch, none, T0), null);
});

test('parseCvrList accepts commas, semicolons and new lines and reports bad entries', () => {
	const { cvrs, invalid } = parseCvrList(' 2425 6790, 10007127;\n\nfoo ');
	assert.deepEqual([...cvrs], ['24256790', '10007127']);
	assert.deepEqual(invalid, ['foo']);
	assert.equal(parseCvrList('  ').cvrs, null);
});

test('the feed request carries the package User-Agent and the query', () => {
	const req = changesRequest({ type: 'status', limit: 500, since: T0.toISOString() });
	assert.equal(req.url, 'https://virkly.io/v1/changes');
	assert.equal(req.headers['User-Agent'], USER_AGENT);
	assert.deepEqual(req.qs, { type: 'status', limit: 500, since: T0.toISOString() });
	assert.equal(req.ignoreHttpStatusErrors, true);
});

/** IPollFunctions with parameters, a mode, static data and a canned feed. */
function pollContext(params, mode, respond) {
	const staticData = {};
	return {
		staticData,
		getNodeParameter: (name, fallback) => (name in params ? params[name] : fallback),
		getMode: () => mode,
		getNode: () => ({
			name: 'Virkly Trigger',
			type: 'n8n-nodes-virkly.virklyTrigger',
			typeVersion: 1,
			parameters: {},
		}),
		getWorkflowStaticData: () => staticData,
		helpers: {
			httpRequestWithAuthentication: async (_cred, options) => respond(options),
			returnJsonArray: (items) => items.map((json) => ({ json })),
		},
	};
}

test('the node: manual "fetch test event" returns the latest change and leaves state alone', async () => {
	const feed = fakeFeed();
	feed.record(new Date(Date.now() - HOUR), { type: 'status', newValue: BANKRUPT_STATUS });
	const ctx = pollContext({ event: 'companyBankrupt', cvrs: '' }, 'manual', (o) =>
		feed.fetch(o.qs),
	);
	const out = await new VirklyTrigger().poll.call(ctx);
	assert.deepEqual(out, [[{ json: feed.rows[0] }]]);
	assert.deepEqual(ctx.staticData, {});
});

test('the node: manual run with nothing to show says so', async () => {
	const feed = fakeFeed();
	const ctx = pollContext(
		{ event: 'companyChanged', changeTypes: ['name'], cvrs: '' },
		'manual',
		(o) => feed.fetch(o.qs),
	);
	await assert.rejects(new VirklyTrigger().poll.call(ctx), /No matching changes/);
});

test('the node: first activation returns null and stores the start in static data', async () => {
	const ctx = pollContext(
		{ event: 'companyChanged', changeTypes: ['status'], cvrs: '' },
		'trigger',
		() => assert.fail('no request on the first poll'),
	);
	assert.equal(await new VirklyTrigger().poll.call(ctx), null);
	assert.ok(ctx.staticData.since);
});

test('the node: bad CVRs, no change types and API errors become n8n errors', async () => {
	const node = new VirklyTrigger();
	const ok = () => ({ statusCode: 200, body: { changes: [], nextCursor: null, hasMore: false } });
	await assert.rejects(
		node.poll.call(
			pollContext({ event: 'companyChanged', changeTypes: ['name'], cvrs: '123' }, 'trigger', ok),
		),
		/Not CVR numbers: 123/,
	);
	await assert.rejects(
		node.poll.call(
			pollContext({ event: 'companyChanged', changeTypes: [], cvrs: '' }, 'trigger', ok),
		),
		/at least one change type/,
	);
	const unauthorized = () => ({ statusCode: 401, body: { error: { message: 'Invalid API key' } } });
	await assert.rejects(
		node.poll.call(pollContext({ event: 'companyBankrupt', cvrs: '' }, 'manual', unauthorized)),
		(err) => err.constructor.name === 'NodeApiError' && /rejected the API key/.test(err.message),
	);
	const offline = () => {
		throw new Error('getaddrinfo ENOTFOUND virkly.io');
	};
	await assert.rejects(
		node.poll.call(pollContext({ event: 'companyBankrupt', cvrs: '' }, 'manual', offline)),
		(err) =>
			err.constructor.name === 'NodeApiError' &&
			/connection cannot be established/.test(err.message),
	);
});
