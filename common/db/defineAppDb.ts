/**
 * Declarative single-database creation for AccxUI apps.
 *
 * An app declares which seed entities it wants and which tables are its own; this module
 * composes the schema, creates one database per OMS instance, and exposes the accessors.
 *
 * Imports are deliberately narrow — `dexie`, `baseDb`, `dbClient` and plain seed data. It must
 * never import the `@common/db` barrel or anything pulling in `vue`, because app db modules are
 * imported by sync workers whose chunk Vite emits as a single iife.
 */

import type { SyncDomainCatalogItem } from "./useDbStatus";
import { type SeedEntity, type SeedEntityName, seedEntitiesFor } from "./domains/seedEntities";

export interface AppDbDefinition {
  /** Name suffix: "CompanyDB" produces `{omsInstance}-CompanyDB`. */
  suffix: string;
  /** Seed entities this app wants. Each contributes a table, a projection, a domain and a status row. */
  seed: readonly SeedEntityName[];
  /** The app's own tables, as Dexie schema strings. */
  schema: Record<string, string>;
  /**
   * Extra secondary indexes on a PICKED seed table, appended after the seed's own.
   * The seed primary key and indexes are preserved, so a pick can be widened but never redefined.
   */
  extendIndexes?: Record<string, string>;
}

export interface ComposedAppSchema {
  /** Picked seed tables merged with the app's own. `syncMeta` is not included — BaseDB adds it. */
  schema: Record<string, string>;
  seed: SeedEntity[];
  /** Derived from `seed`, so it can never list a different set. */
  statusCatalog: SyncDomainCatalogItem[];
}

export function composeAppSchema(def: AppDbDefinition): ComposedAppSchema {
  if(!def.suffix) {
    throw new Error("[db] defineAppDb: a non-empty `suffix` is required.");
  }

  const seed = seedEntitiesFor(def.seed);

  const byTable = new Map<string, SeedEntity>();
  for (const entity of seed) {
    const clash = byTable.get(entity.table);
    if(clash) {
      throw new Error(
        `[db] defineAppDb: seed entities "${clash.name}" and "${entity.name}" both claim table "${entity.table}".`,
      );
    }
    byTable.set(entity.table, entity);
  }

  if("syncMeta" in def.schema) {
    throw new Error('[db] defineAppDb: "syncMeta" is provided by BaseDB and must not be declared.');
  }

  for (const table of Object.keys(def.schema)) {
    const picked = byTable.get(table);
    if(picked) {
      throw new Error(
        `[db] defineAppDb: table "${table}" is declared in \`schema\` but is already provided by ` +
        `seed entity "${picked.name}". Use \`extendIndexes\` to add indexes to a picked seed table.`,
      );
    }
  }

  const schema: Record<string, string> = {};
  for (const entity of seed) {
    schema[entity.table] = entity.schema;
  }

  for (const [table, extra] of Object.entries(def.extendIndexes ?? {})) {
    const picked = byTable.get(table);
    if(!picked) {
      throw new Error(
        `[db] defineAppDb: extendIndexes names "${table}", which is not a picked seed table.`,
      );
    }

    const existing = picked.schema.split(",").map((part) => part.trim()).filter(Boolean);
    const primaryKey = existing[0];
    const added = extra.split(",").map((part) => part.trim()).filter(Boolean);

    for (const index of added) {
      if(index === primaryKey) {
        throw new Error(
          `[db] defineAppDb: extendIndexes for "${table}" must not restate the primary key "${primaryKey}".`,
        );
      }
    }

    const merged = [...existing, ...added.filter((index) => !existing.includes(index))];
    schema[table] = merged.join(", ");
  }

  Object.assign(schema, def.schema);

  return {
    schema,
    seed,
    statusCatalog: seed.map((entity) => ({
      name: entity.name,
      table: entity.table,
      label: entity.label,
      syncClass: "B" as const,
    })),
  };
}
