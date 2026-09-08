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

export interface AppSchema {
  /** Keyed by table name. */
  entities: Record<string, Entity>;
  /** Table name → Dexie schema string, ready for `version().stores()`. `syncMeta` is not included — BaseDB adds it. */
  stores: Record<string, string>;
  /** A subset of this schema. Throws on a table this schema does not have. */
  pick(tables: string[]): AppSchema;
  /** Extra secondary indexes appended after an entity's own. Throws on an unknown table, a pk restatement, or an unprojected field. */
  extendIndexes(map: Record<string, string[]>): AppSchema;
}

function storesOf(entities: Record<string, Entity>): Record<string, string> {
  const stores: Record<string, string> = {};
  for (const [table, entity] of Object.entries(entities)) {
    stores[table] = entity.schema;
  }
  return stores;
}

function build(entities: Record<string, Entity>): AppSchema {
  return {
    entities,
    stores: storesOf(entities),

    pick(tables) {
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
      return build(picked);
    },

    extendIndexes(map) {
      const extended: Record<string, Entity> = { ...entities };

      for (const [table, extra] of Object.entries(map)) {
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
        });
      }

      return build(extended);
    },
  };
}

export function defineSchema(map: Record<string, Entity>): AppSchema {
  if("syncMeta" in map) {
    throw new Error('[db] defineSchema: "syncMeta" is provided by BaseDB and must not be declared.');
  }
  return build({ ...map });
}

export function mergeSchemas(...schemas: AppSchema[]): AppSchema {
  const merged: Record<string, Entity> = {};

  for (const schema of schemas) {
    for (const [table, entity] of Object.entries(schema.entities)) {
      if(table in merged) {
        throw new Error(
          `[db] mergeSchemas: table "${table}" is claimed by more than one schema. ` +
          "Use `pick` to take it from exactly one, or `extendIndexes` to widen it.",
        );
      }
      merged[table] = entity;
    }
  }

  return build(merged);
}
