import type { IDataObject, IHttpRequestOptions } from 'n8n-workflow';
import { version } from '../../package.json';

export const BASE_URL = 'https://virkly.io';
export const USER_AGENT = `n8n-nodes-virkly/${version}`;
export const PRICING_URL = 'https://virkly.io/pricing';

/** Largest page /v1/search returns, and the highest offset it accepts. */
export const SEARCH_PAGE_SIZE = 100;
export const SEARCH_MAX_OFFSET = 10000;
/** /v1/bankruptcies always returns 50 per page. */
export const BANKRUPTCIES_PAGE_SIZE = 50;

/** "2425 67-90" → "24256790"; null when it isn't 8 digits after stripping spaces and dashes. */
export function normalizeCvr(input: unknown): string | null {
	const cvr = String(input ?? '').replace(/[\s-]/g, '');
	return /^\d{8}$/.test(cvr) ? cvr : null;
}

/** n8n date pickers give "2026-11-01T00:00:00"; the API takes the date. Null when it isn't a date. */
export function toDate(input: unknown): string | null {
	const match = /^\d{4}-\d{2}-\d{2}/.exec(String(input ?? '').trim());
	return match ? match[0] : null;
}

/** A GET on the public API. Status errors come back as responses so we can explain them. */
export function apiRequest(path: string, qs?: IDataObject): IHttpRequestOptions {
	return {
		method: 'GET',
		url: `${BASE_URL}${path}`,
		...(qs && { qs }),
		headers: { Accept: 'application/json', 'User-Agent': USER_AGENT },
		json: true,
		returnFullResponse: true,
		ignoreHttpStatusErrors: true,
	};
}

/** GET /v1/companies/{cvr} */
export function companyGetRequest(cvr: string): IHttpRequestOptions {
	return apiRequest(`/v1/companies/${cvr}`);
}

/** GET /v1/companies/{cvr}/financials, optionally for one fiscal year. */
export function financialsRequest(cvr: string, year?: number): IHttpRequestOptions {
	return apiRequest(`/v1/companies/${cvr}/financials`, year ? { year } : undefined);
}

/** GET /v1/persons/{enhedsNummer} */
export function personGetRequest(enhedsNummer: string): IHttpRequestOptions {
	return apiRequest(`/v1/persons/${enhedsNummer}`);
}

export interface SearchParams {
	q?: string;
	municipality?: string;
	foundedFrom?: string;
	foundedTo?: string;
	status?: string;
}

/** GET /v1/search (text search and/or segment filters), one page. Empty values are left out. */
export function searchRequest(
	params: SearchParams,
	limit: number,
	offset: number,
): IHttpRequestOptions {
	const qs: IDataObject = { limit, offset };
	for (const [key, value] of Object.entries(params)) {
		if (value) qs[key] = value;
	}
	return apiRequest('/v1/search', qs);
}

/** GET /v1/bankruptcies, one page (1-based). */
export function bankruptciesRequest(
	days: string,
	page: number,
	industry?: string,
): IHttpRequestOptions {
	return apiRequest('/v1/bankruptcies', { days, page, ...(industry && { industry }) });
}

/**
 * Collects list items page by page until `limit` items (Infinity = all) or the last page.
 * `fetchPage(n)` loads the n-th page (0-based) and says whether another one exists.
 */
export async function collect(
	limit: number,
	fetchPage: (n: number) => Promise<{ items: IDataObject[]; more: boolean }>,
): Promise<IDataObject[]> {
	const all: IDataObject[] = [];
	for (let n = 0; all.length < limit; n++) {
		const { items, more } = await fetchPage(n);
		all.push(...items);
		if (!more || items.length === 0) break;
	}
	return all.slice(0, limit);
}

export function apiError(body: unknown): { code?: string; message?: string } {
	const error = (body as IDataObject | undefined)?.error as IDataObject | undefined;
	return {
		code: typeof error?.code === 'string' ? error.code : undefined,
		message: typeof error?.message === 'string' ? error.message : undefined,
	};
}

/** A message the n8n user can act on, or null for a successful response. `notFound` is the 404 text. */
export function errorMessage(statusCode: number, body: unknown, notFound: string): string | null {
	if (statusCode >= 200 && statusCode < 300) return null;
	const { code, message } = apiError(body);
	if (statusCode === 401 || statusCode === 403) {
		return `virkly rejected the API key: ${message ?? 'check the Virkly API credential'}`;
	}
	if (statusCode === 404) return notFound;
	if (statusCode === 429) {
		if (code === 'QUOTA_EXCEEDED') {
			return `${message ?? 'Your monthly API quota is used up.'} Upgrade your plan to keep the workflow running: ${PRICING_URL}`;
		}
		return `Too many requests per minute. Wait a moment and retry, or upgrade for a higher limit: ${PRICING_URL}`;
	}
	return message ?? `virkly API error (HTTP ${statusCode})`;
}
