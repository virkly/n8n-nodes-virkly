import {
	NodeApiError,
	NodeConnectionTypes,
	NodeOperationError,
	sleep,
	type IDataObject,
	type IExecuteFunctions,
	type IHttpRequestOptions,
	type IN8nHttpFullResponse,
	type INodeExecutionData,
	type INodeProperties,
	type INodeType,
	type INodeTypeDescription,
	type JsonObject,
} from 'n8n-workflow';
import {
	BANKRUPTCIES_PAGE_SIZE,
	SEARCH_MAX_OFFSET,
	SEARCH_PAGE_SIZE,
	bankruptciesRequest,
	collect,
	companyGetRequest,
	errorMessage,
	financialsRequest,
	normalizeCvr,
	personGetRequest,
	searchRequest,
	toDate,
	type SearchParams,
} from './transport';

const show = (resource: string, operation: string[]) => ({
	show: { resource: [resource], operation },
});

/** Return All + Limit, n8n's usual pair for list operations. */
function paging(resource: string, operation: string): INodeProperties[] {
	return [
		{
			displayName: 'Return All',
			name: 'returnAll',
			type: 'boolean',
			default: false,
			description: 'Whether to return all results or only up to a given limit',
			displayOptions: show(resource, [operation]),
		},
		{
			displayName: 'Limit',
			name: 'limit',
			type: 'number',
			typeOptions: { minValue: 1, numberPrecision: 0 },
			default: 50,
			description: 'Max number of results to return',
			displayOptions: {
				show: { resource: [resource], operation: [operation], returnAll: [false] },
			},
		},
	];
}

export class Virkly implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'Virkly',
		name: 'virkly',
		icon: { light: 'file:../../icons/virkly.svg', dark: 'file:../../icons/virkly.dark.svg' },
		group: ['input'],
		version: 1,
		subtitle: '={{$parameter["operation"] + ": " + $parameter["resource"]}}',
		description: 'Danish company data from the CVR register',
		defaults: {
			name: 'Virkly',
		},
		usableAsTool: true,
		inputs: [NodeConnectionTypes.Main],
		outputs: [NodeConnectionTypes.Main],
		credentials: [{ name: 'virklyApi', required: true }],
		properties: [
			{
				displayName: 'Resource',
				name: 'resource',
				type: 'options',
				noDataExpression: true,
				options: [
					{ name: 'Bankruptcy', value: 'bankruptcy' },
					{ name: 'Company', value: 'company' },
					{ name: 'Person', value: 'person' },
				],
				default: 'company',
			},
			{
				displayName: 'Operation',
				name: 'operation',
				type: 'options',
				noDataExpression: true,
				displayOptions: { show: { resource: ['bankruptcy'] } },
				options: [
					{
						name: 'Get Many',
						value: 'getAll',
						action: 'Get many bankruptcies',
						description: 'List companies declared bankrupt in the last 7 or 30 days, newest first',
					},
				],
				default: 'getAll',
			},
			{
				displayName: 'Operation',
				name: 'operation',
				type: 'options',
				noDataExpression: true,
				displayOptions: { show: { resource: ['company'] } },
				options: [
					{
						name: 'Get',
						value: 'get',
						action: 'Get a company',
						description: 'Get a company by its CVR number',
					},
					{
						name: 'Get Financials',
						value: 'getFinancials',
						action: 'Get the financials of a company',
						description: 'Get key figures from the annual reports, newest year first',
					},
					{
						name: 'Search',
						value: 'search',
						action: 'Search companies',
						description: 'Search companies by name, or list a segment by kommune and founding date',
					},
				],
				default: 'get',
			},
			{
				displayName: 'Operation',
				name: 'operation',
				type: 'options',
				noDataExpression: true,
				displayOptions: { show: { resource: ['person'] } },
				options: [
					{
						name: 'Get',
						value: 'get',
						action: 'Get a person',
						description: "Get a person's roles in companies by enhedsNummer",
					},
				],
				default: 'get',
			},

			// Company → Get / Get Financials
			{
				displayName: 'CVR Number',
				name: 'cvr',
				type: 'string',
				required: true,
				default: '',
				placeholder: '24256790',
				description: 'The 8-digit CVR number. Spaces and dashes are ignored.',
				displayOptions: show('company', ['get', 'getFinancials']),
			},
			{
				displayName: 'Options',
				name: 'options',
				type: 'collection',
				placeholder: 'Add Option',
				default: {},
				displayOptions: show('company', ['getFinancials']),
				options: [
					{
						displayName: 'Year',
						name: 'year',
						type: 'number',
						typeOptions: { minValue: 2000 },
						default: 2025,
						description: 'Only return figures for this fiscal year',
					},
				],
			},

			// Company → Search
			{
				displayName: 'Query',
				name: 'q',
				type: 'string',
				default: '',
				placeholder: 'novo nordisk',
				description:
					'Company name or CVR number (at least 2 characters). Leave empty to list a segment by the filters below.',
				displayOptions: show('company', ['search']),
			},
			...paging('company', 'search'),
			{
				displayName: 'Filters',
				name: 'filters',
				type: 'collection',
				placeholder: 'Add Filter',
				default: {},
				displayOptions: show('company', ['search']),
				options: [
					{
						displayName: 'Founded From',
						name: 'foundedFrom',
						type: 'dateTime',
						default: '',
						description: 'Founded on or after this date',
					},
					{
						displayName: 'Founded To',
						name: 'foundedTo',
						type: 'dateTime',
						default: '',
						description: 'Founded on or before this date',
					},
					{
						displayName: 'Municipality',
						name: 'municipality',
						type: 'string',
						default: '',
						placeholder: 'Aarhus',
						description: 'Kommune name, any case',
					},
					{
						displayName: 'Status',
						name: 'status',
						type: 'options',
						options: [
							{ name: 'Active', value: 'active' },
							{ name: 'All', value: 'all' },
							{ name: 'Dissolved', value: 'dissolved' },
						],
						default: 'all',
					},
				],
			},

			// Bankruptcy → Get Many
			{
				displayName: 'Period',
				name: 'days',
				type: 'options',
				options: [
					{ name: 'Last 7 Days', value: '7' },
					{ name: 'Last 30 Days', value: '30' },
				],
				default: '7',
				description: 'How far back to look for bankruptcies',
				displayOptions: show('bankruptcy', ['getAll']),
			},
			...paging('bankruptcy', 'getAll'),
			{
				displayName: 'Filters',
				name: 'filters',
				type: 'collection',
				placeholder: 'Add Filter',
				default: {},
				displayOptions: show('bankruptcy', ['getAll']),
				options: [
					{
						displayName: 'Industry Code',
						name: 'industry',
						type: 'string',
						default: '',
						placeholder: '561010',
						description: 'Only this trade (DB07 industry code, 1-6 digits)',
					},
				],
			},

			// Person → Get
			{
				displayName: 'EnhedsNummer',
				name: 'enhedsNummer',
				type: 'string',
				required: true,
				default: '',
				placeholder: '4000000001',
				description: "The person's participant number in the CVR register",
				displayOptions: show('person', ['get']),
			},
		],
	};

	async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
		const items = this.getInputData();
		const returnData: INodeExecutionData[] = [];

		for (let i = 0; i < items.length; i++) {
			try {
				const results = await runOperation(this, i);
				for (const json of results) returnData.push({ json, pairedItem: { item: i } });
			} catch (caught) {
				const error =
					caught instanceof NodeApiError || caught instanceof NodeOperationError
						? caught
						: new NodeOperationError(this.getNode(), caught as Error, { itemIndex: i });
				if (!this.continueOnFail()) throw error;
				returnData.push({ json: { error: error.message }, error, pairedItem: { item: i } });
			}
		}

		return [returnData];
	}
}

/** The selected operation for one input item: one output item per result. */
async function runOperation(ctx: IExecuteFunctions, i: number): Promise<IDataObject[]> {
	const resource = ctx.getNodeParameter('resource', i) as string;
	const operation = ctx.getNodeParameter('operation', i) as string;

	if (resource === 'company' && (operation === 'get' || operation === 'getFinancials')) {
		const cvr = cvrParameter(ctx, i);
		const notFound = `No company with CVR ${cvr}`;
		if (operation === 'get') return [await call(ctx, i, companyGetRequest(cvr), notFound)];
		const { year } = ctx.getNodeParameter('options', i, {}) as { year?: number };
		return [await call(ctx, i, financialsRequest(cvr, year), notFound)];
	}
	if (resource === 'company' && operation === 'search') return searchCompanies(ctx, i);
	if (resource === 'bankruptcy' && operation === 'getAll') return listBankruptcies(ctx, i);
	if (resource === 'person' && operation === 'get') {
		const input = String(ctx.getNodeParameter('enhedsNummer', i)).trim();
		if (!/^[1-9]\d*$/.test(input)) {
			throw new NodeOperationError(
				ctx.getNode(),
				`"${input}" is not an enhedsNummer: use digits only`,
				{
					itemIndex: i,
				},
			);
		}
		return [await call(ctx, i, personGetRequest(input), `No person with enhedsNummer ${input}`)];
	}
	throw new NodeOperationError(ctx.getNode(), `Unsupported operation ${resource} → ${operation}`, {
		itemIndex: i,
	});
}

function cvrParameter(ctx: IExecuteFunctions, i: number): string {
	const input = ctx.getNodeParameter('cvr', i) as string;
	const cvr = normalizeCvr(input);
	if (!cvr) {
		throw new NodeOperationError(
			ctx.getNode(),
			`"${input}" is not a CVR number: use the 8 digits, e.g. 24256790`,
			{ itemIndex: i },
		);
	}
	return cvr;
}

/** How many results to collect: Infinity for Return All. */
function limitParameter(ctx: IExecuteFunctions, i: number): number {
	return ctx.getNodeParameter('returnAll', i)
		? Infinity
		: (ctx.getNodeParameter('limit', i) as number);
}

async function searchCompanies(ctx: IExecuteFunctions, i: number): Promise<IDataObject[]> {
	const q = (ctx.getNodeParameter('q', i) as string).trim();
	const filters = ctx.getNodeParameter('filters', i, {}) as IDataObject;
	const params: SearchParams = {
		q,
		municipality: String(filters.municipality ?? '').trim(),
		status: filters.status as string | undefined,
	};
	for (const key of ['foundedFrom', 'foundedTo'] as const) {
		if (!filters[key]) continue;
		const date = toDate(filters[key]);
		if (!date) {
			throw new NodeOperationError(ctx.getNode(), `${key} must be a date (YYYY-MM-DD)`, {
				itemIndex: i,
			});
		}
		params[key] = date;
	}
	if (q.length === 1) {
		throw new NodeOperationError(ctx.getNode(), 'The query needs at least 2 characters', {
			itemIndex: i,
		});
	}
	if (!q && !params.municipality && !params.foundedFrom && !params.foundedTo) {
		throw new NodeOperationError(
			ctx.getNode(),
			'Enter a query, or a Municipality, Founded From or Founded To filter to list a segment',
			{ itemIndex: i },
		);
	}

	const limit = limitParameter(ctx, i);
	const size = Math.min(limit, SEARCH_PAGE_SIZE);
	return collect(limit, async (n) => {
		const offset = n * size;
		const body = await call(
			ctx,
			i,
			searchRequest(params, size, offset),
			'virkly API error (HTTP 404)',
		);
		const results = (body.results ?? []) as IDataObject[];
		const hasMore =
			typeof body.hasMore === 'boolean'
				? body.hasMore
				: offset + results.length < (body.total as number);
		// The API rejects offsets above 10,000: narrow a bigger segment with the date filters
		return { items: results, more: hasMore && offset + size <= SEARCH_MAX_OFFSET };
	});
}

async function listBankruptcies(ctx: IExecuteFunctions, i: number): Promise<IDataObject[]> {
	const days = ctx.getNodeParameter('days', i) as string;
	const { industry } = ctx.getNodeParameter('filters', i, {}) as { industry?: string };
	return collect(limitParameter(ctx, i), async (n) => {
		const request = bankruptciesRequest(days, n + 1, industry?.trim());
		const body = await call(ctx, i, request, 'No bankruptcies found');
		return {
			items: (body.items ?? []) as IDataObject[],
			more: (n + 1) * BANKRUPTCIES_PAGE_SIZE < (body.total as number),
		};
	});
}

const MAX_RATE_LIMIT_RETRIES = 2;

/** How long to wait before retrying a per-minute 429 (Retry-After, at most 60 s); null for anything else. */
function retryAfterMs(response: IN8nHttpFullResponse): number | null {
	const code = ((response.body as IDataObject | undefined)?.error as IDataObject | undefined)?.code;
	if (response.statusCode !== 429 || code !== 'RATE_LIMIT_EXCEEDED') return null;
	const seconds = Number(response.headers?.['retry-after']);
	return Math.min(Number.isFinite(seconds) && seconds > 0 ? seconds : 60, 60) * 1000;
}

/** One API call: the response body, or an n8n error the user can act on. */
async function call(
	ctx: IExecuteFunctions,
	itemIndex: number,
	request: IHttpRequestOptions,
	notFound: string,
): Promise<JsonObject> {
	let response: IN8nHttpFullResponse;
	for (let attempt = 0; ; attempt++) {
		try {
			response = (await ctx.helpers.httpRequestWithAuthentication.call(
				ctx,
				'virklyApi',
				request,
			)) as IN8nHttpFullResponse;
		} catch (error) {
			throw new NodeApiError(ctx.getNode(), error as JsonObject, { itemIndex });
		}
		const wait = retryAfterMs(response);
		// Per-minute limit (10/min on Free): wait it out so Return All keeps the pages it already paid for
		if (wait === null || attempt >= MAX_RATE_LIMIT_RETRIES) break;
		await sleep(wait);
	}
	const message = errorMessage(response.statusCode, response.body, notFound);
	if (message) {
		throw new NodeApiError(ctx.getNode(), (response.body ?? {}) as JsonObject, {
			message,
			httpCode: String(response.statusCode),
			itemIndex,
		});
	}
	return response.body as JsonObject;
}
