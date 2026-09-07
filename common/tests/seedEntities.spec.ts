import { describe, expect, it } from "vitest";
import before from "./fixtures/seedBefore.json";
import { SEED_ENTITIES, SEED_ENTITY_NAMES, seedSchemaOf } from "../db/domains/seedEntities";
import { clearSyncRegistry, getAllSyncDomains } from "../db/sync/syncRegistry";
import { registerCommonSeedDomains } from "../db/domains/commonSeedDomains";
import type { BaseDB } from "../db/baseDb";

describe("seed entity registry", () => {
  it("reproduces the pre-refactor schema exactly", () => {
    expect(seedSchemaOf(SEED_ENTITY_NAMES)).toEqual(before.schema);
  });

  it("covers every pre-refactor domain name", () => {
    expect([...SEED_ENTITY_NAMES].sort()).toEqual(before.domainNames);
  });

  it("gives every entity a table, schema, label and projection key field", () => {
    for (const name of SEED_ENTITY_NAMES) {
      const entity = SEED_ENTITIES[name];
      expect(entity.name, `name mismatch for ${name}`).toBe(name);
      expect(entity.table, `missing table for ${name}`).toBeTruthy();
      expect(entity.schema, `missing schema for ${name}`).toBeTruthy();
      expect(entity.label, `missing label for ${name}`).toBeTruthy();
      expect(entity.projection?.keyField, `missing keyField for ${name}`).toBeTruthy();
      expect(entity.source?.listUrl, `missing listUrl for ${name}`).toBeTruthy();
    }
  });

  it("has no two entities claiming the same table", () => {
    const tables = SEED_ENTITY_NAMES.map((n) => SEED_ENTITIES[n].table);
    expect(new Set(tables).size).toBe(tables.length);
  });

  it("returns only the requested subset", () => {
    expect(Object.keys(seedSchemaOf(["status", "enum"]))).toEqual(["statuses", "enums"]);
  });
});

describe("registerCommonSeedDomains", () => {
  it("registers exactly the pre-refactor domain names", () => {
    clearSyncRegistry();
    // getDb is never invoked during registration, only during a sync tick.
    registerCommonSeedDomains(() => ({}) as BaseDB);
    expect(getAllSyncDomains().map((d) => d.name).sort()).toEqual(before.domainNames);
  });
});
