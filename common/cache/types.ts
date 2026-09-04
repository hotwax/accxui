/**
 * Shared Type Definitions for the AccxUI Cache Framework.
 */

import type { Observable } from "dexie";

/** A cached row: indexed/normalized fields + untouched server object in raw. */
export interface CachedRow {
  [field: string]: unknown;
  raw: Record<string, unknown>;
  cachedAt: number;
}

export type FieldKind = "text" | "count" | "date" | "structured";

export interface EntityProjection {
  /** Primary-key field name on the cached row (must project to a non-empty string). */
  keyField: string;
  /** Field name -> how to coerce it. Every listed field is hoisted to the row's top level. */
  fields: Record<string, FieldKind>;
  /** Optional synthetic key builder for entities with composite natural keys. */
  buildKey?: (raw: Record<string, unknown>) => string | undefined;
  /** Cached-field name -> source field to read from if different. */
  rename?: Record<string, string>;
}

export interface LiveQueryOptions {
  /** Filter by an indexed field via where(scope.field).equals(scope.value). */
  scope?: { field: string; value: unknown };
  /** Multiple equalities resolved through an indexed field. */
  equals?: Record<string, unknown>;
  /** Restrict to rows on or after this timestamp millis. */
  since?: number;
  /** Restrict to rows on or before this timestamp millis. */
  until?: number;
  /** Date field to apply since/until bounds to. */
  dateField?: string;
  /** In-memory predicate applied to the matched set. */
  filter?: (row: CachedRow) => boolean;
  /** Maximum number of records to return. */
  limit?: number;
  /** Sort order for indexed queries ('asc' | 'desc'). Default: 'desc' when dateField is specified. */
  order?: "asc" | "desc";
}

export interface CachedEntity<T = Record<string, any>> {
  table: string;
  projection: EntityProjection;
  /** Live reactive query over the table. */
  live: (options?: LiveQueryOptions) => Observable<CachedRow[]>;
  /** Read a single record by primary key (instant lookup). */
  get: (key: string) => Promise<T | undefined>;
  /** Read all records matching options (promise-based snapshot). */
  all: (options?: LiveQueryOptions) => Promise<T[]>;
}

export interface SyncContext {
  token: string;
  now: number;
  [key: string]: unknown;
}

export interface SyncDomain {
  name: string;
  cadenceMs?: number;
  sync: (ctx: SyncContext) => Promise<void>;
  refetchOne?: (pk: Record<string, unknown>, ctx: SyncContext) => Promise<void>;
}

export type CacheSchemaDefinition = Record<string, string>;
