import type { SyncContext } from "../db/types";

/**
 * Serialize query params the way Moqui expects, expanding arrays into REPEATED keys:
 *   { id: ["A", "B"], id_op: "in" }  →  id=A&id=B&id_op=in
 *
 * `new URLSearchParams(params)` comma-joins instead — `id=A%2CB` — which Moqui reads as one
 * literal value, so the request 200s with an empty list and the failure is silent. Axios (used on
 * the main thread) expands arrays by default, which is why the same query works from a store and
 * fails from a worker.
 */
function toQueryString(params: Record<string, unknown>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null) continue;
    if (Array.isArray(value)) {
      for (const entry of value) {
        if (entry === undefined || entry === null) continue;
        search.append(key, String(entry));
      }
    } else {
      search.append(key, String(value));
    }
  }
  return search.toString();
}

/**
 * An empty 200 is not an error. Moqui answers some list routes with no body at all when the set
 * is empty, and `response.json()` throws a SyntaxError on it. A genuine parse failure (an HTML
 * error page, say) has a different message and must still propagate.
 */
function isEmptyBodyError(err: unknown): boolean {
  if (!(err instanceof SyntaxError)) return false;
  return /unexpected end of (json )?input/i.test(String((err as Error).message ?? ""));
}

export default async function workerRemoteApi(customConfig: {
  url: string;
  method?: string;
  data?: any;
  params?: any;
  baseURL?: string;
  headers?: Record<string, string>;
}) {
  const { url, method = "GET", data, params, baseURL, headers = {} } = customConfig;

  // Build URL
  let baseUrl = baseURL || '';
  if (baseUrl && !baseUrl.startsWith("http://") && !baseUrl.startsWith("https://") && !baseUrl.includes(".") && !baseUrl.includes("/")) {
    baseUrl = `https://${baseUrl}.hotwax.io`;
  }
  if (!baseUrl.endsWith('/')) {
    baseUrl += '/';
  }
  // Ensure Moqui routes use /rest/s1/
  if (url.startsWith('oms/') || url.startsWith('shippingGateways/')) {
    if (baseUrl.includes('/api/')) {
      baseUrl = baseUrl.replace('/api/', '/rest/s1/');
    } else if (!baseUrl.includes('/rest/s1/')) {
      baseUrl += 'rest/s1/';
    }
  } else if (!baseUrl.includes('rest/s1') && !baseUrl.includes('/api/')) {
    baseUrl += 'api/';
  }

  let fullUrl = baseUrl ? `${baseUrl}${url}` : url;
  if (params && Object.keys(params).length > 0) {
    const queryString = toQueryString(params);
    fullUrl += (fullUrl.includes('?') ? '&' : '?') + queryString;
  }

  const fetchOptions: RequestInit = {
    method,
    headers: {
      "Content-Type": "application/json",
      ...headers
    }
  };

  if (data && method.toUpperCase() !== "GET") {
    fetchOptions.body = JSON.stringify(data);
  }

  const response = await fetch(fullUrl, fetchOptions);

  let result: any = null;
  try {
    result = await response.json();
  } catch (err) {
    if (!isEmptyBodyError(err)) throw err;
    result = null;
  }

  if (!response.ok) {
    // A parsed error body is thrown as-is: callers classify auth failures by sniffing its
    // message, and wrapping it would break that. Only a bodyless failure becomes an Error.
    throw result ?? new Error(`Request failed with status ${response.status}`);
  }
  return result;
}

export async function workerGet(
  ctx: SyncContext,
  url: string,
  params: Record<string, unknown> = {},
): Promise<any> {
  return workerRemoteApi({
    baseURL: (ctx.maargUrl as string) || "",
    url,
    params,
    method: "GET",
    headers: { Authorization: `Bearer ${ctx.token}` },
  });
}

export async function workerPost(
  ctx: SyncContext,
  url: string,
  data: Record<string, unknown> = {},
): Promise<any> {
  return workerRemoteApi({
    baseURL: (ctx.maargUrl as string) || "",
    url,
    data,
    method: "POST",
    headers: { Authorization: `Bearer ${ctx.token}` },
  });
}

export function unwrapCollection(resp: any, collectionKey?: string | null): any[] {
  if (Array.isArray(resp)) return resp;
  if (collectionKey && Array.isArray(resp?.[collectionKey])) return resp[collectionKey];
  if (collectionKey) return [];
  const firstArray = resp && typeof resp === "object"
    ? Object.values(resp).find((value) => Array.isArray(value))
    : undefined;
  return (firstArray as any[]) ?? [];
}

/**
 * Require the response to be the collection shape the domain declared, instead of letting
 * `unwrapCollection` guess.
 *
 * Snapshot replacement treats an empty collection as authoritative and prunes the whole scope, so
 * for a mutation-sensitive domain a payload-level error or an unexpected success envelope must
 * fail loudly rather than degrade to `[]`.
 */
function assertCollectionShape(resp: any, collectionKey: string | null | undefined, label: string): void {
  if (collectionKey) {
    if (!Array.isArray(resp?.[collectionKey])) {
      throw new Error(`[db] ${label}: response must contain an array at \`${collectionKey}\`.`);
    }
    return;
  }
  if (!Array.isArray(resp)) {
    throw new Error(`[db] ${label}: response must be a bare array.`);
  }
}

export async function pageAll(options: {
  ctx: SyncContext;
  url: string;
  collectionKey?: string | null;
  /** Fail on an unrecognized envelope instead of unwrapping it to an empty list. */
  strictCollection?: boolean;
  params?: Record<string, unknown>;
  batchSize?: number;
  unpaged?: boolean;
  keyOf?: (record: any) => string | undefined;
  maxPages?: number;
  /** Identifies the domain (and parent, for a fan-out) in errors/warnings. Defaults to `url`. */
  label?: string;
}): Promise<any[]> {
  const {
    ctx, url, collectionKey, strictCollection = false, params = {},
    batchSize = 250, unpaged = false, keyOf, maxPages = 40, label = url,
  } = options;
  if (unpaged || batchSize === 0) {
    // Single request, but still ask for a full page: Moqui defaults to 20 rows when no page
    // size is given, which silently truncates a snapshot to its first 20 records.
    const singlePageSize = batchSize || 250;
    const resp = await workerGet(ctx, url, { ...params, pageSize: singlePageSize, viewSize: singlePageSize });
    if (strictCollection) assertCollectionShape(resp, collectionKey, label);
    const rows = unwrapCollection(resp, collectionKey);
    return rows ?? [];
  }
  const all: any[] = [];
  const seenKeys = new Set<string>();
  let pageIndex = 0;

  while (pageIndex < maxPages) {
    const pageParams = {
      ...params,
      pageIndex,
      pageSize: batchSize,
      viewIndex: pageIndex,
      viewSize: batchSize,
    };
    const resp = await workerGet(ctx, url, pageParams);
    if (strictCollection) assertCollectionShape(resp, collectionKey, label);
    const rows = unwrapCollection(resp, collectionKey);
    if (!rows || rows.length === 0) break;

    let newKeysCount = 0;
    for (const row of rows) {
      const key = keyOf ? keyOf(row) : undefined;
      if (key) {
        if (!seenKeys.has(key)) {
          seenKeys.add(key);
          all.push(row);
          newKeysCount++;
        }
      } else {
        all.push(row);
      }
    }

    if (rows.length < batchSize) break; // last page

    // Server ignored pageIndex (the same page came back) — stop instead of looping, and say so:
    // a silently half-filled table is indistinguishable from a complete one. Checked AFTER the
    // short-page break above: a legitimate final page whose rows all duplicate earlier ones (e.g.
    // every row on it was already seen) is a normal end of pagination, not a stuck pageIndex.
    if (newKeysCount === 0) {
      console.warn(
        `[db] ${label}: page ${pageIndex} returned no new records — the endpoint appears to ignore pageIndex; stopping with ${all.length}.`,
      );
      break;
    }
    pageIndex++;
  }

  // The loop increments pageIndex on a normal iteration, so reaching maxPages here means the walk
  // was cut short rather than finished. Warn — a silently truncated set looks like a complete one.
  if (pageIndex >= maxPages) {
    console.warn(
      `[db] ${label}: stopped at the ${maxPages}-page backstop after ${all.length} records — the set may be TRUNCATED.`,
    );
  }

  return all;
}

/**
 * Page a newest-first list endpoint until `total` records are collected, a short page arrives, or
 * `keep` says the page has crossed into records already held.
 *
 * The class-A counterpart to `pageAll`: `pageAll` fetches a COMPLETE set and the caller replaces
 * it; this fetches the newest slice and the caller upserts it.
 */
export async function pageNewestFirst(options: {
  ctx: SyncContext;
  url: string;
  collectionKey?: string | null;
  params: Record<string, unknown>;
  total: number;
  batchSize: number;
  /** Narrow a page to the records worth keeping; returning fewer than given stops paging. */
  keep?: (page: any[]) => any[];
  maxPages?: number;
  /** Identifies the domain in diagnostics. Defaults to `url`. */
  label?: string;
}): Promise<any[]> {
  const { ctx, url, collectionKey, params, total, batchSize, keep, maxPages = 40, label = url } = options;
  const collected: any[] = [];
  let pageIndex = 0;

  for (; pageIndex < maxPages && collected.length < total; pageIndex++) {
    const resp = await workerGet(ctx, url, { ...params, pageSize: batchSize, pageIndex });
    const page: any[] = unwrapCollection(resp, collectionKey);
    if (!page.length) break;

    if (keep) {
      const fresh = keep(page);
      collected.push(...fresh);
      if (fresh.length < page.length) break; // crossed into already-cached records
    } else {
      collected.push(...page);
    }

    if (page.length < batchSize) break; // last page
  }

  if (pageIndex >= maxPages && collected.length < total) {
    console.warn(
      `[db] ${label}: stopped at the ${maxPages}-page backstop after ${collected.length} records — the set may be TRUNCATED.`,
    );
  }

  return collected.slice(0, total);
}