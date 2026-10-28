/**
 * Composition of many entities into one app's Dexie schema.
 *
 * `defineSchema` keys entities by their IndexedDB STORE NAME, so its `stores` output maps 1:1 onto
 * what `version().stores()` wants and there is no domain/table split to keep aligned. `pick`,
 * `extendIndexes`, `extendEntities` and `mergeSchemas` all return a fresh AppSchema and never mutate
 * their input, so a framework-owned schema can be picked from by several apps at once.
 *
 * Imports only `./defineEntity` and `../types`, for the same worker-bundle reason stated there.
 */

import { defineEntity, isListSpec, isObjectSpec, resolveFieldPath, type Entity } from "./defineEntity";
import type { FieldSpec, NestedFields } from "../types";

/**
 * What an app adds to an entity it did not declare. Additive only: the primary key, key defaults
 * and every existing field, index and rename stay as declared.
 */
export interface EntityExtension {
  /**
   * New stored fields. Naming a field the entity already declares throws — except a nested object
   * (or list of objects), whose declaration is merged into: `customer: { email: "text" }` adds
   * `email` to an existing `customer`.
   */
  fields?: NestedFields;
  /** Extra secondary indexes, on the entity's own fields or the ones added here. */
  indexes?: string[];
  /**
   * Stored-field name → server field name, for any declared field the entity does not rename yet.
   * A nested field is named by its dotted path, as in `defineEntity`.
   */
  rename?: Record<string, string>;
}

/** Every table of a schema as `{ facilities: "facilities", … }`: names autocomplete and a typo fails to compile. */
export type TableNames<Tables extends string> = { readonly [Table in Tables]: Table };

/**
 * `Tables` is the schema's table names as a type, inferred from the map `defineSchema` is given and
 * carried through `pick` and `mergeSchemas`, so an app database built from it type-checks every
 * table name against what that app actually declared.
 */
export interface AppSchema<Tables extends string = string> {
  /** Keyed by table name. */
  entities: Record<Tables, Entity>;
  /**
   * The table names, `{ facilities: "facilities", … }`. Static — no database is involved — and
   * narrowed by `pick` / combined by `mergeSchemas` like `entities`.
   */
  tables: TableNames<Tables>;
  /** Table name → Dexie schema string, ready for `version().stores()`. `syncMeta` is not included — BaseDB adds it. */
  stores: Record<Tables, string>;
  /** Tables that came from a framework module schema. An app's own tables are absent, even when the name matches. */
  frameworkTables: ReadonlySet<string>;
  /** A subset of this schema. Throws on a table this schema does not have. */
  pick<Picked extends Tables>(tables: readonly Picked[]): AppSchema<Picked>;
  /** Extra secondary indexes appended after an entity's own. Throws on an unknown table, a pk restatement, or an unprojected field. */
  extendIndexes(map: Partial<Record<Tables, string[]>>): AppSchema<Tables>;
  /**
   * Fields, indexes and renames added to entities this schema already has — the app-side way to
   * widen a framework entity. Sync domains project through the app's composed entity, so added
   * fields are stored without touching the domain. Throws on an unknown table, a field already
   * declared, a rename of an undeclared or already-renamed field, or an index `defineEntity` rejects.
   */
  extendEntities(map: Partial<Record<Tables, EntityExtension>>): AppSchema<Tables>;
}

/** The table names of a schema type. */
export type TablesOf<Schema> = Schema extends AppSchema<infer Tables> ? Tables : never;

/**
 * Add `added` to `base` without replacing anything: a new name is added, and a nested object (or
 * list of objects) on both sides is merged recursively. Any other overlap throws, naming the path.
 */
function mergeFields(table: string, base: NestedFields, added: NestedFields, path: string): NestedFields {
  const merged: NestedFields = { ...base };

  for (const [field, spec] of Object.entries(added)) {
    const at = path ? `${path}.${field}` : field;
    const existing = base[field];
    if(existing === undefined) {
      merged[field] = spec;
    } else if(isObjectSpec(existing) && isObjectSpec(spec)) {
      merged[field] = mergeFields(table, existing, spec, at);
    } else if(isListSpec(existing) && isListSpec(spec) && isObjectSpec(existing[0]) && isObjectSpec(spec[0])) {
      merged[field] = [mergeFields(table, existing[0], spec[0], at)] as FieldSpec;
    } else {
      throw new Error(`[db] defineSchema: extendEntities: "${table}" already declares field "${at}".`);
    }
  }

  return merged;
}

function storesOf(entities: Record<string, Entity>): Record<string, string> {
  const stores: Record<string, string> = {};
  for (const [table, entity] of Object.entries(entities)) {
    stores[table] = entity.schema;
  }
  return stores;
}

// The table names are a compile-time view; at runtime every map is keyed by plain strings.
function build<Tables extends string>(entities: Record<string, Entity>, frameworkTables: ReadonlySet<string>): AppSchema<Tables>;
function build(entities: Record<string, Entity>, frameworkTables: ReadonlySet<string>): AppSchema {
  function extendEntities(map: Partial<Record<string, EntityExtension>>): AppSchema {
    const extended: Record<string, Entity> = { ...entities };

    for (const [table, extension = {}] of Object.entries(map)) {
      const entity = entities[table];
      if(!entity) {
        throw new Error(
          `[db] defineSchema: extendEntities names "${table}", which is not a table in this schema.`,
        );
      }

      const fields = mergeFields(table, entity.fields, extension.fields ?? {}, "");

      for (const field of Object.keys(extension.rename ?? {})) {
        if(!resolveFieldPath(fields, field)) {
          throw new Error(
            `[db] defineSchema: extendEntities: "${table}" renames "${field}", which is not declared in \`fields\`.`,
          );
        }
        if(entity.rename && field in entity.rename) {
          throw new Error(`[db] defineSchema: extendEntities: "${table}" already renames "${field}".`);
        }
      }
      const rename = entity.rename || extension.rename
        ? { ...entity.rename, ...extension.rename }
        : undefined;

      // Rebuild through defineEntity so the additions face the same validation the entity's own
      // declaration did — a pk restatement or an unprojected index throws here too.
      const addedIndexes = (extension.indexes ?? []).filter((index) => !entity.indexes.includes(index));
      extended[table] = defineEntity({
        primaryKey: entity.primaryKeyFields.join(","),
        fields,
        indexes: [...entity.indexes, ...addedIndexes],
        ...(rename ? { rename } : {}),
        ...(entity.keyDefaults ? { keyDefaults: entity.keyDefaults } : {}),
        ...(entity.retainOnLogout ? { retainOnLogout: true } : {}),
      });
    }

    return build(extended, frameworkTables);
  }

  return {
    entities,
    tables: Object.freeze(Object.fromEntries(Object.keys(entities).map((table) => [table, table]))) as any,
    stores: storesOf(entities),
    frameworkTables,

    pick(tables: readonly string[]) {
      const picked: Record<string, Entity> = {};
      for (const table of tables) {
        const entity = entities[table];
        if(!entity) {
          throw new Error(
            `[db] defineSchema: pick names "${table}", which is not a table in this schema.`,
          );
        }
        picked[table] = entity;
      }
      return build(picked, new Set(tables.filter((t) => frameworkTables.has(t))));
    },

    extendIndexes(map: Partial<Record<string, string[]>>) {
      for (const table of Object.keys(map)) {
        if(!entities[table]) {
          throw new Error(
            `[db] defineSchema: extendIndexes names "${table}", which is not a table in this schema.`,
          );
        }
      }
      return extendEntities(
        Object.fromEntries(Object.entries(map).map(([table, indexes]) => [table, { indexes }])),
      );
    },

    extendEntities,
  };
}

/**
 * `options.framework` marks every table in the map as framework data. Only the framework module
 * schemas (`common/db/schema/*`) pass it. It exists because an app may legitimately declare its OWN
 * table with a framework table's name — Company's `statuses` hits `oms/statuses` while the seed one
 * hits `admin/status` — and deciding provenance by name alone would point the app's table at the
 * wrong endpoint.
 */
export function defineSchema<Map extends Record<string, Entity>>(
  map: Map,
  options: { framework?: boolean } = {},
): AppSchema<Extract<keyof Map, string>> {
  if("syncMeta" in map) {
    throw new Error('[db] defineSchema: "syncMeta" is provided by BaseDB and must not be declared.');
  }
  return build({ ...map }, new Set(options.framework ? Object.keys(map) : []));
}

export function mergeSchemas<Schemas extends AppSchema<any>[]>(
  ...schemas: Schemas
): AppSchema<TablesOf<Schemas[number]>> {
  const merged: Record<string, Entity> = {};
  const mergedFramework = new Set<string>();

  for (const schema of schemas) {
    for (const [table, entity] of Object.entries(schema.entities as Record<string, Entity>)) {
      if(table in merged) {
        throw new Error(
          `[db] mergeSchemas: table "${table}" is claimed by more than one schema. ` +
          "Use `pick` to take it from exactly one, and `extendEntities` to widen it.",
        );
      }
      merged[table] = entity;
      if(schema.frameworkTables.has(table)) mergedFramework.add(table);
    }
  }

  return build<TablesOf<Schemas[number]>>(merged, mergedFramework);
}
