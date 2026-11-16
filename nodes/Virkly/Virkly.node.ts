import {
	NodeApiError,
	NodeConnectionTypes,
	NodeOperationError,
	type IExecuteFunctions,
	type IN8nHttpFullResponse,
	type INodeExecutionData,
	type INodeType,
	type INodeTypeDescription,
	type JsonObject,
} from 'n8n-workflow';
import { companyGetRequest, errorMessage, normalizeCvr } from './transport';

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
				options: [{ name: 'Company', value: 'company' }],
				default: 'company',
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
				],
				default: 'get',
			},
			{
				displayName: 'CVR Number',
				name: 'cvr',
				type: 'string',
				required: true,
				default: '',
				placeholder: '24256790',
				description: 'The 8-digit CVR number. Spaces and dashes are ignored.',
				displayOptions: { show: { resource: ['company'], operation: ['get'] } },
			},
		],
	};

	async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
		const items = this.getInputData();
		const returnData: INodeExecutionData[] = [];

		for (let i = 0; i < items.length; i++) {
			const result = await getCompany(this, i);
			if (!(result instanceof Error)) {
				returnData.push({ json: result, pairedItem: { item: i } });
			} else if (this.continueOnFail()) {
				returnData.push({
					json: { error: result.message },
					error: result,
					pairedItem: { item: i },
				});
			} else {
				throw result;
			}
		}

		return [returnData];
	}
}

/** Company → Get for one item: the company JSON, or an n8n error the user can act on. */
async function getCompany(
	ctx: IExecuteFunctions,
	itemIndex: number,
): Promise<JsonObject | NodeApiError | NodeOperationError> {
	const input = ctx.getNodeParameter('cvr', itemIndex) as string;
	const cvr = normalizeCvr(input);
	if (!cvr) {
		return new NodeOperationError(
			ctx.getNode(),
			`"${input}" is not a CVR number: use the 8 digits, e.g. 24256790`,
			{ itemIndex },
		);
	}
	let response: IN8nHttpFullResponse;
	try {
		response = (await ctx.helpers.httpRequestWithAuthentication.call(
			ctx,
			'virklyApi',
			companyGetRequest(cvr),
		)) as IN8nHttpFullResponse;
	} catch (error) {
		return new NodeApiError(ctx.getNode(), error as JsonObject, { itemIndex });
	}
	const message = errorMessage(response.statusCode, response.body, cvr);
	if (message) {
		return new NodeApiError(ctx.getNode(), (response.body ?? {}) as JsonObject, {
			message,
			httpCode: String(response.statusCode),
			itemIndex,
		});
	}
	return response.body as JsonObject;
}
