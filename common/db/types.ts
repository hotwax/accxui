/**
 * Shared Type Definitions for the AccxUI Local Database Framework.
 */

/** A stored row: the projected fields, plus when they were synced. */
export interface DbRow {
  [field: string]: unknown;
  syncedAt: number;
}

/**
 * A stored row's primary key. A scalar for a single-field key; an array, in the entity's declared
 * field order, for a Dexie compound key (`[a+b]`).
 */
export type DbKey = string | number | Array<string | number>;

export type FieldKind = "text" | "count" | "date" | "structured";

export interface QueryOptions {
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
  filter?: (row: DbRow) => boolean;
  /** Maximum number of records to return. */
  limit?: number;
  /** Sort order for indexed queries ('asc' | 'desc'). Default: 'desc' when dateField is specified. */
  order?: "asc" | "desc";
}

export interface SyncContext {
  token: string;
  now: number;
  /** OMS instance being synced. Databases are per-OMS, and the worker cannot read it from cookies. */
  omsInstance: string;
  [key: string]: unknown;
}

export interface SyncDomain {
  name: string;
  /** Status-card text. Required from Phase B. */
  label: string;
  /**
   * A: cadenced, polled while a view that needs it is open.
   * B: reference/config — once per login, then only on mutation.
   * C: write-through only — never ticked, but still listed and still refetchable.
   */
  syncClass: "A" | "B" | "C";
  /** Poll cadence for class A. Omit for B and C. `ActiveDomain.intervalMs` overrides it. */
  intervalMs?: number;
  sync: (ctx: SyncContext, args?: unknown, options?: { force?: boolean }) => Promise<number | void>;
  /**
   * Refetch one record after a mutation.
   *
   * Context FIRST, like `sync` — a harness holds one context and hands it to whichever domain is
   * due, and it cannot tell a factory-built domain from a hand-written one. When the two orders
   * disagree the mismatch is silent: the domain reads its key fields off the context (all
   * `undefined`) and issues the request with the primary key where the token belongs, while the
   * mutation that triggered it has already succeeded.
   */
  refetchOne?: (
    ctx: SyncContext,
    pk: Record<string, unknown>,
    args?: unknown,
  ) => Promise<number | void>;
}


export type DbSchemaDefinition = Record<string, string>;
