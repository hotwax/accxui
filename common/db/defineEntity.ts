/**
 * One declaration per IndexedDB entity.
 *
 * An entity used to be declared twice — a hand-written Dexie schema string in SEED_ENTITIES and a
 * separate EntityProjection listing the stored fields — and nothing checked that the two agreed.
 * `defineEntity` takes both concerns at once and DERIVES the Dexie string, so an index on a field
 * the projection never writes is a throw at module-evaluation time rather than a permanently empty
 * index nobody notices.
 *
 * Imports only `./types`. This module is reachable from app db modules, which the sync workers
 * import, and Vite must emit those chunks as a single iife — so it must never pull in `vue`,
 * `commonUtil` or the `@common/db` barrel.
 */

import type { FieldKind } from "./types";

export interface EntityDefinition {
  /** Comma-separated pk field(s). One field → plain keyPath; many → Dexie compound key. */
  primaryKey: string;
  /** The projection: stored field → coercion kind. Every pk field must appear here. */
  fields: Record<string, FieldKind>;
  /** Secondary indexes. Must be declared fields; must not restate the pk. */
  indexes?: string[];
  /** Stored-field name → source field to read from when the API names it differently. */
  rename?: Record<string, string>;
}

export interface Entity {
  /** Normalized: a bare string for one field, an array for a composite key. */
  primaryKey: string | string[];
  /** Always an array, so callers can iterate without a type check. */
  primaryKeyFields: string[];
  fields: Record<string, FieldKind>;
  /** Declaration order — the projection field list. */
  fieldNames: string[];
  indexes: string[];
  rename?: Record<string, string>;
  /** The derived Dexie `stores()` string. */
  schema: string;
}

/**
 * Split a comma-separated primary key into the shape Dexie needs: one field stays a bare
 * string, several become an array that is emitted as `[a+b]`.
 */
export function normalizePrimaryKey(primaryKey: string): string | string[] {
  const fields = primaryKey
    .split(",")
    .map((field) => field.trim())
    .filter(Boolean);

  return fields.length === 1 ? fields[0] : fields;
}

export function defineEntity(def: EntityDefinition): Entity {
  const primaryKeyFields = def.primaryKey
    .split(",")
    .map((field) => field.trim())
    .filter(Boolean);

  if(primaryKeyFields.length === 0) {
    throw new Error("[db] defineEntity: a non-empty `primaryKey` is required.");
  }

  const seenPkFields = new Set<string>();
  for (const field of primaryKeyFields) {
    if(seenPkFields.has(field)) {
      throw new Error(`[db] defineEntity: \`primaryKey\` repeats field "${field}".`);
    }
    seenPkFields.add(field);

    if(!(field in def.fields)) {
      throw new Error(
        `[db] defineEntity: primary-key field "${field}" is not declared in \`fields\`. ` +
        "A key member that is never stored cannot be satisfied.",
      );
    }
  }

  const primaryKey = primaryKeyFields.length === 1 ? primaryKeyFields[0] : primaryKeyFields;
  const keyPath = primaryKeyFields.length === 1
    ? primaryKeyFields[0]
    : `[${primaryKeyFields.join("+")}]`;

  const indexes = def.indexes ?? [];
  const seenIndexes = new Set<string>();

  for (const index of indexes) {
    if(seenIndexes.has(index)) {
      throw new Error(`[db] defineEntity: duplicate index "${index}".`);
    }
    seenIndexes.add(index);

    if(index === keyPath) {
      throw new Error(
        `[db] defineEntity: index "${index}" restates the primary key. Dexie indexes the key path already.`,
      );
    }

    const compound = /^\[([A-Za-z0-9_]+(?:\+[A-Za-z0-9_]+)+)\]$/.exec(index);
    if(compound) {
      for (const member of compound[1].split("+")) {
        if(!(member in def.fields)) {
          throw new Error(
            `[db] defineEntity: compound index "${index}" names "${member}", which is not declared in \`fields\`.`,
          );
        }
      }
      continue; // emitted verbatim; members are individually indexed only if also listed separately
    }

    if(!(index in def.fields)) {
      throw new Error(
        `[db] defineEntity: index "${index}" is not declared in \`fields\`. ` +
        "An index on an unprojected field is never populated.",
      );
    }
  }

  return {
    primaryKey,
    primaryKeyFields,
    fields: def.fields,
    fieldNames: Object.keys(def.fields),
    indexes: [...indexes],
    ...(def.rename ? { rename: def.rename } : {}),
    schema: [keyPath, ...indexes].join(", "),
  };
}
