import { describe, expect, it } from "vitest";
import { commonSchema } from "../db/domains/commonSchema";
import { SEED_DOMAIN_NAMES, SEED_SOURCES, SEED_TABLE_NAMES } from "../db/domains/seedDomains";
import before from "./fixtures/seedBefore.json";
import after from "./fixtures/seedSchemaAfter.json";

describe("commonSchema", () => {
  it("emits the intended Dexie string for every table", () => {
    expect(commonSchema.stores).toEqual(after.schema);
  });

  it("declares every table that SEED_SOURCES describes, and no others", () => {
    expect(Object.keys(commonSchema.entities).sort()).toEqual([...SEED_TABLE_NAMES].sort());
    expect(Object.keys(SEED_SOURCES).sort()).toEqual([...SEED_TABLE_NAMES].sort());
  });

  it("keeps the pre-refactor domain names exactly", () => {
    expect([...SEED_DOMAIN_NAMES].sort()).toEqual(before.domainNames);
  });

  it("gives every entity a label and a listUrl", () => {
    for (const table of SEED_TABLE_NAMES) {
      expect(SEED_SOURCES[table].label, `missing label for ${table}`).toBeTruthy();
      expect(SEED_SOURCES[table].source.listUrl, `missing listUrl for ${table}`).toBeTruthy();
    }
  });

  it("declares every primary-key field and every index as a projected field", () => {
    for (const [table, entity] of Object.entries(commonSchema.entities)) {
      for (const field of entity.primaryKeyFields) {
        expect(entity.fields[field], `${table}: pk field ${field} not projected`).toBeTruthy();
      }
      for (const index of entity.indexes) {
        const members = index.startsWith("[") ? index.slice(1, -1).split("+") : [index];
        for (const member of members) {
          expect(entity.fields[member], `${table}: index member ${member} not projected`).toBeTruthy();
        }
      }
    }
  });

  it("has no synthetic key column left anywhere", () => {
    for (const [table, entity] of Object.entries(commonSchema.entities)) {
      const synthetic = entity.fieldNames.filter((f) => /Key$/.test(f));
      expect(synthetic, `${table} still declares a synthetic key column`).toEqual([]);
    }
  });
});
