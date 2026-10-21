import { describe, expect, it } from "vitest";
import { schemaRegistry } from "../db/schema/schemaRegistry";
import { commonSchema } from "../db/schema/commonSchema";
import { commonDomains } from "../db/domain/commonDomains";
import { REGISTRY_DOMAIN_NAMES, REGISTRY_TABLE_NAMES, domainRegistry, domainsByTable } from "../db/domain/domainRegistry";
import before from "./fixtures/seedBefore.json";
import after from "./fixtures/seedSchemaAfter.json";

describe("framework schema and domain registries", () => {
  it("emits the intended Dexie string for every table", () => {
    expect(schemaRegistry.stores).toEqual(after.schema);
  });

  it("declares every table the registered domains fill, and no others", () => {
    expect(Object.keys(schemaRegistry.entities).sort()).toEqual([...REGISTRY_TABLE_NAMES].sort());
    expect(new Set(REGISTRY_TABLE_NAMES).size).toBe(REGISTRY_TABLE_NAMES.length);
  });

  it("keeps the pre-refactor domain names exactly, adding only the product master", () => {
    expect([...REGISTRY_DOMAIN_NAMES].sort()).toEqual([...before.domainNames, "product"].sort());
  });

  it("gives every domain a label, and keys domainsByTable by each domain's primary table", () => {
    for (const domain of Object.values(domainRegistry)) {
      expect(domain.label, `missing label for ${domain.name}`).toBeTruthy();
      expect(domainsByTable[domain.table!]).toBe(domain);
    }
  });

  it("pairs each module's schema with its domains: every table filled by a domain of the same module", () => {
    const fills = (domains: Record<string, any>) => new Set(Object.values(domains).map((d) => d.table));
    expect([...fills(commonDomains)].sort()).toEqual(Object.keys(commonSchema.entities).sort());
  });

  it("marks every module's tables as framework tables", () => {
    for (const table of Object.keys(schemaRegistry.entities)) {
      expect(schemaRegistry.frameworkTables.has(table), `${table} lost its framework provenance`).toBe(true);
    }
  });

  it("declares every primary-key field and every index as a projected field", () => {
    for (const [table, entity] of Object.entries(schemaRegistry.entities)) {
      for (const field of entity.primaryKeyFields) {
        expect(entity.fields[field], `${table}: pk field ${field} not projected`).toBeTruthy();
      }
      for (const index of entity.indexes) {
        const members = index.startsWith("[") ? index.slice(1, -1).split("+") : [index];
        for (const member of members) {
          // A nested member is a dotted path; a `*` member reaches through a list.
          const declared = member.replace(/^\*/, "").split(".").reduce<any>(
            (spec, part) => (Array.isArray(spec) ? spec[0] : spec)?.[part],
            entity.fields,
          );
          expect(declared, `${table}: index member ${member} not projected`).toBeTruthy();
        }
      }
    }
  });

  it("has no synthetic key column left anywhere", () => {
    for (const [table, entity] of Object.entries(schemaRegistry.entities)) {
      const synthetic = entity.fieldNames.filter((f) => /Key$/.test(f));
      expect(synthetic, `${table} still declares a synthetic key column`).toEqual([]);
    }
  });
});
