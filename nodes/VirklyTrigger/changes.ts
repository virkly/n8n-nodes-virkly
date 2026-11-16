import type { IDataObject, IHttpRequestOptions } from 'n8n-workflow';
import { BASE_URL, errorMessage, normalizeCvr, USER_AGENT } from '../Virkly/transport';

/** The feed's status value for a company that has gone bankrupt (normalised, see virkly /v1/changes). */
export const BANKRUPT_STATUS = 'UNDER KONKURS';
export const MAX_PAGES = 20;
export const PAGE_LIMIT = 500;
// The register syncs once a day, so polling more often than this only spends API calls (a free key has
// 1,000 a month; n8n's default poll time is every minute).
export const MIN_POLL_INTERVAL_MS = 55 * 60 * 1000;
// Free and Pocket keys read the last 7 days of the feed; stay an hour inside that.
export const WINDOW_MS = 7 * 24 * 60 * 60 * 1000 - 60 * 60 * 1000;

/** Kept in the node's workflow static data between polls. */
export interface PollState {
	/** ISO start used until the feed hands back a cursor */
	since?: string;
	cursor?: string;
	lastPollAt?: string;
}

export interface ChangeFilter {
	types: string[];
	/** null = all companies */
	cvrs: Set<string> | null;
	bankruptOnly: boolean;
}

export interface FeedResponse {
	statusCode: number;
	body: unknown;
}

export type FetchFeed = (qs: IDataObject) => Promise<FeedResponse>;

interface FeedPage {
	changes: IDataObject[];
	nextCursor: string | null;
	hasMore: boolean;
}

export class FeedError extends Error {
	constructor(
		readonly statusCode: number,
		readonly code: string | undefined,
		message: string,
	) {
		super(message);
	}
}

export function changesRequest(qs: IDataObject): IHttpRequestOptions {
	return {
		method: 'GET',
		url: `${BASE_URL}/v1/changes`,
		qs,
		headers: { Accept: 'application/json', 'User-Agent': USER_AGENT },
		json: true,
		returnFullResponse: true,
		ignoreHttpStatusErrors: true,
	};
}

/** Comma/newline/semicolon separated CVRs → a set, plus the entries that aren't CVR numbers. */
export function parseCvrList(input: string): { cvrs: Set<string> | null; invalid: string[] } {
	const entries = input
		.split(/[,;\n]/)
		.map((s) => s.trim())
		.filter(Boolean);
	const cvrs = new Set<string>();
	const invalid: string[] = [];
	for (const entry of entries) {
		const cvr = normalizeCvr(entry);
		if (cvr) cvrs.add(cvr);
		else invalid.push(entry);
	}
	return { cvrs: cvrs.size > 0 ? cvrs : null, invalid };
}

export function matches(change: IDataObject, filter: ChangeFilter): boolean {
	if (filter.cvrs && !filter.cvrs.has(String(change.cvr))) return false;
	return !filter.bankruptOnly || (change.type === 'status' && change.newValue === BANKRUPT_STATUS);
}

/** One page of the feed, or the API's error as a FeedError (returned, so callers can react to it). */
async function fetchPage(
	fetch: FetchFeed,
	filter: ChangeFilter,
	position: IDataObject,
): Promise<FeedPage | FeedError> {
	const type = filter.bankruptOnly ? 'status' : filter.types.join(',');
	const res = await fetch({ type, limit: PAGE_LIMIT, ...position });
	const message = errorMessage(res.statusCode, res.body, '');
	if (!message) return res.body as FeedPage;
	const code = ((res.body as IDataObject | undefined)?.error as IDataObject | undefined)?.code;
	return new FeedError(res.statusCode, typeof code === 'string' ? code : undefined, message);
}

/**
 * One scheduled poll: the matching changes recorded since the last poll, oldest first. Mutates `state`.
 * The first poll only stores "now", so activating a workflow never replays history.
 */
export async function pollChanges(
	state: PollState,
	fetch: FetchFeed,
	filter: ChangeFilter,
	now = new Date(),
): Promise<IDataObject[]> {
	if (!state.cursor && !state.since) {
		state.since = now.toISOString();
		state.lastPollAt = now.toISOString();
		return [];
	}
	if (state.lastPollAt && now.getTime() - Date.parse(state.lastPollAt) < MIN_POLL_INTERVAL_MS) {
		return [];
	}
	state.lastPollAt = now.toISOString();

	const found: IDataObject[] = [];
	for (let page = 0; page < MAX_PAGES; page++) {
		const res = await fetchPage(
			fetch,
			filter,
			state.cursor ? { cursor: state.cursor } : { since: state.since },
		);
		if (res instanceof FeedError) {
			if (res.code === 'CHANGES_WINDOW' && state.cursor) {
				// Paused longer than the plan's 7-day window: restart at the oldest point the plan can read
				state.cursor = undefined;
				state.since = new Date(now.getTime() - WINDOW_MS).toISOString();
				continue;
			}
			// Emit what earlier pages already advanced past; the error resurfaces on the next poll
			if (page > 0) break;
			throw res;
		}
		if (res.nextCursor) {
			state.cursor = res.nextCursor;
			state.since = undefined;
		}
		found.push(...res.changes.filter((c) => matches(c, filter)));
		if (!res.hasMore || !res.nextCursor) break;
	}
	return found;
}

/**
 * "Fetch test event": the latest matching change from the last ~7 days, or null. Reads no state.
 * shortcut: stops after MAX_PAGES × PAGE_LIMIT rows (about 2.5× a normal week), raise if the feed grows.
 */
export async function latestChange(
	fetch: FetchFeed,
	filter: ChangeFilter,
	now = new Date(),
): Promise<IDataObject | null> {
	let position: IDataObject = { since: new Date(now.getTime() - WINDOW_MS).toISOString() };
	let latest: IDataObject | null = null;
	for (let page = 0; page < MAX_PAGES; page++) {
		const res = await fetchPage(fetch, filter, position);
		if (res instanceof FeedError) throw res;
		for (const change of res.changes) if (matches(change, filter)) latest = change;
		if (!res.hasMore || !res.nextCursor) break;
		position = { cursor: res.nextCursor };
	}
	return latest;
}
