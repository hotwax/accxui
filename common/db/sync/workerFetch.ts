/**
 * Worker-thread read transport.
 */

import workerRemoteApi from "../../core/workerRemoteApi";
import type { SyncContext } from "../types";

export async function workerGet(
  ctx: SyncContext,
  url: string,
  params: Record<string, unknown> = {},
): Promise<any> {
  // Array params and empty bodies are the transport's problem now — see common/core/workerRemoteApi.
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
  /** Identifies the domain in diagnostics. Defaults to `url`. */
  label?: string;
}): Promise<any[]> {
  const { ctx, url, collectionKey, params, total, batchSize, keep, label = url } = options;
  const collected: any[] = [];

  for (let pageIndex = 0; collected.length < total; pageIndex++) {
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

  return collected.slice(0, total);
}
