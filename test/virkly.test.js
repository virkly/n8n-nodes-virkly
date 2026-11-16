// Unit tests against the built package (npm run build first): request building and response
// mapping from recorded fixtures. No live calls.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { version } = require('../package.json');
const { Virkly } = require('../dist/nodes/Virkly/Virkly.node.js');
const { VirklyApi } = require('../dist/credentials/VirklyApi.credentials.js');
const {
	companyGetRequest,
	errorMessage,
	normalizeCvr,
	USER_AGENT,
} = require('../dist/nodes/Virkly/transport.js');

const fixture = (name) => require(`./fixtures/${name}.json`);

/** A minimal IExecuteFunctions: one item per CVR, a canned HTTP response per call. */
function context(cvrs, respond, { continueOnFail = false } = {}) {
	const calls = [];
	return {
		calls,
		getInputData: () => cvrs.map(() => ({ json: {} })),
		getNodeParameter: (name, i) => cvrs[i],
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
				return respond(options);
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
	assert.match(errorMessage(429, {}, '24256790'), /per minute.*https:\/\/virkly\.io\/pricing/);
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

test('package.json has no runtime dependencies', () => {
	assert.equal(require('../package.json').dependencies, undefined);
});
