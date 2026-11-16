import type {
	IAuthenticateGeneric,
	Icon,
	ICredentialTestRequest,
	ICredentialType,
	INodeProperties,
} from 'n8n-workflow';
import { BASE_URL, USER_AGENT } from '../nodes/Virkly/transport';

export class VirklyApi implements ICredentialType {
	name = 'virklyApi';

	displayName = 'Virkly API';

	icon: Icon = { light: 'file:../icons/virkly.svg', dark: 'file:../icons/virkly.dark.svg' };

	documentationUrl = 'https://github.com/virkly/n8n-nodes-virkly#credentials';

	properties: INodeProperties[] = [
		{
			displayName: 'API Key',
			name: 'apiKey',
			type: 'string',
			typeOptions: { password: true },
			default: '',
			description:
				'Your virkly API key (starts with vkly_live_). Create one at https://virkly.io/dashboard/settings/api-keys.',
		},
	];

	authenticate: IAuthenticateGeneric = {
		type: 'generic',
		properties: {
			headers: {
				Authorization: '=Bearer {{$credentials.apiKey}}',
			},
		},
	};

	// One cached company lookup (Novo Nordisk): the cheapest call an API key can make
	test: ICredentialTestRequest = {
		request: {
			baseURL: BASE_URL,
			url: '/v1/companies/24256790',
			method: 'GET',
			headers: { 'User-Agent': USER_AGENT },
		},
		rules: [
			{
				type: 'responseCode',
				properties: {
					value: 401,
					message:
						'virkly did not accept this API key. Check that it starts with vkly_live_ and has no stray spaces, or create a new key at https://virkly.io/dashboard/settings/api-keys.',
				},
			},
			{
				type: 'responseCode',
				properties: {
					value: 429,
					message:
						'The key works, but its monthly quota is used up or it is making too many calls a minute. Upgrade to keep workflows running: https://virkly.io/pricing',
				},
			},
		],
	};
}
