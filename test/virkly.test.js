// Unit tests against the built package (npm run build first): request building and response
// mapping from recorded fixtures. No live calls.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { version } = require('../package.json');
const { Virkly } = require('../dist/nodes/Virkly/Virkly.node.js');
const { VirklyApi } = require('../dist/credentials/VirklyApi.credentials.js');
const {
	collect,
	companyGetRequest,
	errorMessage,
	normalizeCvr,
	toDate,
	USER_AGENT,
} = require('../dist/nodes/Virkly/transport.js');

const fixture = (name) => require(`./fixtures/${name}.json`);

/**
 * A minimal IExecuteFunctions: one item per parameter set (a string is a Company → Get CVR),
 * a canned HTTP response per call.
 */
function context(inputs, respond, { continueOnFail = false } = {}) {
	const calls = [];
	const params = inputs.map((p) =>
		typeof p === 'string' ? { resource: 'company', operation: 'get', cvr: p } : p,
	);
	return {
		calls,
		getInputData: () => params.map(() => ({ json: {} })),
		getNodeParameter: (name, i, fallback) => params[i][name] ?? fallback,
		getNode: () => ({
			name: 'Virkly',
			type: 'n8n-nodes-virkly.virkly',
			typeVersion: 1,
			parameters: {},
		}),
		continueOnFail: () => continueOnFail,
		helpers: {
			httpRequestWithAuthentication: async (credential, options) => {
				calls.push({ credential, options });
				return respond(options, calls.length);
			},
		},
	};
}

const run = (ctx) => new Virkly().execute.call(ctx);

test('normalizeCvr strips spaces and dashes and rejects anything but 8 digits', () => {
	assert.equal(normalizeCvr('24256790'), '24256790');
	assert.equal(normalizeCvr(' 2425 67-90 '), '24256790');
	assert.equal(normalizeCvr(24256790), '24256790');
	assert.equal(normalizeCvr('2425679'), null);
	assert.equal(normalizeCvr('DK24256790'), null);
	assert.equal(normalizeCvr(''), null);
	assert.equal(normalizeCvr(undefined), null);
});

test('Company → Get requests /v1/companies/{cvr} with the package User-Agent', () => {
	assert.equal(USER_AGENT, `n8n-nodes-virkly/${version}`);
	const req = companyGetRequest('24256790');
	assert.equal(req.method, 'GET');
	assert.equal(req.url, 'https://virkly.io/v1/companies/24256790');
	assert.equal(req.headers['User-Agent'], USER_AGENT);
	assert.equal(req.returnFullResponse, true);
	assert.equal(req.ignoreHttpStatusErrors, true);
});

test('the credential sends a Bearer key and tests it against a cheap call with the User-Agent', () => {
	const cred = new VirklyApi();
	assert.equal(cred.name, 'virklyApi');
	assert.equal(cred.properties[0].typeOptions.password, true);
	assert.equal(
		cred.authenticate.properties.headers.Authorization,
		'=Bearer {{$credentials.apiKey}}',
	);
	assert.equal(cred.test.request.url, '/v1/companies/24256790');
	assert.equal(cred.test.request.headers['User-Agent'], USER_AGENT);
	assert.deepEqual(
		cred.test.rules.map((r) => r.properties.value),
		[401, 429],
	);
	assert.match(cred.test.rules[1].properties.message, /https:\/\/virkly\.io\/pricing/);
});

test('a found company is returned as the item JSON, with the CVR normalised in the URL', async () => {
	const ctx = context(['2425 6790'], () => ({
		statusCode: 200,
		body: fixture('company-24256790'),
	}));
	const [[item]] = await run(ctx);
	assert.equal(item.json.name, 'NOVO NORDISK A/S');
	assert.equal(item.json.cvr, 24256790);
	assert.deepEqual(item.pairedItem, { item: 0 });
	assert.equal(ctx.calls[0].credential, 'virklyApi');
	assert.equal(ctx.calls[0].options.url, 'https://virkly.io/v1/companies/24256790');
});

test('404 → "No company with CVR …"', async () => {
	const ctx = context(['99999985'], () => ({
		statusCode: 404,
		body: fixture('company-not-found'),
	}));
	await assert.rejects(run(ctx), (e) => {
		assert.equal(e.name, 'NodeApiError');
		assert.equal(e.message, 'No company with CVR 99999985');
		assert.equal(e.httpCode, '404');
		return true;
	});
});

test('quota reached (429) tells the user how to upgrade', async () => {
	const ctx = context(['24256790'], () => ({ statusCode: 429, body: fixture('quota-exceeded') }));
	await assert.rejects(run(ctx), (e) => {
		assert.match(e.message, /used all 1,000 API calls/);
		assert.match(e.message, /https:\/\/virkly\.io\/pricing/);
		return true;
	});
	assert.match(
		errorMessage(429, {}, 'No company with CVR 24256790'),
		/per minute.*https:\/\/virkly\.io\/pricing/,
	);
});

test('an invalid key (401) says so', async () => {
	const ctx = context(['24256790'], () => ({ statusCode: 401, body: fixture('invalid-key') }));
	await assert.rejects(run(ctx), /virkly rejected the API key: API key not recognised/);
});

test('an invalid CVR fails before any request', async () => {
	const ctx = context(['1234'], () => assert.fail('no request expected'));
	await assert.rejects(run(ctx), /"1234" is not a CVR number/);
	assert.equal(ctx.calls.length, 0);
});

test('continue on fail keeps going and reports each failed item', async () => {
	const ctx = context(
		['1234', '24256790'],
		() => ({ statusCode: 200, body: fixture('company-24256790') }),
		{ continueOnFail: true },
	);
	const [items] = await run(ctx);
	assert.equal(items.length, 2);
	assert.match(items[0].json.error, /not a CVR number/);
	assert.equal(items[1].json.name, 'NOVO NORDISK A/S');
});

const page = (n, size, total) => ({
	items: Array.from({ length: Math.min(size, total - n * size) }, (_, k) => ({ n: n * size + k })),
	more: (n + 1) * size < total,
});

test('collect stops at the limit, at the last page, and on an empty page', async () => {
	let calls = 0;
	const fetch = (total, size) => async (n) => (calls++, page(n, size, total));
	assert.equal((await collect(120, fetch(500, 50))).length, 120);
	assert.equal(calls, 3);
	calls = 0;
	assert.equal((await collect(Infinity, fetch(130, 50))).length, 130);
	assert.equal(calls, 3);
	assert.deepEqual(await collect(Infinity, async () => ({ items: [], more: true })), []);
});

test('toDate takes the date part of an n8n date picker value', () => {
	assert.equal(toDate('2026-11-01T00:00:00'), '2026-11-01');
	assert.equal(toDate('2026-11-01'), '2026-11-01');
	assert.equal(toDate('01-11-2026'), null);
	assert.equal(toDate(''), null);
});

test('Company → Get Financials requests /financials (with year) and returns the figures', async () => {
	const ctx = context(
		[
			{ resource: 'company', operation: 'getFinancials', cvr: '24256790' },
			{ resource: 'company', operation: 'getFinancials', cvr: '24256790', options: { year: 2024 } },
		],
		() => ({ statusCode: 200, body: fixture('financials-24256790') }),
	);
	const [items] = await run(ctx);
	assert.equal(ctx.calls[0].options.url, 'https://virkly.io/v1/companies/24256790/financials');
	assert.equal(ctx.calls[0].options.qs, undefined);
	assert.deepEqual(ctx.calls[1].options.qs, { year: 2024 });
	assert.equal(ctx.calls[0].options.headers['User-Agent'], USER_AGENT);
	assert.equal(items.length, 2);
	assert.equal(items[0].json.companyName, 'NOVO NORDISK A/S');
	assert.equal(items[0].json.latestFinancials.year, 2025);
	assert.deepEqual(items[1].pairedItem, { item: 1 });
});

test('Company → Get Financials: unknown CVR → "No company with CVR …"', async () => {
	const ctx = context(
		[{ resource: 'company', operation: 'getFinancials', cvr: '99999985' }],
		() => ({
			statusCode: 404,
			body: fixture('company-not-found'),
		}),
	);
	await assert.rejects(run(ctx), /No company with CVR 99999985/);
});

const search = (extra) => ({
	resource: 'company',
	operation: 'search',
	q: '',
	returnAll: false,
	limit: 50,
	filters: {},
	...extra,
});

test('Company → Search by name: /v1/search?q, one item per company (no persons)', async () => {
	const ctx = context([search({ q: ' novo nordisk ', limit: 2 })], () => ({
		statusCode: 200,
		body: fixture('search-text'),
	}));
	const [items] = await run(ctx);
	assert.equal(ctx.calls.length, 1);
	assert.equal(ctx.calls[0].options.url, 'https://virkly.io/v1/search');
	assert.deepEqual(ctx.calls[0].options.qs, { q: 'novo nordisk', limit: 2, offset: 0 });
	assert.deepEqual(
		items.map((it) => it.json.cvr),
		['24256790', '13246149'],
	);
	assert.equal(items[0].json.reklamebeskyttet, false);
});

test('Company → Search segment: kommune + founding dates as the API names them', async () => {
	const ctx = context(
		[
			search({
				limit: 2,
				filters: {
					municipality: 'Aarhus',
					foundedFrom: '2026-11-01T00:00:00',
					foundedTo: '2026-11-30',
					status: 'active',
				},
			}),
		],
		() => ({ statusCode: 200, body: fixture('search-segment') }),
	);
	const [items] = await run(ctx);
	assert.deepEqual(ctx.calls[0].options.qs, {
		limit: 2,
		offset: 0,
		municipality: 'Aarhus',
		status: 'active',
		foundedFrom: '2026-11-01',
		foundedTo: '2026-11-30',
	});
	assert.equal(items.length, 2);
	assert.equal(items[0].json.founded, '2026-11-13');
});

test('Company → Search Return All pages by offset (100 per call) until hasMore is false', async () => {
	const body = fixture('search-segment');
	const ctx = context(
		[search({ returnAll: true, filters: { municipality: 'Aarhus' } })],
		(opts, n) => ({
			statusCode: 200,
			body: {
				...body,
				results: n < 3 ? Array(100).fill(body.results[0]) : body.results,
				hasMore: n < 3,
			},
		}),
	);
	const [items] = await run(ctx);
	assert.deepEqual(
		ctx.calls.map((c) => [c.options.qs.offset, c.options.qs.limit]),
		[
			[0, 100],
			[100, 100],
			[200, 100],
		],
	);
	assert.equal(items.length, 202);
});

test('Company → Search text mode pages by total (no hasMore) and never past offset 10,000', async () => {
	const body = fixture('search-text');
	const ctx = context([search({ q: 'novo', limit: 3 })], (opts) => ({
		statusCode: 200,
		body: { ...body, results: body.results.slice(0, opts.qs.offset === 0 ? 2 : 1), total: 3 },
	}));
	assert.equal((await run(ctx))[0].length, 3);
	assert.deepEqual(
		ctx.calls.map((c) => c.options.qs.offset),
		[0, 3],
	);
	const huge = context([search({ q: 'aps', returnAll: true })], () => ({
		statusCode: 200,
		body: { ...body, results: Array(100).fill(body.results[0]), total: 500000 },
	}));
	await run(huge);
	assert.equal(huge.calls.at(-1).options.qs.offset, 10000);
});

test('Company → Search refuses an empty or 1-character search before any call', async () => {
	for (const params of [
		search({}),
		search({ filters: { status: 'active' } }),
		search({ q: 'a' }),
	]) {
		const ctx = context([params], () => assert.fail('no request expected'));
		await assert.rejects(run(ctx), /query|Municipality/);
		assert.equal(ctx.calls.length, 0);
	}
	const badDate = context([search({ filters: { foundedFrom: 'yesterday' } })], () => assert.fail());
	await assert.rejects(run(badDate), /foundedFrom must be a date/);
});

test('Company → Search passes an API validation error through', async () => {
	const ctx = context([search({ q: 'novo' })], () => ({
		statusCode: 400,
		body: fixture('search-validation-error'),
	}));
	await assert.rejects(run(ctx), /Invalid request data/);
});

test('Bankruptcy → Get Many: /v1/bankruptcies, one item per company, 50-per-page paging', async () => {
	const body = fixture('bankruptcies-page-1');
	const ctx = context(
		[
			{
				resource: 'bankruptcy',
				operation: 'getAll',
				days: '30',
				returnAll: false,
				limit: 2,
				filters: {},
			},
		],
		() => ({ statusCode: 200, body }),
	);
	const [items] = await run(ctx);
	assert.equal(ctx.calls[0].options.url, 'https://virkly.io/v1/bankruptcies');
	assert.deepEqual(ctx.calls[0].options.qs, { days: '30', page: 1 });
	assert.deepEqual(
		items.map((it) => it.json.cvr),
		['16267384', '26506646'],
	);
	assert.equal(items[0].json.bankruptAt, '2026-11-11T00:00:00.000Z');

	const all = context(
		[
			{
				resource: 'bankruptcy',
				operation: 'getAll',
				days: '7',
				returnAll: true,
				filters: { industry: ' 561010 ' },
			},
		],
		(opts) => ({
			statusCode: 200,
			body: { ...body, total: 120, items: Array(opts.qs.page < 3 ? 50 : 20).fill(body.items[0]) },
		}),
	);
	assert.equal((await run(all))[0].length, 120);
	assert.deepEqual(
		all.calls.map((c) => c.options.qs),
		[1, 2, 3].map((page) => ({ days: '7', page, industry: '561010' })),
	);
});

test('Person → Get: /v1/persons/{enhedsNummer}, 404 → "No person with …", bad input → no call', async () => {
	const ok = context(
		[{ resource: 'person', operation: 'get', enhedsNummer: ' 4000000001 ' }],
		() => ({
			statusCode: 200,
			body: fixture('person'),
		}),
	);
	const [[item]] = await run(ok);
	assert.equal(ok.calls[0].options.url, 'https://virkly.io/v1/persons/4000000001');
	assert.equal(item.json.name, 'Test Person');
	assert.equal(item.json.roles[0].cvr, 12345678);

	const missing = context([{ resource: 'person', operation: 'get', enhedsNummer: '1' }], () => ({
		statusCode: 404,
		body: fixture('person-not-found'),
	}));
	await assert.rejects(run(missing), /No person with enhedsNummer 1/);

	const bad = context([{ resource: 'person', operation: 'get', enhedsNummer: 'abc' }], () =>
		assert.fail('no request expected'),
	);
	await assert.rejects(run(bad), /"abc" is not an enhedsNummer/);
});

test('every operation shares the quota error with the upgrade link', async () => {
	const ops = [
		{ resource: 'company', operation: 'getFinancials', cvr: '24256790' },
		search({ q: 'novo' }),
		{ resource: 'bankruptcy', operation: 'getAll', days: '7', returnAll: true, filters: {} },
		{ resource: 'person', operation: 'get', enhedsNummer: '4000000001' },
	];
	for (const params of ops) {
		const ctx = context([params], () => ({ statusCode: 429, body: fixture('quota-exceeded') }));
		await assert.rejects(run(ctx), /used all 1,000 API calls.*https:\/\/virkly\.io\/pricing/);
	}
});

test('package.json has no runtime dependencies', () => {
	assert.equal(require('../package.json').dependencies, undefined);
});
