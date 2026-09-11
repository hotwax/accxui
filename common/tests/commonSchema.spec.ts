import { describe, expect, it } from "vitest";
import { commonSchema } from "../db/domains/commonSchema";
import { COMMON_DOMAIN_NAMES, COMMON_TABLE_NAMES, commonDomainsByTable } from "../db/domains/commonDomains";
import before from "./fixtures/seedBefore.json";
import after from "./fixtures/seedSchemaAfter.json";

describe("commonSchema", () => {
  it("emits the intended Dexie string for every table", () => {
    expect(commonSchema.stores).toEqual(after.schema);
  });

  it("declares every table that commonDomains describes, and no others", () => {
    expect(Object.keys(commonSchema.entities).sort()).toEqual([...COMMON_TABLE_NAMES].sort());
    expect(Object.keys(commonDomainsByTable).sort()).toEqual([...COMMON_TABLE_NAMES].sort());
  });

  it("keeps the pre-refactor domain names exactly", () => {
    expect([...COMMON_DOMAIN_NAMES].sort()).toEqual(before.domainNames);
  });

  it("gives every entity a label", () => {
    for (const table of COMMON_TABLE_NAMES) {
      expect(commonDomainsByTable[table].label, `missing label for ${table}`).toBeTruthy();
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
