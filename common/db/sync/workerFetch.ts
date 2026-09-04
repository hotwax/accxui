/**
 * Worker-thread read transport.
 */

import workerRemoteApi from "../../core/workerRemoteApi";
import type { SyncContext } from "../types";

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

function isEmptyBodyError(err: any): boolean {
  if (!(err instanceof SyntaxError)) return false;
  return /unexpected end of (json )?input/i.test(String(err?.message ?? ""));
}

export async function workerGet(
  ctx: SyncContext,
  url: string,
  params: Record<string, unknown> = {},
): Promise<any> {
  try {
    const queryString = toQueryString(params);
    const maargUrl = (ctx.maargUrl as string) || "";
    return await workerRemoteApi({
      baseURL: maargUrl,
      url: queryString ? `${url}?${queryString}` : url,
      method: "GET",
      headers: { Authorization: `Bearer ${ctx.token}` },
    });
  } catch (err: any) {
    if (isEmptyBodyError(err)) return null;
    throw err;
  }
}

export async function workerPost(
  ctx: SyncContext,
  url: string,
  data: Record<string, unknown> = {},
): Promise<any> {
  try {
    const maargUrl = (ctx.maargUrl as string) || "";
    return await workerRemoteApi({
      baseURL: maargUrl,
      url,
      method: "POST",
      headers: { Authorization: `Bearer ${ctx.token}` },
      data,
    });
  } catch (err: any) {
    if (isEmptyBodyError(err)) return null;
    throw err;
  }
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

export async function pageAll(options: {
  ctx: SyncContext;
  url: string;
  collectionKey?: string | null;
  params?: Record<string, unknown>;
  batchSize?: number;
  unpaged?: boolean;
  keyOf: (record: any) => string | undefined;
  maxPages?: number;
}): Promise<any[]> {
  const { ctx, url, collectionKey, params = {}, batchSize = 250, unpaged = false, keyOf, maxPages = 40 } = options;
  if (unpaged || batchSize === 0) {
    // Single request, but still ask for a full page: Moqui defaults to 20 rows when no page
    // size is given, which silently truncates a snapshot to its first 20 records.
    const singlePageSize = batchSize || 250;
    const resp = await workerGet(ctx, url, { ...params, pageSize: singlePageSize, viewSize: singlePageSize });
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
