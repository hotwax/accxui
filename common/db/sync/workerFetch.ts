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
  keyOf: (record: any) => string | undefined;
  maxPages?: number;
}): Promise<any[]> {
  const {
    ctx, url, collectionKey, strictCollection = false, params = {},
    batchSize = 250, unpaged = false, keyOf, maxPages = 40,
  } = options;
  if (unpaged || batchSize === 0) {
    // Single request, but still ask for a full page: Moqui defaults to 20 rows when no page
    // size is given, which silently truncates a snapshot to its first 20 records.
    const singlePageSize = batchSize || 250;
    const resp = await workerGet(ctx, url, { ...params, pageSize: singlePageSize, viewSize: singlePageSize });
    if (strictCollection) assertCollectionShape(resp, collectionKey, url);
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
    if (strictCollection) assertCollectionShape(resp, collectionKey, url);
    const rows = unwrapCollection(resp, collectionKey);
    if (!rows || rows.length === 0) break;

    let newKeysCount = 0;
    for (const row of rows) {
      const key = keyOf(row);
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

    if (rows.length < batchSize || newKeysCount === 0) break;
    pageIndex++;
  }

  return all;
}
