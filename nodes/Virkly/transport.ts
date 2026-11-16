import type { IDataObject, IHttpRequestOptions } from 'n8n-workflow';
import { version } from '../../package.json';

export const BASE_URL = 'https://virkly.io';
export const USER_AGENT = `n8n-nodes-virkly/${version}`;
export const PRICING_URL = 'https://virkly.io/pricing';

/** "2425 67-90" → "24256790"; null when it isn't 8 digits after stripping spaces and dashes. */
export function normalizeCvr(input: unknown): string | null {
	const cvr = String(input ?? '').replace(/[\s-]/g, '');
	return /^\d{8}$/.test(cvr) ? cvr : null;
}

/** GET /v1/companies/{cvr}. Status errors come back as responses so we can explain them. */
export function companyGetRequest(cvr: string): IHttpRequestOptions {
	return {
		method: 'GET',
		url: `${BASE_URL}/v1/companies/${cvr}`,
		headers: { Accept: 'application/json', 'User-Agent': USER_AGENT },
		json: true,
		returnFullResponse: true,
		ignoreHttpStatusErrors: true,
	};
}

function apiError(body: unknown): { code?: string; message?: string } {
	const error = (body as IDataObject | undefined)?.error as IDataObject | undefined;
	return {
		code: typeof error?.code === 'string' ? error.code : undefined,
		message: typeof error?.message === 'string' ? error.message : undefined,
	};
}

/** A message the n8n user can act on, or null for a successful response. */
export function errorMessage(statusCode: number, body: unknown, cvr: string): string | null {
	if (statusCode >= 200 && statusCode < 300) return null;
	const { code, message } = apiError(body);
	if (statusCode === 401 || statusCode === 403) {
		return `virkly rejected the API key: ${message ?? 'check the Virkly API credential'}`;
	}
	if (statusCode === 404) return `No company with CVR ${cvr}`;
	if (statusCode === 429) {
		if (code === 'QUOTA_EXCEEDED') {
			return `${message ?? 'Your monthly API quota is used up.'} Upgrade your plan to keep the workflow running: ${PRICING_URL}`;
		}
		return `Too many requests per minute. Wait a moment and retry, or upgrade for a higher limit: ${PRICING_URL}`;
	}
	return message ?? `virkly API error (HTTP ${statusCode})`;
}
