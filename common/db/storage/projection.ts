/**
 * Pure projection + diff helpers for the local database.
 *
 * Deliberately free of Dexie and Vue so every rule here is unit-testable without IndexedDB.
 */

import { isFieldKind, isListSpec, type Entity } from "../model/defineEntity";
import type { DbKey, DbRow, FieldKind, FieldSpec, NestedFields } from "../types";

/** Coerce a server date field (epoch-millis number, numeric string, or ISO string) to millis. */
export function toMillis(value: unknown): number | undefined {
  if (value === null || value === undefined || value === "") return undefined;
  if (typeof value === "number") return Number.isFinite(value) ? value : undefined;
  const numeric = Number(value);
  if (Number.isFinite(numeric)) return numeric;
  const parsed = Date.parse(String(value));
  return Number.isNaN(parsed) ? undefined : parsed;
}

/** Coerce a server count field to a number, or undefined when absent/unparseable. */
export function toCount(value: unknown): number | undefined {
  if (value === null || value === undefined || value === "") return undefined;
  const n = Number(value);
  return Number.isFinite(n) ? n : undefined;
}

/** Coerce to a trimmed string, or undefined when absent. */
export function toText(value: unknown): string | undefined {
  if (value === null || value === undefined) return undefined;
  const text = String(value).trim();
  return text === "" ? undefined : text;
}

const COERCE: Record<FieldKind, (value: unknown) => unknown> = {
  text: toText,
  count: toCount,
  date: toMillis,
  // Passed through as-is. An empty array stays `[]`: a stored row IS what screens read, and a list
  // field that disappears when it is empty is read as `undefined.length` by every caller.
  structured: (value) => value ?? undefined,
};

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Project the declared fields of one object. `path` is the stored path of `source` itself ("" at
 * the top level), so a nested rename is looked up as `customer.fullName`.
 */
function projectFields(
  source: Record<string, unknown>,
  fields: NestedFields,
  path: string,
  rename: Record<string, string> | undefined,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};

  for (const [field, spec] of Object.entries(fields)) {
    const at = path ? `${path}.${field}` : field;
    const key = source[field] !== undefined ? field : rename?.[at] ?? field;
    const value = projectValue(source[key], spec, at, rename);
    if (value !== undefined) out[field] = value;
  }

  return out;
}

/** Coerce one value by its declaration, recursing into nested objects and lists. */
function projectValue(
  value: unknown,
  spec: FieldSpec,
  path: string,
  rename: Record<string, string> | undefined,
): unknown {
  if (isFieldKind(spec)) return COERCE[spec](value);

  if (isListSpec(spec)) {
    if (!Array.isArray(value)) return undefined;
    // An item that cannot be projected (a non-object where objects are declared, an empty text) is
    // dropped; the list itself stays, even when empty, for the same reason `structured` keeps `[]`.
    const items: unknown[] = [];
    for (const item of value) {
      const projected = projectValue(item, spec[0], path, rename);
      if (projected !== undefined) items.push(projected);
    }
    return items;
  }

  return isPlainObject(value) ? projectFields(value, spec, path, rename) : undefined;
}

/**
 * Every value at a dotted path, with lists fanned out: `identifications.idValue` on a row with two
 * identifications yields both ids. A plain path to a single value yields that one value.
 */
export function valuesAtPath(source: unknown, path: string): unknown[] {
  let current: unknown[] = [source];

  for (const segment of path.split(".")) {
    const next: unknown[] = [];
    for (const value of current) {
      for (const item of Array.isArray(value) ? value : [value]) {
        if (isPlainObject(item) && item[segment] !== undefined) next.push(item[segment]);
      }
    }
    current = next;
  }

  return current.flatMap((value) => (Array.isArray(value) ? value : [value]));
}

/**
 * Project one raw server record into a stored row.
 *
 * The stored row is the DECLARED fields plus `syncedAt` — nothing else, at every level: a nested
 * object keeps only its declared fields, and its leaves are coerced by kind like top-level ones.
 * The untouched server payload is deliberately not kept alongside it: storing both doubles every
 * row, and a field a screen needs belongs in `fields` where the schema can index and coerce it.
 *
 * A multi-value index on a field inside a list of objects also writes its hidden flattened field
 * (`identifications$idValue`), the only thing IndexedDB can index for it.
 *
 * Returns null when the record cannot be keyed — for a compound key that means ANY member failed to
 * project. There is no synthetic key to build: the key members are ordinary declared fields, so
 * they are coerced by their declared kind like everything else.
 */
export function projectRow(
  raw: Record<string, unknown>,
  entity: Entity,
  now: number,
): DbRow | null {
  const row = projectFields(isPlainObject(raw) ? raw : {}, entity.fields, "", entity.rename);

  // A key member the server legitimately leaves empty takes its declared stand-in, so the row is
  // kept rather than dropped as unkeyable.
  for (const [field, fallback] of Object.entries(entity.keyDefaults ?? {})) {
    if (row[field] === undefined) row[field] = fallback;
  }

  for (const field of entity.primaryKeyFields) {
    if (row[field] === undefined) return null;
  }

  for (const [path, field] of Object.entries(entity.listIndexes ?? {})) {
    row[field] = [...new Set(valuesAtPath(row, path))];
  }

  return { ...row, syncedAt: now } as DbRow;
}

/** Project many records, dropping any without a usable key. */
export function projectRows(
  rawRows: Array<Record<string, unknown>>,
  entity: Entity,
  now: number,
): DbRow[] {
  const rows: DbRow[] = [];
  for (const raw of rawRows) {
    const row = projectRow(raw, entity, now);
    if (row) rows.push(row);
  }
  return rows;
}

/**
 * True when a fetch returned records but the projection can key NONE of them.
 */
export function isUnkeyableFetch(
  rawRows: Array<Record<string, unknown>>,
  entity: Entity,
): boolean {
  return rawRows.length > 0 && projectRows(rawRows, entity, 0).length === 0;
}

/**
 * `|` occurs in real OFBiz ids, so joining on it would make `["A","B"]` and the single id `"A|B"`
 * indistinguishable. NUL cannot occur in one.
 */
const KEY_SEPARATOR = "\u0000";

/** A compound key flattened to a value-comparable string, for Set and Map membership. */
export function canonicalKey(key: DbKey): string {
  return Array.isArray(key) ? key.join(KEY_SEPARATOR) : String(key);
}

/**
 * The primary key of a stored row: a scalar for a single-field key, an array in declared order for
 * a compound one. Undefined when any member is absent, which means the row cannot be stored.
 */
export function entityKeyOf(row: Record<string, unknown>, entity: Entity): DbKey | undefined {
  const values: Array<string | number> = [];

  for (const field of entity.primaryKeyFields) {
    const value = row?.[field];
    if (value === undefined || value === null) return undefined;
    // "" is a real key value only for a member that declares it as its stand-in.
    if (value === "" && entity.keyDefaults?.[field] !== "") return undefined;
    values.push(typeof value === "number" ? value : String(value));
  }

  return values.length === 1 ? values[0] : values;
}

/**
 * Keys to delete after a snapshot sync: everything stored that the fresh full set no longer
 * contains. Compares through `canonicalKey` because a Set compares arrays by identity, but returns
 * the ORIGINAL key form so the result can be handed straight to `bulkDelete`.
 */
export function diffStaleKeys(existingKeys: readonly DbKey[], freshKeys: readonly DbKey[]): DbKey[] {
  const fresh = new Set(freshKeys.map(canonicalKey));
  return existingKeys.filter((key) => !fresh.has(canonicalKey(key)));
}

/**
 * The newest value of `dateField` across the given rows.
 */
export function newestValue(rows: ReadonlyArray<Record<string, unknown>>, dateField: string): number | undefined {
  let newest: number | undefined;
  for (const row of rows) {
    const value = row?.[dateField];
    if (typeof value === "number" && (newest === undefined || value > newest)) newest = value;
  }
  return newest;
}

/**
 * Keep only records strictly newer than the cursor.
 */
export function keepNewerThan(
  rawRows: Array<Record<string, unknown>>,
  dateField: string,
  cursor: number,
): Array<Record<string, unknown>> {
  return rawRows.filter((raw) => (toMillis(raw?.[dateField]) ?? 0) > cursor);
}

/**
 * Is this date-effective row in force at `now`?
 *
 * Moqui models association lifetimes as `fromDate`/`thruDate` rather than deleting rows.
 * Treat a `thruDate` strictly less than or equal to `now` as expired.
 */
export function isEffectiveNow(row: Record<string, unknown> | undefined, now: number): boolean {
  const from = toMillis(row?.fromDate);
  const thru = toMillis(row?.thruDate);
  if (from !== undefined && from > now) return false;
  if (thru !== undefined && thru <= now) return false;
  return true;
}

