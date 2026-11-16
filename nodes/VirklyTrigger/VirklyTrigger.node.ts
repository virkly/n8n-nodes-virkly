import {
	NodeApiError,
	NodeConnectionTypes,
	NodeOperationError,
	type IN8nHttpFullResponse,
	type INodeExecutionData,
	type INodeType,
	type INodeTypeDescription,
	type IPollFunctions,
	type JsonObject,
} from 'n8n-workflow';
import {
	changesRequest,
	FeedError,
	latestChange,
	parseCvrList,
	pollChanges,
	type ChangeFilter,
	type FetchFeed,
	type PollState,
} from './changes';

export class VirklyTrigger implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'Virkly Trigger',
		name: 'virklyTrigger',
		icon: { light: 'file:../../icons/virkly.svg', dark: 'file:../../icons/virkly.dark.svg' },
		group: ['trigger'],
		version: 1,
		subtitle: '={{$parameter["event"]}}',
		description:
			'Starts the workflow when a Danish company changes status or name, or goes bankrupt',
		defaults: {
			name: 'Virkly Trigger',
		},
		polling: true,
		inputs: [],
		outputs: [NodeConnectionTypes.Main],
		credentials: [{ name: 'virklyApi', required: true }],
		properties: [
			{
				displayName:
					'The CVR register updates once a day, so virkly checks for changes at most once an hour, whatever the poll time. Each check is one API call (a few more on busy days).',
				name: 'notice',
				type: 'notice',
				default: '',
			},
			{
				displayName: 'Event',
				name: 'event',
				type: 'options',
				noDataExpression: true,
				options: [
					{
						name: 'Company Changed',
						value: 'companyChanged',
						description: 'A company changed status or name',
					},
					{
						name: 'Company Went Bankrupt',
						value: 'companyBankrupt',
						description: 'A company\'s status changed to "UNDER KONKURS" (konkurs)',
					},
				],
				default: 'companyChanged',
			},
			{
				displayName: 'Change Types',
				name: 'changeTypes',
				type: 'multiOptions',
				options: [
					{ name: 'Name', value: 'name' },
					{ name: 'Status', value: 'status' },
				],
				default: ['status', 'name'],
				description: 'Which changes start the workflow',
				displayOptions: { show: { event: ['companyChanged'] } },
			},
			{
				displayName: 'CVR Numbers',
				name: 'cvrs',
				type: 'string',
				typeOptions: { rows: 4 },
				default: '',
				placeholder: '24256790, 10007127',
				description:
					'Only these companies, separated by commas or new lines. Leave empty for all companies.',
			},
		],
	};

	async poll(this: IPollFunctions): Promise<INodeExecutionData[][] | null> {
		const event = this.getNodeParameter('event') as string;
		const input = this.getNodeParameter('cvrs', '') as string;
		const { cvrs, invalid } = parseCvrList(input);
		if (invalid.length > 0) {
			throw new NodeOperationError(
				this.getNode(),
				`Not CVR numbers: ${invalid.join(', ')}. Use the 8 digits, e.g. 24256790`,
			);
		}
		const bankruptOnly = event === 'companyBankrupt';
		const types = bankruptOnly
			? ['status']
			: (this.getNodeParameter('changeTypes', []) as string[]);
		if (types.length === 0) {
			throw new NodeOperationError(this.getNode(), 'Choose at least one change type');
		}
		const filter: ChangeFilter = { types, cvrs, bankruptOnly };

		const fetch: FetchFeed = async (qs) => {
			try {
				return (await this.helpers.httpRequestWithAuthentication.call(
					this,
					'virklyApi',
					changesRequest(qs),
				)) as IN8nHttpFullResponse;
			} catch (error) {
				// Network failure: no HTTP status, reported like any other feed error
				return { statusCode: 0, body: { error: { message: (error as Error).message } } };
			}
		};

		try {
			if (this.getMode() === 'manual') {
				const latest = await latestChange(fetch, filter);
				if (!latest) {
					throw new NodeOperationError(
						this.getNode(),
						'No matching changes in the last 7 days yet. Activate the workflow and it runs on the next one.',
					);
				}
				return [this.helpers.returnJsonArray([latest])];
			}
			const state = this.getWorkflowStaticData('node') as PollState;
			const changes = await pollChanges(state, fetch, filter);
			return changes.length > 0 ? [this.helpers.returnJsonArray(changes)] : null;
		} catch (error) {
			throw error instanceof FeedError
				? new NodeApiError(this.getNode(), {} as JsonObject, {
						message: error.message,
						httpCode: error.statusCode ? String(error.statusCode) : undefined,
					})
				: new NodeOperationError(this.getNode(), error as Error);
		}
	}
}
