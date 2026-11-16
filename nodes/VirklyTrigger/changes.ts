import type { IDataObject, IHttpRequestOptions } from 'n8n-workflow';
import { apiError, apiRequest, errorMessage, normalizeCvr } from '../Virkly/transport';

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

/** GET /v1/changes */
export function changesRequest(qs: IDataObject): IHttpRequestOptions {
	return apiRequest('/v1/changes', qs);
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
	fetchFeed: FetchFeed,
	filter: ChangeFilter,
	position: IDataObject,
): Promise<FeedPage | FeedError> {
	const res = await fetchFeed({ type: filter.types.join(','), limit: PAGE_LIMIT, ...position });
	const message = errorMessage(
		res.statusCode,
		res.body,
		'virkly has no change feed at this address (HTTP 404)',
	);
	if (!message) return res.body as FeedPage;
	return new FeedError(res.statusCode, apiError(res.body).code, message);
}

/**
 * One scheduled poll: the matching changes recorded since the last poll, oldest first. Mutates `state`.
 * The first poll only stores "now", so activating a workflow never replays history.
 */
export async function pollChanges(
	state: PollState,
	fetchFeed: FetchFeed,
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
	let restarted = false;
	let pagesRead = 0;
	for (let page = 0; page < MAX_PAGES; page++) {
		const res = await fetchPage(
			fetchFeed,
			filter,
			state.cursor ? { cursor: state.cursor } : { since: state.since },
		);
		if (res instanceof FeedError) {
			if (res.code === 'CHANGES_WINDOW' && !restarted) {
				restarted = true;
				// Paused longer than the plan's 7-day window: restart at the oldest point the plan can read
				state.cursor = undefined;
				state.since = new Date(now.getTime() - WINDOW_MS).toISOString();
				continue;
			}
			// Emit what earlier pages already advanced past; the error resurfaces on the next poll
			if (pagesRead > 0) break;
			throw res;
		}
		if (res.nextCursor) {
			state.cursor = res.nextCursor;
			state.since = undefined;
		}
		pagesRead++;
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
	fetchFeed: FetchFeed,
	filter: ChangeFilter,
	now = new Date(),
): Promise<IDataObject | null> {
	let position: IDataObject = { since: new Date(now.getTime() - WINDOW_MS).toISOString() };
	let latest: IDataObject | null = null;
	for (let page = 0; page < MAX_PAGES; page++) {
		const res = await fetchPage(fetchFeed, filter, position);
		if (res instanceof FeedError) throw res;
		for (const change of res.changes) if (matches(change, filter)) latest = change;
		if (!res.hasMore || !res.nextCursor) break;
		position = { cursor: res.nextCursor };
	}
	return latest;
}
