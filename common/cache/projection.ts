/**
 * Pure projection + diff helpers for the local cache.
 *
 * Deliberately free of Dexie and Vue so every rule here is unit-testable without IndexedDB.
 */

import type { CachedRow, EntityProjection, FieldKind } from "./types";

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
  structured: (value) => (Array.isArray(value) && value.length === 0 ? undefined : value ?? undefined),
};

/**
 * Project one raw server record into a cached row. Returns null when the record has no usable primary key.
 */
export function projectRow(
  raw: Record<string, unknown>,
  projection: EntityProjection,
  now: number,
): CachedRow | null {
  const row: Record<string, unknown> = {};
  for (const [field, kind] of Object.entries(projection.fields)) {
    const source = raw?.[field] !== undefined ? field : projection.rename?.[field] ?? field;
    const value = COERCE[kind](raw?.[source]);
    if (value !== undefined) row[field] = value;
  }

  const key = projection.buildKey ? projection.buildKey(raw) : toText(raw?.[projection.keyField]);
  if (!key) return null;
  row[projection.keyField] = key;

  return { ...row, raw, cachedAt: now } as CachedRow;
}

/** Project many records, dropping any without a usable key. */
export function projectRows(
  rawRows: Array<Record<string, unknown>>,
  projection: EntityProjection,
  now: number,
): CachedRow[] {
  const rows: CachedRow[] = [];
  for (const raw of rawRows) {
    const row = projectRow(raw, projection, now);
    if (row) rows.push(row);
  }
  return rows;
}

/**
 * True when a fetch returned records but the projection can key NONE of them.
 */
export function isUnkeyableFetch(
  rawRows: Array<Record<string, unknown>>,
  projection: EntityProjection,
): boolean {
  return rawRows.length > 0 && projectRows(rawRows, projection, 0).length === 0;
}

/**
 * Keys to delete after a snapshot sync: everything cached that the fresh full set no longer contains.
 */
export function diffStaleKeys(existingKeys: readonly string[], freshKeys: readonly string[]): string[] {
  const fresh = new Set(freshKeys);
  return existingKeys.filter((key) => !fresh.has(key));
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
