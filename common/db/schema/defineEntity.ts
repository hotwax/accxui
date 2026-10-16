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

import type { FieldKind, FieldSpec, NestedFields } from "../types";

export interface EntityDefinition {
  /** Comma-separated pk field(s). One field → plain keyPath; many → Dexie compound key. */
  primaryKey: string;
  /**
   * The projection: stored field → what it holds. A scalar kind, a nested object of declared
   * fields, or a one-element array for a list of either. Every pk field must appear here, as a
   * top-level scalar.
   */
  fields: NestedFields;
  /**
   * Secondary indexes. Must be declared fields; must not restate the pk. A nested field is indexed
   * by its dotted path (`customer.partyId`). A field reached through a list takes the multi-value
   * form, `*identifications.idValue` (or `*tags` for a list of scalars), and matches a row when ANY
   * of its values does.
   */
  indexes?: string[];
  /**
   * Stored-field name → source field to read from when the API names it differently. A nested
   * field is named by its dotted stored path, `customer.fullName`, and the value is the source
   * key inside that same parent object. Lists do not appear in the path: `identifications.idValue`
   * renames the field on every item.
   */
  rename?: Record<string, string>;
  /**
   * Stand-in values for primary-key members the server may legitimately omit. Without one, a row
   * missing ANY key member is dropped as unkeyable; with one, the member is stored as this value.
   * Use only where absence is a real state (a document attached to no feed), never to paper over a
   * wrong field name.
   */
  keyDefaults?: Record<string, string | number>;
  /**
   * Keep this table's rows when the user logs out; every other table is emptied. Only for data that
   * is the same for every user of the OMS instance (a product catalog), never for anything scoped to
   * the signed-in user. The rows still go on a schema version bump, which rebuilds the database.
   */
  retainOnLogout?: boolean;
}

export interface Entity {
  /** Normalized: a bare string for one field, an array for a composite key. */
  primaryKey: string | string[];
  /** Always an array, so callers can iterate without a type check. */
  primaryKeyFields: string[];
  fields: NestedFields;
  /** Declaration order — the top-level projection field list. */
  fieldNames: string[];
  indexes: string[];
  /**
   * Multi-value indexes on a field reached through a list of objects: dotted path → the hidden
   * top-level field that holds every value at that path, flattened. IndexedDB cannot index into
   * an array of objects, so projection writes this array and the index is declared on it.
   */
  listIndexes: Record<string, string>;
  rename?: Record<string, string>;
  keyDefaults?: Record<string, string | number>;
  /** Present, and true, only when the definition asked for it. */
  retainOnLogout?: true;
  /** The derived Dexie `stores()` string. */
  schema: string;
}

const SCALAR_KINDS: ReadonlySet<string> = new Set<FieldKind>(["text", "count", "date"]);
const ALL_KINDS: ReadonlySet<string> = new Set<FieldKind>(["text", "count", "date", "structured"]);

function isScalar(spec: FieldSpec): boolean {
  return isFieldKind(spec) && SCALAR_KINDS.has(spec);
}

export function isFieldKind(spec: FieldSpec): spec is FieldKind {
  return typeof spec === "string";
}

export function isListSpec(spec: FieldSpec): spec is readonly [FieldKind | NestedFields] {
  return Array.isArray(spec);
}

export function isObjectSpec(spec: FieldSpec): spec is NestedFields {
  return typeof spec === "object" && spec !== null && !Array.isArray(spec);
}

/**
 * The stored field behind a multi-value index on a path that crosses a list of objects.
 * `$` cannot occur in a declared field name, so it cannot collide with one.
 */
export function listIndexField(path: string): string {
  return path.split(".").join("$");
}

/** The declaration at a dotted path, and whether reaching it went through a list. */
export interface ResolvedPath {
  spec: FieldSpec;
  /** The path passed through a list (of objects) before its last segment. */
  throughList: boolean;
}

/**
 * Follow a dotted stored path through nested declarations. Lists are transparent: their item
 * declaration is followed. Undefined when any segment is not declared.
 */
export function resolveFieldPath(fields: NestedFields, path: string): ResolvedPath | undefined {
  let current: FieldSpec = fields;
  let throughList = false;

  for (const segment of path.split(".")) {
    if(isListSpec(current)) {
      current = current[0];
      throughList = true;
    }
    if(!isObjectSpec(current) || !Object.prototype.hasOwnProperty.call(current, segment)) return undefined;
    current = current[segment];
  }

  return { spec: current, throughList };
}

function validateFields(fields: NestedFields, path: string): void {
  const names = Object.keys(fields);
  if(path && names.length === 0) {
    throw new Error(`[db] defineEntity: nested field "${path}" declares no fields. Use "structured" to store it as-is.`);
  }

  for (const name of names) {
    const at = path ? `${path}.${name}` : name;
    if(!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) {
      throw new Error(`[db] defineEntity: field name "${at}" must be a plain identifier (no "." or "$").`);
    }
    validateSpec(fields[name], at);
  }
}

function validateSpec(spec: FieldSpec, at: string): void {
  if(isFieldKind(spec)) {
    if(!ALL_KINDS.has(spec)) throw new Error(`[db] defineEntity: field "${at}" has unknown kind "${spec}".`);
    return;
  }
  if(isListSpec(spec)) {
    if(spec.length !== 1) {
      throw new Error(`[db] defineEntity: list field "${at}" must declare exactly one item spec, e.g. [{ … }] or ["text"].`);
    }
    if(isListSpec(spec[0])) {
      throw new Error(`[db] defineEntity: list field "${at}" holds a list directly; wrap the inner list in an object.`);
    }
    validateSpec(spec[0], at);
    return;
  }
  if(isObjectSpec(spec)) {
    validateFields(spec, at);
    return;
  }
  throw new Error(`[db] defineEntity: field "${at}" has an invalid declaration.`);
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
  validateFields(def.fields, "");

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
    const spec = def.fields[field];
    if(!isFieldKind(spec) || !SCALAR_KINDS.has(spec)) {
      throw new Error(`[db] defineEntity: primary-key field "${field}" must be a text, count or date field.`);
    }
  }

  for (const field of Object.keys(def.keyDefaults ?? {})) {
    if(!seenPkFields.has(field)) {
      throw new Error(`[db] defineEntity: \`keyDefaults\` names "${field}", which is not a primary-key field.`);
    }
  }

  const primaryKey = primaryKeyFields.length === 1 ? primaryKeyFields[0] : primaryKeyFields;
  const keyPath = primaryKeyFields.length === 1
    ? primaryKeyFields[0]
    : `[${primaryKeyFields.join("+")}]`;

  const indexes = def.indexes ?? [];
  const seenIndexes = new Set<string>();
  const listIndexes: Record<string, string> = {};
  /** What each declared index becomes in the Dexie string — a list index is declared on its hidden field. */
  const storeIndexes: string[] = [];

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

    const compound = /^\[([A-Za-z0-9_.]+(?:\+[A-Za-z0-9_.]+)+)\]$/.exec(index);
    if(compound) {
      for (const member of compound[1].split("+")) {
        const resolved = resolveFieldPath(def.fields, member);
        if(!resolved) {
          throw new Error(
            `[db] defineEntity: compound index "${index}" names "${member}", which is not declared in \`fields\`.`,
          );
        }
        if(resolved.throughList || isListSpec(resolved.spec)) {
          throw new Error(
            `[db] defineEntity: compound index "${index}" names "${member}", which is inside a list. ` +
            "IndexedDB cannot combine a multi-value index with other fields; index it alone as `*" + member + "`.",
          );
        }
        if(member.includes(".") && !isScalar(resolved.spec)) {
          throw new Error(`[db] defineEntity: compound index "${index}" names "${member}", which is not a text, count or date field.`);
        }
      }
      storeIndexes.push(index); // emitted verbatim; members are individually indexed only if also listed separately
      continue;
    }

    if(index.startsWith("*")) {
      const path = index.slice(1);
      const resolved = resolveFieldPath(def.fields, path);
      if(!resolved) {
        throw new Error(
          `[db] defineEntity: index "${index}" is not declared in \`fields\`. ` +
          "An index on an unprojected field is never populated.",
        );
      }
      const scalarList = isListSpec(resolved.spec) && isScalar(resolved.spec[0]);
      if(resolved.throughList && (isScalar(resolved.spec) || scalarList)) {
        listIndexes[path] = listIndexField(path);
        storeIndexes.push(`*${listIndexes[path]}`);
      } else if(scalarList) {
        storeIndexes.push(index); // a list of scalars on a plain path: IndexedDB indexes it natively
      } else {
        throw new Error(
          `[db] defineEntity: multi-value index "${index}" must end at a text, count or date value inside a list. ` +
          (resolved.throughList || isListSpec(resolved.spec) ? "" : `"${path}" is a single value; index it without "*".`),
        );
      }
      continue;
    }

    const resolved = resolveFieldPath(def.fields, index);
    if(!resolved) {
      throw new Error(
        `[db] defineEntity: index "${index}" is not declared in \`fields\`. ` +
        "An index on an unprojected field is never populated.",
      );
    }
    if(resolved.throughList) {
      throw new Error(`[db] defineEntity: index "${index}" is inside a list; declare it as "*${index}" to match any of its values.`);
    }
    if(index.includes(".") && !isScalar(resolved.spec)) {
      throw new Error(`[db] defineEntity: index "${index}" is not a text, count or date field.`);
    }
    storeIndexes.push(index);
  }

  for (const field of Object.keys(def.rename ?? {})) {
    if(field.includes(".") && !resolveFieldPath(def.fields, field)) {
      throw new Error(`[db] defineEntity: \`rename\` names "${field}", which is not declared in \`fields\`.`);
    }
  }

  return {
    primaryKey,
    primaryKeyFields,
    fields: def.fields,
    fieldNames: Object.keys(def.fields),
    indexes: [...indexes],
    listIndexes,
    ...(def.rename ? { rename: def.rename } : {}),
    ...(def.keyDefaults ? { keyDefaults: def.keyDefaults } : {}),
    ...(def.retainOnLogout ? { retainOnLogout: true as const } : {}),
    schema: [keyPath, ...storeIndexes].join(", "),
  };
}
