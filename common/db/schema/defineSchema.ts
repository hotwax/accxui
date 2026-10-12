/**
 * Composition of many entities into one app's Dexie schema.
 *
 * `defineSchema` keys entities by their IndexedDB STORE NAME, so its `stores` output maps 1:1 onto
 * what `version().stores()` wants and there is no domain/table split to keep aligned. `pick`,
 * `extendIndexes` and `mergeSchemas` all return a fresh AppSchema and never mutate their input, so
 * a framework-owned schema can be picked from by several apps at once.
 *
 * Imports only `./defineEntity`, for the same worker-bundle reason stated there.
 */

import { defineEntity, type Entity } from "./defineEntity";

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
  /** Tables that came from the framework seed schema. An app's own tables are absent, even when the name matches. */
  seedTables: ReadonlySet<string>;
  /** A subset of this schema. Throws on a table this schema does not have. */
  pick<Picked extends Tables>(tables: readonly Picked[]): AppSchema<Picked>;
  /** Extra secondary indexes appended after an entity's own. Throws on an unknown table, a pk restatement, or an unprojected field. */
  extendIndexes(map: Partial<Record<Tables, string[]>>): AppSchema<Tables>;
}

/** The table names of a schema type. */
export type TablesOf<Schema> = Schema extends AppSchema<infer Tables> ? Tables : never;

function storesOf(entities: Record<string, Entity>): Record<string, string> {
  const stores: Record<string, string> = {};
  for (const [table, entity] of Object.entries(entities)) {
    stores[table] = entity.schema;
  }
  return stores;
}

// The table names are a compile-time view; at runtime every map is keyed by plain strings.
function build<Tables extends string>(entities: Record<string, Entity>, seedTables: ReadonlySet<string>): AppSchema<Tables>;
function build(entities: Record<string, Entity>, seedTables: ReadonlySet<string>): AppSchema {
  return {
    entities,
    tables: Object.freeze(Object.fromEntries(Object.keys(entities).map((table) => [table, table]))) as any,
    stores: storesOf(entities),
    seedTables,

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
      return build(picked, new Set(tables.filter((t) => seedTables.has(t))));
    },

    extendIndexes(map: Partial<Record<string, string[]>>) {
      const extended: Record<string, Entity> = { ...entities };

      for (const [table, extra = []] of Object.entries(map)) {
        const entity = entities[table];
        if(!entity) {
          throw new Error(
            `[db] defineSchema: extendIndexes names "${table}", which is not a table in this schema.`,
          );
        }

        // Rebuild through defineEntity so the extra indexes face the same validation the
        // entity's own did — a pk restatement or an unprojected field throws here too.
        const added = extra.filter((index) => !entity.indexes.includes(index));
        extended[table] = defineEntity({
          primaryKey: entity.primaryKeyFields.join(","),
          fields: entity.fields,
          indexes: [...entity.indexes, ...added],
          ...(entity.rename ? { rename: entity.rename } : {}),
          ...(entity.keyDefaults ? { keyDefaults: entity.keyDefaults } : {}),
        });
      }

      return build(extended, seedTables);
    },
  };
}

/**
 * `options.seed` marks every table in the map as framework seed data. Only `commonSchema` passes
 * it. It exists because an app may legitimately declare its OWN table with a seed table's name —
 * Company's `statuses` hits `oms/statuses` while the seed one hits `admin/status` — and deciding
 * provenance by name alone would point the app's table at the wrong endpoint.
 */
export function defineSchema<Map extends Record<string, Entity>>(
  map: Map,
  options: { seed?: boolean } = {},
): AppSchema<Extract<keyof Map, string>> {
  if("syncMeta" in map) {
    throw new Error('[db] defineSchema: "syncMeta" is provided by BaseDB and must not be declared.');
  }
  return build({ ...map }, new Set(options.seed ? Object.keys(map) : []));
}

export function mergeSchemas<Schemas extends AppSchema<any>[]>(
  ...schemas: Schemas
): AppSchema<TablesOf<Schemas[number]>> {
  const merged: Record<string, Entity> = {};
  const mergedSeed = new Set<string>();

  for (const schema of schemas) {
    for (const [table, entity] of Object.entries(schema.entities as Record<string, Entity>)) {
      if(table in merged) {
        throw new Error(
          `[db] mergeSchemas: table "${table}" is claimed by more than one schema. ` +
          "Use `pick` to take it from exactly one, or `extendIndexes` to widen it.",
        );
      }
      merged[table] = entity;
      if(schema.seedTables.has(table)) mergedSeed.add(table);
    }
  }

  return build<TablesOf<Schemas[number]>>(merged, mergedSeed);
}
