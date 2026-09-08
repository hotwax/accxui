# `defineEntity` Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the split "hand-written Dexie schema string + separate `EntityProjection`" declaration with one `defineEntity({ primaryKey, fields, indexes })` call per entity, and convert composite natural keys from synthetic joined strings into real Dexie compound primary keys.

**Architecture:** Two new pure modules — `defineEntity.ts` (one entity: validate, normalize the primary key, emit the Dexie string) and `defineSchema.ts` (compose many: `pick`, `extendIndexes`, `mergeSchemas`). The `Entity` they produce replaces `EntityProjection` outright, so `projectRow` reads its `primaryKeyFields` instead of synthesising a key via `buildKey`. Because a compound key is a JavaScript array, a new `DbKey` type and a `canonicalKey` join thread through `dbClient`, `diffStaleKeys` and `snapshotDomain`.

**Tech Stack:** TypeScript, Dexie 4.4.3, Vitest 1.3.1, pnpm workspace.

**Spec:** [docs/superpowers/specs/2026-09-08-define-entity-design.md](../specs/2026-09-08-define-entity-design.md)

**Scope:** 16 tasks (Task 9b was added during execution — see its rationale). Tasks 1-9 are the framework (`accxui` root), Task 10 is Order Manager, Tasks 11-15 are Company. Company's own 43 tables and 17 synthetic keys convert in this plan, not a later one.

## Global Constraints

- **Three separate git repos, three separate commits.** `accxui` (root), `apps/order-manager`, `apps/company` are independent repositories. A framework change and an app change can never be one commit. All three are on branch `app-db-refined`.
- **`common/` is resolved live by both apps** (`@common/*` → `../../common/*` in each app's `tsconfig.json`). A breaking framework change makes both apps red until their own task lands, so Tasks 10 and 11 are not optional follow-ups — they are part of this plan.
- **The sync worker bundle must never pull in `commonUtil` or the `@common` barrel.** `defineEntity.ts` and `defineSchema.ts` must import nothing but `./types`. Vite emits the worker chunk as a single iife and the barrel re-exports modules that import `vue`.
- **No data migration.** Nothing is in production. A changed keyPath is handled by the existing `ensureDbReady` wipe-and-rebuild in development.
- **Dexie cannot change a store's primary key in an upgrade** — it throws `"Not yet support for changing primary key"` (verified in Dexie 4.4.3). Do not attempt to write an upgrade path.
- **Domain names stay exactly as they are** (singular: `facility`, `productStore`, `groupFacility`). Only the *schema map* is keyed by table name. `common/tests/fixtures/seedBefore.json`'s `domainNames` assertion must keep passing unchanged.
- **Key separator is `\u0000`, never `|`.** `|` occurs in real OFBiz data; a NUL cannot.
- **Write the NUL separator as the SOURCE ESCAPE, never as a raw byte.** In every `.ts` file it is a backslash, then `u`, then four zeros, inside quotes — six characters in the source, which the compiler turns into one NUL at runtime. Some editing tools silently emit a real NUL byte instead; that compiles and passes tests but makes the file binary to `grep`, `diff` and most editors. After touching any file that mentions the separator, verify with `tr -dc '\000' < <file> | wc -c` — it must print `0`, in the working tree *and* in the committed blob (`git show <sha>:<file> | tr -dc '\000' | wc -c`). This already went wrong once, in Task 3.
- **Pre-existing test failures — do not try to fix these.** `common/tests/commonUtil.spec.ts` (4 failures) and `common/tests/useSolrSearch.spec.ts` (collection error) are red before this work starts. Baseline for the files this plan touches: `projection.spec.ts` 8 passing, `seedEntities.spec.ts` 9 passing, `defineAppDb.spec.ts` 23 passing.
- **Typecheck and lint are pre-broken repo-wide.** Tests are the meaningful gate. Do not run `typecheck` or `lint` as a completion signal.

### Test commands

| Repo | Command |
|---|---|
| `accxui` (root) | `pnpm vitest run common/tests` |
| `apps/order-manager` | `cd apps/order-manager && pnpm test:unit` |
| `apps/company` | `cd apps/company && pnpm test:unit` |

---

## File Structure

### Repo A — `accxui` (root)

| File | Responsibility |
|---|---|
| **Create** `common/db/defineEntity.ts` | One entity. `normalizePrimaryKey`, `defineEntity`, the `Entity` and `EntityDefinition` types. Pure; imports only `./types`. |
| **Create** `common/db/defineSchema.ts` | Many entities. `defineSchema`, `mergeSchemas`, the `AppSchema` type with `pick` and `extendIndexes`. Pure; imports only `./defineEntity`. |
| **Create** `common/db/domains/commonSchema.ts` | The 29 seed entities as `defineSchema({ <table>: defineEntity({...}) })`. Storage only. |
| **Create** `common/db/domains/seedSources.ts` | The sibling map: table name → `{ name, label, source }`. Fetch config and Settings label. |
| **Create** `common/tests/defineEntity.spec.ts` | `defineEntity` validation and schema emission. |
| **Create** `common/tests/defineSchema.spec.ts` | `defineSchema`, `pick`, `extendIndexes`, `mergeSchemas`. |
| **Create** `common/tests/commonSchema.spec.ts` | Emitted-string snapshot for all 29 entities; cross-check against `seedSources`. |
| **Create** `common/tests/fixtures/seedSchemaAfter.json` | The intended post-conversion Dexie string per table. |
| **Modify** `common/db/types.ts` | Add `DbKey`. Delete `EntityProjection`. |
| **Modify** `common/db/projection.ts` | `projectRow`/`projectRows`/`isUnkeyableFetch` take `Entity`. Add `canonicalKey`, `entityKeyOf`. `diffStaleKeys` takes `DbKey[]`. |
| **Modify** `common/db/baseDb.ts` | `version` constructor parameter. |
| **Modify** `common/db/dbClient.ts` | Key-taking signatures widen to `DbKey`. |
| **Modify** `common/db/sync/snapshotDomain.ts` | Key extraction via `entityKeyOf`/`canonicalKey`; `DbKey` table generics. |
| **Modify** `common/db/defineAppDb.ts` | New `{ suffix, version, schema }` signature. `composeAppSchema` deleted. |
| **Modify** `common/db/sync/registerSeedDomains.ts` | Reads `seedSources` rather than `appDb.seed`. |
| **Delete** `common/db/domains/seedEntities.ts` | Replaced by `commonSchema.ts` + `seedSources.ts`. |
| **Delete** `common/db/domains/commonSeedEntities.ts` | Its 29 projection re-exports no longer exist. |
| **Modify** `common/db/domains/commonSeedDomains.ts` | Reads `seedSources`. |
| **Modify** `common/db/index.ts` | Barrel: add the two new modules, drop the two deleted ones. |
| **Modify** `common/tests/projection.spec.ts`, `common/tests/seedEntities.spec.ts`, `common/tests/defineAppDb.spec.ts` | Updated for the new shapes. |

### Repo B — `apps/order-manager`

| File | Responsibility |
|---|---|
| **Modify** `src/db/orderManagerDb.ts` | `defineAppDb({ suffix, version, schema: commonSchema })`. |
| **Modify** `src/db/useSeedData.ts` | `row()` key type widens; `labels()` gains a compound-key guard. |
| **Modify** `tests/db/projectRow.spec.ts` | Compound-key form. |

### Repo C — `apps/company`

| File | Responsibility |
|---|---|
| **Create** `src/db/companySchema.ts` | Company's 43 own tables as `defineSchema({ <table>: defineEntity({...}) })`. Replaces `COMPANY_SCHEMA` plus the projections in `cacheEntities.ts`. |
| **Create** `tests/db/companySchema.spec.ts`, `tests/fixtures/companySchemaAfter.json` | Emitted-string fixture and pk/index-are-projected checks for all 43. |
| **Modify** `src/utils/db/cacheProjection.ts` | Takes `Entity`; `keyField`, `buildKey` and its duplicate `FieldKind`/`EntityProjection`/coercers deleted. Keeps `CachedRow`'s `raw` and `cachedAt`. |
| **Modify** `src/utils/db/appCacheDb.ts` | `remove(key: DbKey)`; `defineCachedEntity(table, entity)`; the prune keys rows via `entityKeyOf`. |
| **Modify** `src/utils/db/cacheEntities.ts` | The 17 `buildKey`s and their synthetic key fields deleted; `defineCachedEntity` calls take entities from `companySchema`. |
| **Modify** `src/workers/domains/snapshotDomain.ts` | Takes `Entity`; key extraction via `entityKeyOf`/`canonicalKey`. |
| **Modify** `src/db/companyDb.ts` | Composes `mergeSchemas(commonSchema.pick([...]), companySchema)`. `COMPANY_SCHEMA` deleted. |
| **Modify** `src/workers/domains/registerSeedDomains.ts` | Passes `Entity` straight through — no down-conversion needed once Company handles compound keys. |

Company's stored row shape is deliberately NOT converged with the framework's: it keeps `raw` (read in 56 places) and `cachedAt`, so it retains its own `projectRow`/`projectRows`. Only the KEY concern converges on the framework.

---

# Repo A — Framework

### Task 1: `defineEntity`

**Files:**
- Create: `common/db/defineEntity.ts`
- Test: `common/tests/defineEntity.spec.ts`

**Interfaces:**
- Consumes: `FieldKind` from `common/db/types.ts` (existing: `"text" | "count" | "date" | "structured"`).
- Produces: `normalizePrimaryKey(primaryKey: string): string | string[]`, `defineEntity(def: EntityDefinition): Entity`, and the exported types `EntityDefinition` and `Entity` (shape below). Every later task depends on these exact property names.

- [ ] **Step 1: Write the failing test**

Create `common/tests/defineEntity.spec.ts`:

```ts
import { describe, expect, it } from "vitest";
import { defineEntity, normalizePrimaryKey } from "../db/defineEntity";

describe("normalizePrimaryKey", () => {
  it("returns a bare string for a single field", () => {
    expect(normalizePrimaryKey("facilityId")).toBe("facilityId");
  });

  it("returns an array for a composite key, trimming whitespace", () => {
    expect(normalizePrimaryKey(" productId , facilityId ")).toEqual(["productId", "facilityId"]);
  });

  it("drops empty segments from trailing or doubled commas", () => {
    expect(normalizePrimaryKey("productId,facilityId,")).toEqual(["productId", "facilityId"]);
    expect(normalizePrimaryKey("productId,,facilityId")).toEqual(["productId", "facilityId"]);
  });
});

describe("defineEntity schema emission", () => {
  it("emits a plain keyPath followed by its indexes", () => {
    const entity = defineEntity({
      primaryKey: "facilityId",
      fields: { facilityId: "text", facilityName: "text", facilityTypeId: "text" },
      indexes: ["facilityTypeId"],
    });

    expect(entity.schema).toBe("facilityId, facilityTypeId");
    expect(entity.primaryKey).toBe("facilityId");
    expect(entity.primaryKeyFields).toEqual(["facilityId"]);
  });

  it("emits a Dexie compound keyPath for a composite key", () => {
    const entity = defineEntity({
      primaryKey: "productId,facilityId",
      fields: { productId: "text", facilityId: "text", minimumStock: "count" },
      indexes: ["productId", "facilityId"],
    });

    expect(entity.schema).toBe("[productId+facilityId], productId, facilityId");
    expect(entity.primaryKey).toEqual(["productId", "facilityId"]);
    expect(entity.primaryKeyFields).toEqual(["productId", "facilityId"]);
  });

  it("emits only the keyPath when there are no indexes", () => {
    const entity = defineEntity({ primaryKey: "partyId", fields: { partyId: "text" } });

    expect(entity.schema).toBe("partyId");
    expect(entity.indexes).toEqual([]);
  });

  it("exposes field names in declaration order as the projection list", () => {
    const entity = defineEntity({
      primaryKey: "geoId",
      fields: { geoId: "text", geoName: "text", geoCode: "text" },
    });

    expect(entity.fieldNames).toEqual(["geoId", "geoName", "geoCode"]);
  });

  it("carries rename through untouched", () => {
    const entity = defineEntity({
      primaryKey: "geoId,toGeoId",
      fields: { geoId: "text", toGeoId: "text" },
      rename: { toGeoId: "geoIdTo" },
    });

    expect(entity.rename).toEqual({ toGeoId: "geoIdTo" });
  });
});

describe("defineEntity validation", () => {
  it("throws on an empty primary key", () => {
    expect(() => defineEntity({ primaryKey: "  ", fields: { a: "text" } }))
      .toThrow(/non-empty `primaryKey`/);
  });

  it("throws when the primary key repeats a field", () => {
    expect(() => defineEntity({ primaryKey: "a,a", fields: { a: "text" } }))
      .toThrow(/repeats field "a"/);
  });

  it("throws when a primary-key field is not a declared field", () => {
    expect(() => defineEntity({ primaryKey: "a,b", fields: { a: "text" } }))
      .toThrow(/primary-key field "b" is not declared in `fields`/);
  });

  it("throws when an index is not a declared field", () => {
    expect(() => defineEntity({ primaryKey: "a", fields: { a: "text" }, indexes: ["status"] }))
      .toThrow(/index "status" is not declared in `fields`/);
  });

  it("throws when an index restates a single-field primary key", () => {
    expect(() => defineEntity({ primaryKey: "a", fields: { a: "text" }, indexes: ["a"] }))
      .toThrow(/index "a" restates the primary key/);
  });

  it("throws when an index restates the compound key expression", () => {
    expect(() =>
      defineEntity({ primaryKey: "a,b", fields: { a: "text", b: "text" }, indexes: ["[a+b]"] }),
    ).toThrow(/index "\[a\+b\]" restates the primary key/);
  });

  it("allows an index on an individual member of a compound key", () => {
    expect(() =>
      defineEntity({ primaryKey: "a,b", fields: { a: "text", b: "text" }, indexes: ["a"] }),
    ).not.toThrow();
  });

  it("throws on a duplicate index", () => {
    expect(() =>
      defineEntity({ primaryKey: "a", fields: { a: "text", b: "text" }, indexes: ["b", "b"] }),
    ).toThrow(/duplicate index "b"/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run common/tests/defineEntity.spec.ts`
Expected: FAIL — cannot resolve `../db/defineEntity`.

- [ ] **Step 3: Write the implementation**

Create `common/db/defineEntity.ts`:

```ts
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
```

Note the validation order: a duplicate and a primary-key restatement are both checked before the
`in def.fields` check, so `indexes: ["a"]` against `primaryKey: "a"` reports the restatement rather
than a spurious "not declared" error (`a` *is* declared).

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run common/tests/defineEntity.spec.ts`
Expected: PASS — 16 tests.

- [ ] **Step 5: Commit**

```bash
git add common/db/defineEntity.ts common/tests/defineEntity.spec.ts
git commit -m "feat(db): add defineEntity, one declaration per IndexedDB entity"
```

---

### Task 2: `defineSchema`, `pick`, `extendIndexes`, `mergeSchemas`

**Files:**
- Create: `common/db/defineSchema.ts`
- Test: `common/tests/defineSchema.spec.ts`

**Interfaces:**
- Consumes: `Entity`, `defineEntity` from Task 1.
- Produces: `AppSchema` (with `entities`, `stores`, `pick(tables)`, `extendIndexes(map)`), `defineSchema(map)`, `mergeSchemas(...schemas)`. Tasks 7–11 all consume these.

- [ ] **Step 1: Write the failing test**

Create `common/tests/defineSchema.spec.ts`:

```ts
import { describe, expect, it } from "vitest";
import { defineEntity } from "../db/defineEntity";
import { defineSchema, mergeSchemas } from "../db/defineSchema";

const facilities = defineEntity({
  primaryKey: "facilityId",
  fields: { facilityId: "text", facilityName: "text", facilityTypeId: "text", ownerPartyId: "text" },
  indexes: ["facilityTypeId"],
});

const productStores = defineEntity({
  primaryKey: "productStoreId",
  fields: { productStoreId: "text", storeName: "text" },
  indexes: ["storeName"],
});

const base = () => defineSchema({ facilities, productStores });

describe("defineSchema", () => {
  it("exposes entities and a Dexie-ready stores map keyed by table name", () => {
    const schema = base();

    expect(Object.keys(schema.entities)).toEqual(["facilities", "productStores"]);
    expect(schema.stores).toEqual({
      facilities: "facilityId, facilityTypeId",
      productStores: "productStoreId, storeName",
    });
  });

  it("throws when a table is named syncMeta, which BaseDB provides", () => {
    expect(() => defineSchema({ syncMeta: facilities }))
      .toThrow(/"syncMeta" is provided by BaseDB/);
  });
});

describe("AppSchema.pick", () => {
  it("returns only the requested tables", () => {
    const picked = base().pick(["productStores"]);

    expect(Object.keys(picked.entities)).toEqual(["productStores"]);
    expect(picked.stores).toEqual({ productStores: "productStoreId, storeName" });
  });

  it("throws on an unknown table rather than silently skipping it", () => {
    expect(() => base().pick(["facility"]))
      .toThrow(/pick names "facility", which is not a table in this schema/);
  });

  it("does not mutate the source schema", () => {
    const schema = base();
    schema.pick(["productStores"]);

    expect(Object.keys(schema.entities)).toEqual(["facilities", "productStores"]);
  });
});

describe("AppSchema.extendIndexes", () => {
  it("appends indexes after the entity's own", () => {
    const widened = base().extendIndexes({ facilities: ["ownerPartyId"] });

    expect(widened.stores.facilities).toBe("facilityId, facilityTypeId, ownerPartyId");
  });

  it("throws when the named table is not in the schema", () => {
    expect(() => base().extendIndexes({ carriers: ["partyId"] }))
      .toThrow(/extendIndexes names "carriers", which is not a table in this schema/);
  });

  it("throws when the extra index restates the primary key", () => {
    expect(() => base().extendIndexes({ facilities: ["facilityId"] }))
      .toThrow(/restates the primary key/);
  });

  it("throws when the extra index is not a declared field", () => {
    expect(() => base().extendIndexes({ facilities: ["nope"] }))
      .toThrow(/is not declared in `fields`/);
  });

  it("ignores an index the entity already declares rather than duplicating it", () => {
    const widened = base().extendIndexes({ facilities: ["facilityTypeId"] });

    expect(widened.stores.facilities).toBe("facilityId, facilityTypeId");
  });

  it("does not mutate the source schema", () => {
    const schema = base();
    schema.extendIndexes({ facilities: ["ownerPartyId"] });

    expect(schema.stores.facilities).toBe("facilityId, facilityTypeId");
  });
});

describe("mergeSchemas", () => {
  it("combines every input's tables", () => {
    const own = defineSchema({ carriers: defineEntity({ primaryKey: "partyId", fields: { partyId: "text" } }) });
    const merged = mergeSchemas(base().pick(["facilities"]), own);

    expect(Object.keys(merged.stores).sort()).toEqual(["carriers", "facilities"]);
  });

  it("throws when two inputs claim the same table", () => {
    expect(() => mergeSchemas(base(), base().pick(["facilities"])))
      .toThrow(/table "facilities" is claimed by more than one schema/);
  });

  it("returns a composable schema, so pick still works on the result", () => {
    const own = defineSchema({ carriers: defineEntity({ primaryKey: "partyId", fields: { partyId: "text" } }) });
    const merged = mergeSchemas(base(), own);

    expect(Object.keys(merged.pick(["carriers"]).entities)).toEqual(["carriers"]);
  });

  it("returns an empty schema when given nothing", () => {
    expect(mergeSchemas().stores).toEqual({});
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run common/tests/defineSchema.spec.ts`
Expected: FAIL — cannot resolve `../db/defineSchema`.

- [ ] **Step 3: Write the implementation**

Create `common/db/defineSchema.ts`:

```ts
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run common/tests/defineSchema.spec.ts`
Expected: PASS — 15 tests.

- [ ] **Step 5: Commit**

```bash
git add common/db/defineSchema.ts common/tests/defineSchema.spec.ts
git commit -m "feat(db): add defineSchema, pick, extendIndexes and mergeSchemas"
```

---

### Task 3: `DbKey`, `canonicalKey`, `entityKeyOf`, compound `diffStaleKeys`

**Files:**
- Modify: `common/db/types.ts` (add `DbKey` beside the existing `DbRow`)
- Modify: `common/db/projection.ts:96` (`diffStaleKeys`), plus two new exports
- Test: `common/tests/projection.spec.ts`

**Interfaces:**
- Consumes: `Entity` from Task 1.
- Produces: `DbKey`, `canonicalKey(key: DbKey): string`, `entityKeyOf(row, entity): DbKey | undefined`, `diffStaleKeys(existing: readonly DbKey[], fresh: readonly DbKey[]): DbKey[]`. Tasks 5, 6 and 10 consume these.

- [ ] **Step 1: Write the failing test**

Append to `common/tests/projection.spec.ts`:

```ts
describe("canonicalKey", () => {
  it("passes a scalar key through as a string", () => {
    expect(canonicalKey("FAC_1")).toBe("FAC_1");
    expect(canonicalKey(42)).toBe("42");
  });

  it("joins a compound key on NUL, which cannot occur in an OFBiz id", () => {
    expect(canonicalKey(["A", "B"])).toBe("A\u0000B");
  });

  it("does not conflate compound keys a pipe separator would collide on", () => {
    // "A|B" is a legal single id, and ["A","B"] is a legal compound key.
    expect(canonicalKey(["A", "B"])).not.toBe(canonicalKey("A|B"));
  });

  it("distinguishes compound keys that share a prefix", () => {
    expect(canonicalKey(["AB", "C"])).not.toBe(canonicalKey(["A", "BC"]));
  });
});

describe("entityKeyOf", () => {
  const single = defineEntity({ primaryKey: "facilityId", fields: { facilityId: "text" } });
  const compound = defineEntity({
    primaryKey: "productStoreId,facilityId",
    fields: { productStoreId: "text", facilityId: "text" },
  });

  it("returns a scalar for a single-field key", () => {
    expect(entityKeyOf({ facilityId: "FAC_1" }, single)).toBe("FAC_1");
  });

  it("returns an array in declared order for a compound key", () => {
    expect(entityKeyOf({ facilityId: "FAC_1", productStoreId: "STORE_1" }, compound))
      .toEqual(["STORE_1", "FAC_1"]);
  });

  it("returns undefined when any member is missing or empty", () => {
    expect(entityKeyOf({ productStoreId: "STORE_1" }, compound)).toBeUndefined();
    expect(entityKeyOf({ productStoreId: "STORE_1", facilityId: "" }, compound)).toBeUndefined();
    expect(entityKeyOf({}, single)).toBeUndefined();
  });

  it("keeps a numeric member numeric, since a date key is stored as millis", () => {
    const dated = defineEntity({
      primaryKey: "facilityId,fromDate",
      fields: { facilityId: "text", fromDate: "date" },
    });

    expect(entityKeyOf({ facilityId: "FAC_1", fromDate: 1700000000000 }, dated))
      .toEqual(["FAC_1", 1700000000000]);
  });
});

describe("diffStaleKeys with compound keys", () => {
  it("diffs array keys by value, not identity", () => {
    const existing = [["A", "1"], ["B", "2"], ["C", "3"]];
    const fresh = [["B", "2"], ["D", "4"]];

    expect(diffStaleKeys(existing, fresh)).toEqual([["A", "1"], ["C", "3"]]);
  });

  it("returns the original array form, so the result can be passed to bulkDelete", () => {
    const [stale] = diffStaleKeys([["A", "1"]], []);
    expect(Array.isArray(stale)).toBe(true);
  });

  it("does not treat prefix-sharing compound keys as equal", () => {
    expect(diffStaleKeys([["AB", "C"]], [["A", "BC"]])).toEqual([["AB", "C"]]);
  });
});
```

Add to that file's existing imports:

```ts
import { canonicalKey, entityKeyOf } from "../db/projection";
import { defineEntity } from "../db/defineEntity";
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run common/tests/projection.spec.ts`
Expected: FAIL — `canonicalKey` and `entityKeyOf` are not exported.

- [ ] **Step 3: Add `DbKey` to `types.ts`**

In `common/db/types.ts`, directly after the `DbRow` interface:

```ts
/**
 * A stored row's primary key. A scalar for a single-field key; an array, in the entity's declared
 * field order, for a Dexie compound key (`[a+b]`).
 */
export type DbKey = string | number | Array<string | number>;
```

- [ ] **Step 4: Add the helpers to `projection.ts`**

Add to the imports at the top of `common/db/projection.ts`:

```ts
import type { Entity } from "./defineEntity";
import type { DbKey, DbRow, EntityProjection, FieldKind } from "./types";
```

(`EntityProjection` is removed from this import in Task 4; leaving it here keeps this task's commit green on its own.)

Then, replacing the existing `diffStaleKeys`:

```ts
/**
 * `|` occurs in real OFBiz ids, so joining on it would make `["A","B"]` and the single id `"A|B"`
 * indistinguishable. NUL cannot occur in one.
 */
const KEY_SEPARATOR = "\u0000";

/** A compound key flattened to a value-comparable string, for Set and Map membership. */
export function canonicalKey(key: DbKey): string {
  return Array.isArray(key) ? key.join(KEY_SEPARATOR) : String(key);
}

/**
 * The primary key of a stored row: a scalar for a single-field key, an array in declared order for
 * a compound one. Undefined when any member is absent, which means the row cannot be stored.
 */
export function entityKeyOf(row: Record<string, unknown>, entity: Entity): DbKey | undefined {
  const values: Array<string | number> = [];

  for (const field of entity.primaryKeyFields) {
    const value = row?.[field];
    if (value === undefined || value === null || value === "") return undefined;
    values.push(typeof value === "number" ? value : String(value));
  }

  return values.length === 1 ? values[0] : values;
}

/**
 * Keys to delete after a snapshot sync: everything stored that the fresh full set no longer
 * contains. Compares through `canonicalKey` because a Set compares arrays by identity, but returns
 * the ORIGINAL key form so the result can be handed straight to `bulkDelete`.
 */
export function diffStaleKeys(existingKeys: readonly DbKey[], freshKeys: readonly DbKey[]): DbKey[] {
  const fresh = new Set(freshKeys.map(canonicalKey));
  return existingKeys.filter((key) => !fresh.has(canonicalKey(key)));
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm vitest run common/tests/projection.spec.ts`
Expected: PASS — the 8 original tests plus 11 new ones. The original
`diffStaleKeys(["A","B","C","D"], ["B","D","E"])` test still passes unchanged, because a scalar key
canonicalizes to itself.

- [ ] **Step 6: Commit**

```bash
git add common/db/types.ts common/db/projection.ts common/tests/projection.spec.ts
git commit -m "feat(db): add DbKey, canonicalKey and entityKeyOf; diff stale keys by value"
```

---

### Task 4: `projectRow` on `Entity`; delete `EntityProjection`

**Files:**
- Modify: `common/db/types.ts` (delete `EntityProjection`)
- Modify: `common/db/projection.ts:44-80` (`projectRow`, `projectRows`, `isUnkeyableFetch`)
- Test: `common/tests/projection.spec.ts`

**Interfaces:**
- Consumes: `Entity` (Task 1), `entityKeyOf` (Task 3).
- Produces: `projectRow(raw, entity: Entity, now): DbRow | null`, `projectRows(rawRows, entity: Entity, now): DbRow[]`, `isUnkeyableFetch(rawRows, entity: Entity): boolean`. `EntityProjection` no longer exists.

Company is unaffected by this deletion: it has its **own** `EntityProjection` in
`apps/company/src/utils/db/cacheProjection.ts` and its own `projectRows`. Only
`apps/order-manager/tests/db/projectRow.spec.ts` imports the framework's, and Task 10 updates it.

- [ ] **Step 1: Rewrite the affected tests**

In `common/tests/projection.spec.ts`, replace the `projectRow & projectRows` and `isUnkeyableFetch`
describe blocks with:

```ts
describe("projectRow & projectRows", () => {
  const facility = defineEntity({
    primaryKey: "facilityId",
    fields: { facilityId: "text", facilityName: "text", maximumOrderLimit: "count" },
  });

  it("stores only the projected fields, never the raw server payload", () => {
    const raw = {
      facilityId: "FAC_01",
      facilityName: "Main Warehouse",
      maximumOrderLimit: "100",
      extraServerField: "ignored",
    };

    expect(projectRow(raw, facility, 12345)).toEqual({
      facilityId: "FAC_01",
      facilityName: "Main Warehouse",
      maximumOrderLimit: 100,
      syncedAt: 12345,
    });
  });

  it("stores a compound key as its real member fields, with no synthetic column", () => {
    const storeFacility = defineEntity({
      primaryKey: "productStoreId,facilityId",
      fields: { productStoreId: "text", facilityId: "text" },
    });

    expect(projectRow({ productStoreId: "STORE_1", facilityId: "FAC_1" }, storeFacility, 1000))
      .toEqual({ productStoreId: "STORE_1", facilityId: "FAC_1", syncedAt: 1000 });
  });

  it("drops a record missing any compound-key member", () => {
    const storeFacility = defineEntity({
      primaryKey: "productStoreId,facilityId",
      fields: { productStoreId: "text", facilityId: "text" },
    });

    expect(projectRow({ productStoreId: "STORE_1" }, storeFacility, 1000)).toBeNull();
  });

  it("reads a key member supplied only under its rename source", () => {
    const geoAssoc = defineEntity({
      primaryKey: "geoId,toGeoId",
      fields: { geoId: "text", toGeoId: "text" },
      rename: { toGeoId: "geoIdTo" },
    });

    expect(projectRow({ geoId: "USA", geoIdTo: "CA" }, geoAssoc, 1000))
      .toEqual({ geoId: "USA", toGeoId: "CA", syncedAt: 1000 });
  });

  it("coerces a date key member to millis, so it is a valid IndexedDB key", () => {
    const dated = defineEntity({
      primaryKey: "facilityGroupId,fromDate",
      fields: { facilityGroupId: "text", fromDate: "date" },
    });

    const row = projectRow({ facilityGroupId: "GRP1", fromDate: "2024-01-01T00:00:00.000Z" }, dated, 1);
    expect(row?.fromDate).toBe(1704067200000);
  });

  it("drops records without a valid key", () => {
    expect(projectRow({ facilityName: "Nameless" }, facility, 1000)).toBeNull();
    expect(projectRows([{ facilityId: "A" }, { facilityName: "X" }], facility, 1000)).toHaveLength(1);
  });
});

describe("isUnkeyableFetch", () => {
  const entity = defineEntity({ primaryKey: "id", fields: { id: "text" } });

  it("flags unkeyable fetches", () => {
    expect(isUnkeyableFetch([{ wrongIdField: "123" }], entity)).toBe(true);
    expect(isUnkeyableFetch([{ id: "123" }], entity)).toBe(false);
  });

  it("does not flag an empty fetch", () => {
    expect(isUnkeyableFetch([], entity)).toBe(false);
  });
});
```

Delete the now-unused `import type { EntityProjection } from "../db/types";` line.

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run common/tests/projection.spec.ts`
Expected: FAIL — the compound-key tests fail, because `projectRow` still looks for `keyField`.

- [ ] **Step 3: Rewrite `projectRow` and retype its neighbours**

In `common/db/projection.ts`, replace `projectRow` with:

```ts
/**
 * Project one raw server record into a stored row.
 *
 * Returns null when the record cannot be keyed — for a compound key that means ANY member failed to
 * project. There is no synthetic key to build: the key members are ordinary declared fields, so
 * they are coerced by their declared kind like everything else.
 */
export function projectRow(
  raw: Record<string, unknown>,
  entity: Entity,
  now: number,
): DbRow | null {
  const row: Record<string, unknown> = {};

  for (const [field, kind] of Object.entries(entity.fields)) {
    const source = raw?.[field] !== undefined ? field : entity.rename?.[field] ?? field;
    const value = COERCE[kind](raw?.[source]);
    if (value !== undefined) row[field] = value;
  }

  for (const field of entity.primaryKeyFields) {
    if (row[field] === undefined) return null;
  }

  return { ...row, syncedAt: now } as DbRow;
}
```

Then change the `projection: EntityProjection` parameter to `entity: Entity` in `projectRows` and
`isUnkeyableFetch`, updating the forwarded argument names, and drop `EntityProjection` from the
`./types` import.

- [ ] **Step 4: Delete `EntityProjection` from `types.ts`**

Remove the whole `export interface EntityProjection { ... }` block from `common/db/types.ts`.
`FieldKind` stays — `defineEntity` and `COERCE` both use it.

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm vitest run common/tests/projection.spec.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add common/db/projection.ts common/db/types.ts common/tests/projection.spec.ts
git commit -m "feat(db)!: project rows against Entity; drop EntityProjection and buildKey"
```

---

### Task 5: `BaseDB` version parameter and `dbClient` key widening

**Files:**
- Modify: `common/db/baseDb.ts:11-19`
- Modify: `common/db/dbClient.ts:16-36` (the `DbClient` interface), `:70-113` (the implementation)
- Test: `common/tests/dbClient.spec.ts` (create)

**Interfaces:**
- Consumes: `DbKey` (Task 3).
- Produces: `new BaseDB(dbName, schema, version?)` — `version` defaults to `1`. `DbClient.get(table, key: DbKey)`, `.getMany(table, keys: DbKey[])`, `.remove(table, key: DbKey)`, `.bulkRemove(table, keys: DbKey[])`.

- [ ] **Step 1: Write the failing test**

Create `common/tests/dbClient.spec.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import { dbClient } from "../db/dbClient";
import type { BaseDB } from "../db/baseDb";

function fakeDb() {
  const table = {
    get: vi.fn(async (key: unknown) => ({ key })),
    bulkGet: vi.fn(async (keys: unknown[]) => keys.map((key) => ({ key }))),
    delete: vi.fn(async () => undefined),
    bulkDelete: vi.fn(async () => undefined),
  };
  return { table, db: { table: () => table } as unknown as BaseDB };
}

describe("dbClient compound keys", () => {
  it("passes an array key through to Dexie unchanged", async () => {
    const { table, db } = fakeDb();
    await dbClient(db).get("productStoreFacilities", ["STORE_1", "FAC_1"]);

    expect(table.get).toHaveBeenCalledWith(["STORE_1", "FAC_1"]);
  });

  it("passes array keys through to bulkDelete unchanged", async () => {
    const { table, db } = fakeDb();
    await dbClient(db).bulkRemove("productStoreFacilities", [["STORE_1", "FAC_1"]]);

    expect(table.bulkDelete).toHaveBeenCalledWith([["STORE_1", "FAC_1"]]);
  });

  it("short-circuits an empty array key instead of treating it as present", async () => {
    const { table, db } = fakeDb();

    expect(await dbClient(db).get("productStoreFacilities", [])).toBeUndefined();
    expect(table.get).not.toHaveBeenCalled();
  });

  it("still short-circuits an empty string key", async () => {
    const { table, db } = fakeDb();

    expect(await dbClient(db).get("facilities", "")).toBeUndefined();
    expect(table.get).not.toHaveBeenCalled();
  });

  it("reads a numeric key, which a date key member produces", async () => {
    const { table, db } = fakeDb();
    await dbClient(db).get("syncRuns", 1700000000000);

    expect(table.get).toHaveBeenCalledWith(1700000000000);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run common/tests/dbClient.spec.ts`
Expected: FAIL — `get("productStoreFacilities", [])` currently returns a value, because `![]` is
`false` so the guard does not fire.

- [ ] **Step 3: Widen `dbClient`**

In `common/db/dbClient.ts`, import `DbKey`:

```ts
import type { DbKey, QueryOptions } from "./types";
```

Change the four key-taking signatures in the `DbClient` interface:

```ts
  get<T = Record<string, any>>(table: string, key: DbKey): Promise<T | undefined>;
  getMany<T = Record<string, any>>(table: string, keys: DbKey[]): Promise<T[]>;
  remove(table: string, key: DbKey): Promise<void>;
  bulkRemove(table: string, keys: DbKey[]): Promise<void>;
```

Change `tableOf` so Dexie's key generic admits an array:

```ts
  const tableOf = (table: string) => db.table<any, DbKey>(table);
```

And replace `get`'s guard, which a compound key defeats:

```ts
    async get(table, key) {
      // `!key` is wrong for a compound key: [] is truthy, and so is every valid array key.
      const missing = key === undefined || key === null || key === ""
        || (Array.isArray(key) && key.length === 0);
      if (missing) return undefined;

      return tableOf(table).get(key as any);
    },
```

- [ ] **Step 4: Add the `version` parameter to `BaseDB`**

In `common/db/baseDb.ts`, replace the constructor:

```ts
  /**
   * `version` is declared, not inferred. Dexie upgrades ADDITIVE changes in place — new tables,
   * added or removed secondary indexes — so bumping it is enough for those. It throws
   * "Not yet support for changing primary key" when a store's keyPath changes, which no version
   * bump can carry; `ensureDbReady` deletes and rebuilds the database in that case.
   */
  constructor(dbName: string, schema: Record<string, string>, version = 1) {
    super(dbName);
    const combinedSchema = {
      ...schema,
      syncMeta: "key",
    };
    this._tableNames = Object.keys(combinedSchema);
    this.version(version).stores(combinedSchema);
  }
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `pnpm vitest run common/tests`
Expected: `dbClient.spec.ts` PASS (5 tests). `defineAppDb.spec.ts` still passes — `version`
defaults to `1`, so its existing `new AppDatabase(dbName)` calls are unaffected.

- [ ] **Step 6: Commit**

```bash
git add common/db/dbClient.ts common/db/baseDb.ts common/tests/dbClient.spec.ts
git commit -m "feat(db): accept compound keys in dbClient; declare the schema version on BaseDB"
```

---

### Task 6: `snapshotDomain` on `Entity` and `DbKey`

**Files:**
- Modify: `common/db/sync/snapshotDomain.ts:39-44` (`keyOfRecord`), `:83-101`, `:113-116`, `:137-160`
- Test: `common/tests/snapshotDomain.keys.spec.ts` (create)

**Interfaces:**
- Consumes: `Entity` (Task 1), `entityKeyOf`/`canonicalKey`/`projectRow` (Tasks 3, 4).
- Produces: `SnapshotDomainConfig.projection` is now typed `Entity`. No exported function signatures change.

`pageAll`'s `keyOf` option stays `(record) => string | undefined` — it feeds a `Set<string>` for
cross-page dedup, so it needs a canonical string, not a `DbKey`. Deriving it by projecting the row
and then calling `entityKeyOf` guarantees the dedup key and the stored key can never disagree.

`config.byPk` and `config.refetchScope` need **no change at all**. Both already take
`pk: Record<string, unknown>` — a field map, not a key — so they were key-shape-agnostic before this
work and stay correct for a compound key. Do not touch them, and do not touch the `SEED_SOURCES`
entries that supply them.

- [ ] **Step 1: Write the failing test**

Create `common/tests/snapshotDomain.keys.spec.ts`. It imports the REAL exported helper, so this is a
genuine failing-test-first cycle rather than a copy of the production logic:

```ts
import { describe, expect, it } from "vitest";
import { defineEntity } from "../db/defineEntity";
import { canonicalKey, entityKeyOf, projectRow } from "../db/projection";
import { snapshotKeyOf } from "../db/sync/snapshotDomain";

const groupFacility = defineEntity({
  primaryKey: "facilityGroupId,facilityId,fromDate",
  fields: { facilityGroupId: "text", facilityId: "text", fromDate: "date", thruDate: "date" },
  indexes: ["facilityGroupId", "facilityId", "fromDate", "thruDate"],
});

describe("snapshotKeyOf", () => {
  it("derives a canonical dedup string from a raw server record", () => {
    const key = snapshotKeyOf(
      { facilityGroupId: "GRP1", facilityId: "FAC1", fromDate: 1700000000000 },
      groupFacility,
    );

    expect(key).toBe("GRP1\u0000FAC1\u00001700000000000");
  });

  it("returns a string, not a DbKey, because pageAll dedups through a Set", () => {
    const key = snapshotKeyOf({ facilityGroupId: "G", facilityId: "F", fromDate: 1 }, groupFacility);

    expect(typeof key).toBe("string");
  });

  it("returns undefined for a record missing a key member, so pageAll does not dedup on it", () => {
    expect(snapshotKeyOf({ facilityGroupId: "GRP1", facilityId: "FAC1" }, groupFacility))
      .toBeUndefined();
  });

  it("derives the same key from the raw record as from the row that gets stored", () => {
    const raw = { facilityGroupId: "GRP1", facilityId: "FAC1", fromDate: "2023-11-14T22:13:20.000Z" };
    const row = projectRow(raw, groupFacility, 500)!;

    expect(snapshotKeyOf(raw, groupFacility)).toBe(canonicalKey(entityKeyOf(row, groupFacility)!));
  });

  it("distinguishes two memberships of the same facility with different fromDates", () => {
    const a = snapshotKeyOf({ facilityGroupId: "G", facilityId: "F", fromDate: 1 }, groupFacility);
    const b = snapshotKeyOf({ facilityGroupId: "G", facilityId: "F", fromDate: 2 }, groupFacility);

    expect(a).not.toBe(b);
  });

  it("still keys a single-field entity by its bare value", () => {
    const facility = defineEntity({ primaryKey: "facilityId", fields: { facilityId: "text" } });

    expect(snapshotKeyOf({ facilityId: "FAC_1" }, facility)).toBe("FAC_1");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run common/tests/snapshotDomain.keys.spec.ts`
Expected: FAIL — `snapshotKeyOf` is not exported from `../db/sync/snapshotDomain` (the current
module has a private `keyOfRecord` that takes a whole config).

- [ ] **Step 3: Rewrite the key extraction in `snapshotDomain.ts`**

Update the imports:

```ts
import type { Entity } from "../defineEntity";
import type { DbKey, DbRow, SyncContext } from "../types";
import { canonicalKey, diffStaleKeys, entityKeyOf, isUnkeyableFetch, projectRow, projectRows } from "../projection";
```

Change `SnapshotDomainConfig`'s projection field to `projection: Entity;`, and change both
`keyOf: (r) => keyOfRecord(r, config)` callbacks (the fanOut branch and the plain-list branch in
`sync`, plus the one in `refetchOne`'s `refetchScope` branch — three in total) to
`keyOf: (r) => snapshotKeyOf(r, config.projection)`.

Replace `keyOfRecord`:

```ts
/**
 * The cross-page dedup key pageAll needs: a canonical STRING, not a DbKey, because it goes into a
 * Set. Derived by projecting the raw record first, so it is impossible for the dedup key and the
 * key the row is eventually stored under to disagree.
 *
 * Exported so it can be tested directly; takes the Entity rather than the whole config so the test
 * needs no fetch config to exercise it.
 */
export function snapshotKeyOf(record: any, entity: Entity): string | undefined {
  const row = projectRow(record, entity, 0);
  if (!row) return undefined;

  const key = entityKeyOf(row, entity);
  return key === undefined ? undefined : canonicalKey(key);
}

/** The stored keys of already-projected rows, dropping any that cannot be keyed. */
function keysOfRows(rows: DbRow[], entity: Entity): DbKey[] {
  const keys: DbKey[] = [];
  for (const row of rows) {
    const key = entityKeyOf(row, entity);
    if (key !== undefined) keys.push(key);
  }
  return keys;
}
```

In `sync`, replace the `freshKeys` line and the two `existingKeys` assignments:

```ts
      const freshRows = projectRows(rawRecords, config.projection, ctx.now);
      const freshKeys = keysOfRows(freshRows, config.projection);

      await db.transaction("rw", [config.table, "syncMeta"], async () => {
        const tableRef = db.table<DbRow, DbKey>(config.table);
        let existingKeys: DbKey[] = [];

        if (config.scopeOnSync) {
          const scoped = await tableRef.where(config.scopeOnSync.field).equals(config.scopeOnSync.value as any).toArray();
          existingKeys = keysOfRows(scoped, config.projection);
        } else {
          existingKeys = (await tableRef.toCollection().primaryKeys()) as DbKey[];
        }
```

Apply the same three replacements in `refetchOne`'s `refetchScope` branch, and change its
`const tableRef = db.table<DbRow, string>(config.table);` to `db.table<DbRow, DbKey>(config.table)`.

- [ ] **Step 4: Run the full framework suite**

Run: `pnpm vitest run common/tests`
Expected: `snapshotDomain.keys.spec.ts` PASS (6 tests). `seedEntities.spec.ts` and
`defineAppDb.spec.ts` now FAIL — they still reference `SEED_ENTITIES`, whose entities carry the
deleted `projection` shape. Tasks 7–9 fix them. Note the failure count before moving on.

- [ ] **Step 5: Commit**

```bash
git add common/db/sync/snapshotDomain.ts common/tests/snapshotDomain.keys.spec.ts
git commit -m "feat(db): derive snapshot keys through entityKeyOf, supporting compound keys"
```

---

### Task 7: Convert the 20 single-key seed entities

**Files:**
- Create: `common/db/domains/commonSchema.ts`
- Create: `common/db/domains/seedSources.ts`
- Test: `common/tests/commonSchema.spec.ts`, `common/tests/fixtures/seedSchemaAfter.json`

**Interfaces:**
- Consumes: `defineEntity` (Task 1), `defineSchema` (Task 2), `SeedSource` (moved from the deleted `seedEntities.ts`).
- Produces: `commonSchema: AppSchema`, `SEED_SOURCES: Record<string, SeedSourceEntry>`, `SEED_TABLE_NAMES: string[]`, `SEED_DOMAIN_NAMES: string[]`, and the type `SeedSourceEntry = { name: string; label: string; source: SeedSource }`. Tasks 8–11 consume these.

The `fields` map for each entity is **moved verbatim** from its existing projection in
`common/db/domains/seedEntities.ts` — no field is added, removed or re-typed in this task. The new
information per entity is only its `primaryKey` and `indexes`, given in full in the table below.

The domain `name` moves into `SEED_SOURCES` and stays **singular and unchanged**, so `syncMeta`
cursor keys, the status catalog and Company's registry names are all untouched.

**The 20 single-key entities.** `primaryKey` and `indexes` are read straight off the existing
`schema` string: the first segment becomes `primaryKey`, the rest become `indexes`.

| table | domain `name` | `primaryKey` | `indexes` |
|---|---|---|---|
| `productStores` | `productStore` | `productStoreId` | `["storeName"]` |
| `statuses` | `status` | `statusId` | `["statusTypeId"]` |
| `enums` | `enum` | `enumId` | `["enumTypeId", "enumCode"]` |
| `enumTypes` | `enumType` | `enumTypeId` | `["parentTypeId"]` |
| `facilities` | `facility` | `facilityId` | `["facilityTypeId", "parentTypeId", "ownerPartyId"]` |
| `facilityTypes` | `facilityType` | `facilityTypeId` | `["parentTypeId"]` |
| `facilityGroups` | `facilityGroup` | `facilityGroupId` | `["facilityGroupTypeId"]` |
| `geos` | `geo` | `geoId` | `["geoTypeEnumId", "geoCode"]` |
| `carriers` | `carrier` | `partyId` | `[]` |
| `shipmentMethodTypes` | `shipmentMethodType` | `shipmentMethodTypeId` | `[]` |
| `paymentMethodTypes` | `paymentMethodType` | `paymentMethodTypeId` | `[]` |
| `returnReasons` | `returnReason` | `returnReasonId` | `[]` |
| `returnTypes` | `returnType` | `returnTypeId` | `[]` |
| `returnItemTypes` | `returnItemType` | `returnItemTypeId` | `[]` |
| `roleTypes` | `roleType` | `roleTypeId` | `["parentTypeId"]` |
| `orderAdjustmentTypes` | `orderAdjustmentType` | `orderAdjustmentTypeId` | `[]` |
| `contactMechPurposeTypes` | `contactMechPurposeType` | `contactMechPurposeTypeId` | `[]` |
| `communicationEventTypes` | `communicationEventType` | `communicationEventTypeId` | `[]` |
| `partyRelationshipTypes` | `partyRelationshipType` | `partyRelationshipTypeId` | `[]` |
| `shopifyShops` | `shopifyShop` | `shopId` | `["productStoreId", "shopifyShopId"]` |

Two of these need an `indexes` entry that the old schema string had but whose field the old
projection did **not** declare — `defineEntity` will throw on them, which is the drift defect
working as designed:

- `facilityGroups` indexed `facilityGroupTypeId`; `facilityGroupProjection` is
  `lookup("facilityGroupId", { facilityGroupName: "text", facilityGroupTypeId: "text" })`, so the
  field **is** declared. No change needed.
- `facilities` indexed `parentTypeId` and `ownerPartyId`; `facilityProjection` declares both. No
  change needed.

If `defineEntity` throws for any entity in this task, the correct fix is to **add the field to
`fields`** (the index was intended and the projection was the thing that was wrong), not to drop the
index. Record which entity it was in the commit message.

- [ ] **Step 1: Write the failing test**

Create `common/tests/commonSchema.spec.ts`:

```ts
import { describe, expect, it } from "vitest";
import { commonSchema } from "../db/domains/commonSchema";
import { SEED_DOMAIN_NAMES, SEED_SOURCES, SEED_TABLE_NAMES } from "../db/domains/seedSources";
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
        expect(entity.fields[index], `${table}: index ${index} not projected`).toBeTruthy();
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
```

Create `common/tests/fixtures/seedSchemaAfter.json` with the 20 tables of this task (Task 8 adds the
remaining 9):

```json
{
  "schema": {
    "productStores": "productStoreId, storeName",
    "statuses": "statusId, statusTypeId",
    "enums": "enumId, enumTypeId, enumCode",
    "enumTypes": "enumTypeId, parentTypeId",
    "facilities": "facilityId, facilityTypeId, parentTypeId, ownerPartyId",
    "facilityTypes": "facilityTypeId, parentTypeId",
    "facilityGroups": "facilityGroupId, facilityGroupTypeId",
    "geos": "geoId, geoTypeEnumId, geoCode",
    "carriers": "partyId",
    "shipmentMethodTypes": "shipmentMethodTypeId",
    "paymentMethodTypes": "paymentMethodTypeId",
    "returnReasons": "returnReasonId",
    "returnTypes": "returnTypeId",
    "returnItemTypes": "returnItemTypeId",
    "roleTypes": "roleTypeId, parentTypeId",
    "orderAdjustmentTypes": "orderAdjustmentTypeId",
    "contactMechPurposeTypes": "contactMechPurposeTypeId",
    "communicationEventTypes": "communicationEventTypeId",
    "partyRelationshipTypes": "partyRelationshipTypeId",
    "shopifyShops": "shopId, productStoreId, shopifyShopId"
  }
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run common/tests/commonSchema.spec.ts`
Expected: FAIL — cannot resolve `../db/domains/commonSchema`.

- [ ] **Step 3: Create `seedSources.ts`**

Create `common/db/domains/seedSources.ts`. Move each entity's `label` and `source` **verbatim** from
`SEED_ENTITIES` in `seedEntities.ts`, keyed by table name, keeping the singular domain `name`:

```ts
/**
 * How each seed table is fetched, and what the Settings status card calls it.
 *
 * The sibling of `commonSchema.ts`, keyed by the same table names. Storage lives there; fetching
 * lives here. `name` is the sync DOMAIN name — deliberately still singular and unchanged, because
 * it keys `syncMeta` cursor rows, the status catalog and Company's own sync registry.
 */

import type { SnapshotDomainConfig } from "../sync/snapshotDomain";

/** Everything `registerSnapshotDomain` needs except what the entity already states. */
export type SeedSource = Omit<SnapshotDomainConfig, "name" | "table" | "projection">;

export interface SeedSourceEntry {
  /** Sync domain name — the status-catalog key and the syncMeta cursor key. */
  name: string;
  /** Human label for the Settings status card. */
  label: string;
  source: SeedSource;
}

export const SEED_SOURCES = {
  productStores: {
    name: "productStore",
    label: "Product Stores",
    source: {
      listUrl: "admin/productStores",
      collectionKey: null,
      byPk: (pk) => ({ url: `admin/productStores/${encodeURIComponent(String(pk.productStoreId))}` }),
    },
  },

  statuses: {
    name: "status",
    label: "Statuses",
    source: { listUrl: "admin/status", collectionKey: null, batchSize: 500 },
  },

  // ... one entry per table, `label` and `source` copied verbatim from SEED_ENTITIES ...
} satisfies Record<string, SeedSourceEntry>;

export type SeedTableName = keyof typeof SEED_SOURCES;

export const SEED_TABLE_NAMES = Object.keys(SEED_SOURCES) as SeedTableName[];

export const SEED_DOMAIN_NAMES = SEED_TABLE_NAMES.map((table) => SEED_SOURCES[table].name);
```

Copy all 29 entries (this task's 20 plus Task 8's 9 — the sources are unchanged by the key work, so
move them all at once and Task 8 only touches `commonSchema.ts`).

- [ ] **Step 4: Create `commonSchema.ts` with the 20 single-key entities**

Create `common/db/domains/commonSchema.ts`. Each `fields` map is copied verbatim from the
corresponding projection in `seedEntities.ts`. The `lookup` helper moves across unchanged:

```ts
/**
 * The 29 HotWax OMS seed reference tables, each declared exactly once.
 *
 * Keyed by IndexedDB store name, so `commonSchema.stores` is what Dexie's `version().stores()`
 * wants with no name/table mapping in between. `label` and `source` live in the sibling
 * `seedSources.ts`, keyed by the same table names.
 *
 * Imports only `defineEntity`/`defineSchema`, both of which import only `./types` — app db modules
 * reach this file and the sync workers import those, so nothing here may pull in `vue`.
 */

import { defineEntity } from "../defineEntity";
import { defineSchema } from "../defineSchema";
import type { FieldKind } from "../types";

/** A description-carrying lookup table: `<id>` plus `description`, plus whatever else is passed. */
const lookupFields = (
  keyField: string,
  extra: Record<string, FieldKind> = {},
): Record<string, FieldKind> => ({ [keyField]: "text", description: "text", ...extra });

export const commonSchema = defineSchema({
  productStores: defineEntity({
    primaryKey: "productStoreId",
    fields: {
      productStoreId: "text",
      storeName: "text",
      companyName: "text",
      inventoryFacilityId: "text",
      defaultCurrencyUomId: "text",
      externalId: "text",
      productIdentifierEnumId: "text",
      lastUpdatedStamp: "date",
    },
    indexes: ["storeName"],
  }),

  statuses: defineEntity({
    primaryKey: "statusId",
    fields: lookupFields("statusId", { statusTypeId: "text", statusAge: "count" }),
    indexes: ["statusTypeId"],
  }),

  enums: defineEntity({
    primaryKey: "enumId",
    fields: {
      enumId: "text",
      enumTypeId: "text",
      enumCode: "text",
      description: "text",
      typeDescription: "text",
      sequenceNum: "count",
    },
    indexes: ["enumTypeId", "enumCode"],
  }),

  enumTypes: defineEntity({
    primaryKey: "enumTypeId",
    fields: { enumTypeId: "text", parentTypeId: "text", description: "text" },
    indexes: ["parentTypeId"],
  }),

  facilities: defineEntity({
    primaryKey: "facilityId",
    fields: {
      facilityId: "text",
      facilityName: "text",
      facilityTypeId: "text",
      parentTypeId: "text",
      ownerPartyId: "text",
      maximumOrderLimit: "count",
      description: "text",
    },
    indexes: ["facilityTypeId", "parentTypeId", "ownerPartyId"],
  }),

  facilityTypes: defineEntity({
    primaryKey: "facilityTypeId",
    fields: lookupFields("facilityTypeId", { parentTypeId: "text" }),
    indexes: ["parentTypeId"],
  }),

  facilityGroups: defineEntity({
    primaryKey: "facilityGroupId",
    fields: lookupFields("facilityGroupId", {
      facilityGroupName: "text",
      facilityGroupTypeId: "text",
    }),
    indexes: ["facilityGroupTypeId"],
  }),

  geos: defineEntity({
    primaryKey: "geoId",
    fields: {
      geoId: "text",
      geoTypeEnumId: "text",
      geoName: "text",
      geoCode: "text",
      geoCodeAlpha2: "text",
      geoCodeAlpha3: "text",
    },
    indexes: ["geoTypeEnumId", "geoCode"],
  }),

  carriers: defineEntity({
    primaryKey: "partyId",
    fields: {
      partyId: "text",
      groupName: "text",
      firstName: "text",
      lastName: "text",
      roleTypeId: "text",
    },
  }),

  shipmentMethodTypes: defineEntity({
    primaryKey: "shipmentMethodTypeId",
    fields: lookupFields("shipmentMethodTypeId", { sequenceNum: "count" }),
  }),

  paymentMethodTypes: defineEntity({
    primaryKey: "paymentMethodTypeId",
    fields: lookupFields("paymentMethodTypeId", { paymentMethodCode: "text" }),
  }),

  returnReasons: defineEntity({
    primaryKey: "returnReasonId",
    fields: lookupFields("returnReasonId", { sequenceId: "count" }),
  }),

  returnTypes: defineEntity({
    primaryKey: "returnTypeId",
    fields: lookupFields("returnTypeId"),
  }),

  returnItemTypes: defineEntity({
    primaryKey: "returnItemTypeId",
    fields: lookupFields("returnItemTypeId"),
  }),

  roleTypes: defineEntity({
    primaryKey: "roleTypeId",
    fields: lookupFields("roleTypeId", { parentTypeId: "text" }),
    indexes: ["parentTypeId"],
  }),

  orderAdjustmentTypes: defineEntity({
    primaryKey: "orderAdjustmentTypeId",
    fields: lookupFields("orderAdjustmentTypeId", { hasTable: "text" }),
  }),

  contactMechPurposeTypes: defineEntity({
    primaryKey: "contactMechPurposeTypeId",
    fields: lookupFields("contactMechPurposeTypeId"),
  }),

  communicationEventTypes: defineEntity({
    primaryKey: "communicationEventTypeId",
    fields: lookupFields("communicationEventTypeId"),
  }),

  partyRelationshipTypes: defineEntity({
    primaryKey: "partyRelationshipTypeId",
    fields: lookupFields("partyRelationshipTypeId", { parentTypeId: "text" }),
  }),

  shopifyShops: defineEntity({
    primaryKey: "shopId",
    fields: {
      shopId: "text",
      productStoreId: "text",
      shopifyShopId: "text",
      name: "text",
      // Read by views/OrderDetail.vue to build the Shopify admin order link.
      myshopifyDomain: "text",
      domain: "text",
      systemMessageRemoteId: "text",
    },
    indexes: ["productStoreId", "shopifyShopId"],
  }),
});
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm vitest run common/tests/commonSchema.spec.ts`
Expected: The `stores` and pk/index-are-projected assertions PASS. The
"declares every table that SEED_SOURCES describes" assertion FAILS, because `SEED_SOURCES` has all
29 and `commonSchema` has 20. That is expected — Task 8 closes it.

- [ ] **Step 6: Commit**

```bash
git add common/db/domains/commonSchema.ts common/db/domains/seedSources.ts \
        common/tests/commonSchema.spec.ts common/tests/fixtures/seedSchemaAfter.json
git commit -m "feat(db): declare the 20 single-key seed entities via defineEntity"
```

---

### Task 8: Convert the 9 compound-key seed entities

**Files:**
- Modify: `common/db/domains/commonSchema.ts`
- Modify: `common/tests/fixtures/seedSchemaAfter.json`
- Test: `common/tests/commonSchema.spec.ts`

**Interfaces:**
- Consumes: everything from Task 7.
- Produces: `commonSchema` complete at 29 tables. No new exports.

**Each of these deletes a synthetic key column and its `buildKey`.** The `fields` map is the old
projection's map **minus** the synthetic key field.

| table | domain `name` | `primaryKey` | `indexes` | deleted column |
|---|---|---|---|---|
| `groupFacilities` | `groupFacility` | `facilityGroupId,facilityId,fromDate` | `["facilityGroupId", "facilityId", "fromDate", "thruDate"]` | `memberKey` |
| `geoAssocs` | `geoAssoc` | `geoId,toGeoId` | `["geoId", "toGeoId", "geoAssocTypeEnumId"]` | `geoAssocKey` |
| `carrierShipmentMethods` | `carrierShipmentMethod` | `partyId,shipmentMethodTypeId` | `["partyId", "shipmentMethodTypeId"]` | `carrierShipmentMethodKey` |
| `statusFlowTransitions` | `statusFlowTransition` | `statusFlowId,statusId,toStatusId` | `["statusId", "toStatusId", "statusFlowId"]` | `transitionKey` |
| `productStoreFacilities` | `productStoreFacility` | `productStoreId,facilityId` | `["productStoreId", "facilityId"]` | `storeFacilityKey` |
| `productStoreFacilityGroups` | `productStoreFacilityGroup` | `productStoreId,facilityGroupId` | `["productStoreId", "facilityGroupId"]` | `storeFacilityGroupKey` |
| `productStoreShipmentMethods` | `productStoreShipmentMethod` | `productStoreShipMethId` (surrogate, **single-key**) | `["productStoreId", "shipmentMethodTypeId", "partyId"]` | `storeShipmentMethodKey` |
| `productStoreEmailSettings` | `productStoreEmailSetting` | `productStoreId,emailTypeEnumId` | `["productStoreId", "emailTypeEnumId"]` | `emailSettingKey` |
| `shopifyShopLocations` | `shopifyShopLocation` | `shopId,shopifyLocationId` | `["shopId", "facilityId", "shopifyLocationId"]` | `locationKey` |

**Three `rename` entries replace a `||` fallback the old `buildKey` performed:**

- `geoAssocs`: `rename: { toGeoId: "geoIdTo" }` — was `raw?.toGeoId || raw?.geoIdTo`
- `productStoreEmailSettings`: `rename: { emailTypeEnumId: "emailType" }` — was `raw?.emailTypeEnumId || raw?.emailType`
- `productStoreShipmentMethods`: `rename: { partyId: "carrierPartyId" }` — was `raw?.partyId || raw?.carrierPartyId`

Note `productStoreShipmentMethodProjection` currently declares **both** `partyId` and
`carrierPartyId` as fields. Keep both declared (a caller may read `carrierPartyId`), and add the
`rename` so `partyId` — now a key member — is populated when only `carrierPartyId` came back.

**Two entities tighten a tolerated-missing member.** These were decided in the spec and must be
**confirmed against a live API response** before committing:

- `groupFacilities` — old `buildKey` used `${raw?.fromDate ?? ""}`. `fromDate` is now a required key
  member. Confirm `oms/groupFacilities` always returns it.
- `statusFlowTransitions` — RESOLVED by decision: `statusFlowId,statusId,toStatusId`, all three
  required. The endpoint is `admin/statusFlows/transitions`, so a transition inherently belongs to a
  flow, and `statusFlowId` is part of the entity PK in the Moqui model — the old `?? ""` was
  defensive coding rather than a real case. Accepted risk: a row genuinely missing `statusFlowId`
  is dropped rather than stored.
- `productStoreShipmentMethods` — RESOLVED by decision: key on the surrogate `productStoreShipMethId`
  instead of any natural combination. `productStoreShipMethId` is NOT in the old projection, so it
  must be ADDED to `fields`. The accepted risk is that if the endpoint does not return that field,
  every row becomes unkeyable — but that failure is LOUD and safe, not silent: `isUnkeyableFetch`
  trips, logs "fetched N records but keys could not be built", and ABORTS the snapshot rather than
  pruning the table. So the table simply stays empty and says so. Verify on an instance with data
  when one is available.

If either field is genuinely absent in a live response, **drop it from `primaryKey`** and record why
in the commit message — do not reintroduce a synthetic column. Dropping `fromDate` collapses
successive memberships of the same facility in the same group; dropping `statusFlowId` collapses the
same transition across flows. Either is a real semantic loss, so prefer keeping the member if the API
supplies it.

- [ ] **Step 1: Extend the fixture**

Add these 9 entries to `schema` in `common/tests/fixtures/seedSchemaAfter.json`:

```json
    "groupFacilities": "[facilityGroupId+facilityId+fromDate], facilityGroupId, facilityId, fromDate, thruDate",
    "geoAssocs": "[geoId+toGeoId], geoId, toGeoId, geoAssocTypeEnumId",
    "carrierShipmentMethods": "[partyId+shipmentMethodTypeId], partyId, shipmentMethodTypeId",
    "statusFlowTransitions": "[statusFlowId+statusId+toStatusId], statusId, toStatusId, statusFlowId",
    "productStoreFacilities": "[productStoreId+facilityId], productStoreId, facilityId",
    "productStoreFacilityGroups": "[productStoreId+facilityGroupId], productStoreId, facilityGroupId",
    "productStoreShipmentMethods": "productStoreShipMethId, productStoreId, shipmentMethodTypeId, partyId",
    "productStoreEmailSettings": "[productStoreId+emailTypeEnumId], productStoreId, emailTypeEnumId",
    "shopifyShopLocations": "[shopId+shopifyLocationId], shopId, facilityId, shopifyLocationId"
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run common/tests/commonSchema.spec.ts`
Expected: FAIL — `commonSchema.stores` is missing all 9 tables.

- [ ] **Step 3: Add the 9 entities to `commonSchema.ts`**

Append inside the `defineSchema({ ... })` call:

```ts
  groupFacilities: defineEntity({
    // Real compound key. OFBiz FacilityGroupMember is (facilityGroupId, facilityId, fromDate);
    // the old synthetic `memberKey` joined those three into one string.
    primaryKey: "facilityGroupId,facilityId,fromDate",
    fields: {
      facilityGroupId: "text",
      facilityId: "text",
      facilityName: "text",
      facilityGroupName: "text",
      facilityTypeId: "text",
      fromDate: "date",
      thruDate: "date",
    },
    indexes: ["facilityGroupId", "facilityId", "fromDate", "thruDate"],
  }),

  geoAssocs: defineEntity({
    primaryKey: "geoId,toGeoId",
    fields: {
      geoId: "text",
      toGeoId: "text",
      geoAssocTypeEnumId: "text",
    },
    indexes: ["geoId", "toGeoId", "geoAssocTypeEnumId"],
    // The list response names the far side `geoIdTo` on some routes.
    rename: { toGeoId: "geoIdTo" },
  }),

  carrierShipmentMethods: defineEntity({
    primaryKey: "partyId,shipmentMethodTypeId",
    fields: {
      partyId: "text",
      shipmentMethodTypeId: "text",
      roleTypeId: "text",
      sequenceNumber: "count",
    },
    indexes: ["partyId", "shipmentMethodTypeId"],
  }),

  statusFlowTransitions: defineEntity({
    primaryKey: "statusFlowId,statusId,toStatusId",
    fields: {
      statusId: "text",
      toStatusId: "text",
      statusFlowId: "text",
      transitionSequence: "count",
    },
    indexes: ["statusId", "toStatusId", "statusFlowId"],
  }),

  productStoreFacilities: defineEntity({
    primaryKey: "productStoreId,facilityId",
    fields: {
      productStoreId: "text",
      facilityId: "text",
      facilityName: "text",
      facilityTypeId: "text",
      sequenceNum: "count",
      fromDate: "date",
    },
    indexes: ["productStoreId", "facilityId"],
  }),

  productStoreFacilityGroups: defineEntity({
    primaryKey: "productStoreId,facilityGroupId",
    fields: {
      productStoreId: "text",
      facilityGroupId: "text",
      fromDate: "date",
    },
    indexes: ["productStoreId", "facilityGroupId"],
  }),

  productStoreShipmentMethods: defineEntity({
    // OFBiz ProductStoreShipmentMeth is keyed by a SURROGATE id, not by the natural triple, and
    // Company's own `productStoreShippingMethods` table already keys on it. The old synthetic
    // `storeShipmentMethodKey` joined productStore + method + party, and tolerated NO party at
    // all (`partyId || carrierPartyId || ""`), so a natural compound key would have had to either
    // drop carrier-less rows or collide on them. The surrogate avoids both.
    primaryKey: "productStoreShipMethId",
    fields: {
      productStoreShipMethId: "text",
      productStoreId: "text",
      shipmentMethodTypeId: "text",
      partyId: "text",
      carrierPartyId: "text",
      description: "text",
    },
    indexes: ["productStoreId", "shipmentMethodTypeId", "partyId"],
    // Some routes name the carrier only `carrierPartyId`; keep `partyId` populated either way.
    rename: { partyId: "carrierPartyId" },
  }),

  productStoreEmailSettings: defineEntity({
    primaryKey: "productStoreId,emailTypeEnumId",
    fields: {
      productStoreId: "text",
      emailTypeEnumId: "text",
      subject: "text",
      bodyScreenLocation: "text",
      systemMessageRemoteId: "text",
    },
    indexes: ["productStoreId", "emailTypeEnumId"],
    rename: { emailTypeEnumId: "emailType" },
  }),

  shopifyShopLocations: defineEntity({
    primaryKey: "shopId,shopifyLocationId",
    fields: {
      shopId: "text",
      facilityId: "text",
      shopifyLocationId: "text",
    },
    indexes: ["shopId", "facilityId", "shopifyLocationId"],
  }),
```

Every `fields` map above is its old projection's map minus the synthetic key column — no field is
added. Verify each against `git show HEAD~2:common/db/domains/seedEntities.ts` before committing.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run common/tests/commonSchema.spec.ts`
Expected: PASS — all 6 tests, including "has no synthetic key column left anywhere" and "declares
every table that SEED_SOURCES describes".

- [ ] **Step 5: Commit**

```bash
git add common/db/domains/commonSchema.ts common/tests/fixtures/seedSchemaAfter.json
git commit -m "feat(db)!: give the 9 composite seed entities real Dexie compound keys"
```

---

### Task 9: New `defineAppDb` signature; delete the superseded modules

**Files:**
- Modify: `common/db/defineAppDb.ts` (delete `composeAppSchema`, `assertDistinctSeedTables`, `AppDbDefinition.seed`, `.extendIndexes`)
- Modify: `common/db/sync/registerSeedDomains.ts`
- Modify: `common/db/domains/commonSeedDomains.ts`
- Modify: `common/db/index.ts`
- Delete: `common/db/domains/seedEntities.ts`, `common/db/domains/commonSeedEntities.ts`
- Modify: `common/tests/defineAppDb.spec.ts`
- Delete: `common/tests/seedEntities.spec.ts` (its assertions move to `commonSchema.spec.ts`, except the source-config ones, which move into `defineAppDb.spec.ts`)

**Interfaces:**
- Consumes: `AppSchema` (Task 2), `commonSchema`/`SEED_SOURCES`/`SEED_TABLE_NAMES` (Tasks 7–8).
- Produces: `defineAppDb(def: { suffix: string; version?: number; schema: AppSchema }): AppDb`, where `AppDb` keeps `name`, `get`, `setOmsInstanceResolver`, `raw`, `client`, `schema`, `tableNames`, `statusCatalog` and gains `entities: Record<string, Entity>`, replacing `seed: SeedEntity[]`. `registerSeedDomains(appDb)` unchanged in name.

`COMMON_DB_SCHEMA` is deleted — `commonSchema.stores` is the replacement, and no app imports it.

- [ ] **Step 1: Extend `defineEntity` to accept compound secondary indexes**

Company's tables carry compound SECONDARY indexes (`[configId+createdDate]` and nine more), and its
comments record measured findings about why each exists. `defineEntity` validates each `indexes`
entry against `fields`, and `[a+b]` is not a field name, so it must learn the form now — before any
Company task needs it.

Add to `common/tests/defineEntity.spec.ts`:

```ts
  it("accepts a compound secondary index and emits it verbatim", () => {
    const entity = defineEntity({
      primaryKey: "logId",
      fields: { logId: "text", configId: "text", createdDate: "date" },
      indexes: ["configId", "[configId+createdDate]"],
    });

    expect(entity.schema).toBe("logId, configId, [configId+createdDate]");
  });

  it("throws when a compound index names an unprojected field", () => {
    expect(() => defineEntity({
      primaryKey: "logId",
      fields: { logId: "text", configId: "text" },
      indexes: ["[configId+createdDate]"],
    })).toThrow(/compound index "\[configId\+createdDate\]" names "createdDate"/);
  });
```

Run `pnpm vitest run common/tests/defineEntity.spec.ts`, confirm both fail, then add this inside the
index loop in `common/db/defineEntity.ts` — after the duplicate-index and pk-restatement checks,
before the plain-field check:

```ts
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
```

Confirm both pass (18 tests total in this file now).

- [ ] **Step 2: Rewrite `defineAppDb.spec.ts`**

Replace the `composeAppSchema` and `composeAppSchema validation` describe blocks — that function is
gone; `defineSchema.spec.ts` covers its replacements. Keep every `defineAppDb` and
`registerSeedDomains` test, retargeting the constructor. Replace the file's header and those blocks
with:

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";
import { defineEntity } from "../db/defineEntity";
import { defineSchema, mergeSchemas } from "../db/defineSchema";
import { defineAppDb } from "../db/defineAppDb";
import { commonSchema } from "../db/domains/commonSchema";
import { SEED_DOMAIN_NAMES, SEED_SOURCES } from "../db/domains/seedSources";
import { registerSeedDomains } from "../db/sync/registerSeedDomains";
import { clearSyncRegistry, getAllSyncDomains } from "../db/sync/syncRegistry";

const ownSchema = defineSchema({
  widgets: defineEntity({
    primaryKey: "widgetId",
    fields: { widgetId: "text", statusId: "text" },
    indexes: ["statusId"],
  }),
});

const picked = () => commonSchema.pick(["facilities", "productStores"]);

describe("defineAppDb schema composition", () => {
  it("composes the picked seed tables with the app's own", () => {
    const db = defineAppDb({ suffix: "TestDB", schema: mergeSchemas(picked(), ownSchema) });

    expect(Object.keys(db.schema).sort()).toEqual(["facilities", "productStores", "widgets"]);
  });

  it("lists the composed data tables; BaseDB adds syncMeta on top", () => {
    const db = defineAppDb({ suffix: "TestDB", schema: ownSchema });

    expect(db.tableNames).toEqual(["widgets"]);
    expect(db.tableNames).not.toContain("syncMeta");
  });

  it("derives a status catalog that always matches the composed seed tables", () => {
    const db = defineAppDb({ suffix: "TestDB", schema: mergeSchemas(picked(), ownSchema) });

    expect(db.statusCatalog.map((entry) => entry.name).sort()).toEqual(["facility", "productStore"]);
  });

  it("leaves an own table out of the status catalog, having no seed source", () => {
    const db = defineAppDb({ suffix: "TestDB", schema: ownSchema });

    expect(db.statusCatalog).toEqual([]);
  });

  it("throws on an empty suffix", () => {
    expect(() => defineAppDb({ suffix: "", schema: ownSchema })).toThrow(/non-empty `suffix`/);
  });
});

describe("registerSeedDomains", () => {
  beforeEach(() => clearSyncRegistry());

  it("registers only the composed seed tables, under their domain names", () => {
    const db = defineAppDb({ suffix: "TestDB", schema: mergeSchemas(picked(), ownSchema) });
    registerSeedDomains(db);

    expect(getAllSyncDomains().map((d) => d.name).sort()).toEqual(["facility", "productStore"]);
  });

  it("registers nothing when the app composes no seed table", () => {
    registerSeedDomains(defineAppDb({ suffix: "TestDB", schema: ownSchema }));

    expect(getAllSyncDomains()).toEqual([]);
  });

  it("registers every seed domain when the whole common schema is taken", () => {
    registerSeedDomains(defineAppDb({ suffix: "TestDB", schema: commonSchema }));

    expect(getAllSyncDomains().map((d) => d.name).sort()).toEqual([...SEED_DOMAIN_NAMES].sort());
  });
});

describe("seed fetch config", () => {
  it("re-lists and snapshots just the one facility group, pruning members that left it", () => {
    const { refetchScope } = SEED_SOURCES.groupFacilities.source;
    expect(refetchScope).toBeTypeOf("function");

    expect(refetchScope!({ facilityGroupId: "GRP1" })).toEqual({
      params: { facilityGroupId: "GRP1" },
      scope: { field: "facilityGroupId", value: "GRP1" },
    });
  });

  it("scopes the carrier list to the CARRIER role", () => {
    expect(SEED_SOURCES.carriers.source.listUrl).toBe("oms/shippingGateways/carrierParties");
    expect(SEED_SOURCES.carriers.source.listParams).toEqual({ roleTypeId: "CARRIER" });
  });

  it("fans productStoreFacility out over cached product stores", () => {
    const { fanOut } = SEED_SOURCES.productStoreFacilities.source;

    expect(fanOut?.parentTable).toBe("productStores");
    expect(fanOut?.parentKeyField).toBe("productStoreId");
    expect(fanOut?.urlFor("STORE 1")).toBe("oms/productStores/STORE%201/facilities");
  });
});
```

Keep the existing `describe("defineAppDb", ...)` block (naming per instance, refusing to share a
database, handle reuse, closing the superseded handle, `raw()` throwing without a resolver) exactly
as it is, changing only its `defineAppDb({...})` construction to `{ suffix, schema: ownSchema }`.

- [ ] **Step 3: Run test to verify it fails**

Run: `pnpm vitest run common/tests/defineAppDb.spec.ts`
Expected: FAIL — `defineAppDb` still requires `seed` and rejects an `AppSchema` as `schema`.

- [ ] **Step 4: Rewrite `defineAppDb.ts`**

Replace the definition and the composition half of the file:

```ts
import type { AppSchema } from "./defineSchema";
import type { Entity } from "./defineEntity";
import type { SyncDomainCatalogItem } from "./useDbStatus";
import { SEED_SOURCES } from "./domains/seedSources";
import { BaseDB } from "./baseDb";
import { type DbClient, dbClient } from "./dbClient";

export interface AppDbDefinition {
  /** Name suffix: "CompanyDB" produces `{omsInstance}-CompanyDB`. */
  suffix: string;
  /**
   * Dexie schema version. Additive changes — a new table, an added or removed secondary index —
   * upgrade in place on a bump. A changed primary key cannot; see BaseDB's constructor.
   */
  version?: number;
  /** The composed schema: `commonSchema.pick([...])` merged with the app's own via `mergeSchemas`. */
  schema: AppSchema;
}

export interface AppDb {
  /** `{omsInstance}-{suffix}`. Throws on an empty instance. */
  name(omsInstance: string): string;
  /** The database for an instance. Worker-safe: the instance is a parameter. */
  get(omsInstance: string): BaseDB;
  /** Register how the app finds the signed-in instance. Called once per JS realm at boot. */
  setOmsInstanceResolver(resolve: () => string): void;
  /** Raw Dexie handle for the signed-in instance. Main thread, or a worker after start(). */
  raw(): BaseDB;
  /** DbClient for the signed-in instance, resolved per call so reads follow a switch. */
  client(): DbClient;
  readonly schema: Record<string, string>;
  readonly entities: Record<string, Entity>;
  /** The composed data tables. Excludes `syncMeta`, which BaseDB injects. */
  readonly tableNames: string[];
  /** One entry per composed table that has a seed source. The app's own tables are absent. */
  readonly statusCatalog: SyncDomainCatalogItem[];
}

export function defineAppDb(def: AppDbDefinition): AppDb {
  if(!def.suffix) {
    throw new Error("[db] defineAppDb: a non-empty `suffix` is required.");
  }

  const stores = def.schema.stores;
  const version = def.version ?? 1;

  // Derived from the composed tables, so it can never list a table the database does not have.
  const statusCatalog: SyncDomainCatalogItem[] = Object.keys(stores)
    .filter((table) => table in SEED_SOURCES)
    .map((table) => ({
      name: SEED_SOURCES[table as keyof typeof SEED_SOURCES].name,
      table,
      label: SEED_SOURCES[table as keyof typeof SEED_SOURCES].label,
      syncClass: "B" as const,
    }));

  class AppDatabase extends BaseDB {
    constructor(dbName: string) {
      super(dbName, stores, version);
    }
  }
```

Keep the existing `activeDb` / `resolveOmsInstance` closure, `name`, `get` and `raw` bodies verbatim,
and change only the returned object's tail:

```ts
  return {
    name,
    get,
    setOmsInstanceResolver(resolve) {
      resolveOmsInstance = resolve;
    },
    raw,
    client: () => dbClient(raw()),
    schema: stores,
    entities: def.schema.entities,
    tableNames: Object.keys(stores),
    statusCatalog,
  };
}
```

Delete `composeAppSchema`, `assertDistinctSeedTables`, `ComposedAppSchema` and the
`seedEntitiesFor`/`SeedEntity` imports.

- [ ] **Step 5: Rewrite `registerSeedDomains.ts`**

```ts
/**
 * Register the snapshot sync domains for exactly the seed tables an app composed.
 *
 * Worker-side (and main-thread bootstrap) only — this module imports the fetch layer.
 */

import type { AppDb } from "../defineAppDb";
import { SEED_SOURCES } from "../domains/seedSources";
import { registerSnapshotDomain } from "./snapshotDomain";

export function registerSeedDomains(appDb: AppDb): void {
  for (const [table, entity] of Object.entries(appDb.entities)) {
    const seed = SEED_SOURCES[table as keyof typeof SEED_SOURCES];
    if(!seed) continue; // an app's own table has no seed source

    registerSnapshotDomain(
      { name: seed.name, table, projection: entity, ...seed.source },
      (omsInstance) => appDb.get(omsInstance),
    );
  }
}
```

- [ ] **Step 6: Rewrite `commonSeedDomains.ts`**

```ts
/**
 * Register all 29 seed domains. Kept for backwards compatibility.
 *
 * Prefer `registerSeedDomains(appDb)`, which registers exactly the tables the app composed.
 */

import { registerSnapshotDomain } from "../sync/snapshotDomain";
import type { BaseDB } from "../baseDb";
import { commonSchema } from "./commonSchema";
import { SEED_SOURCES, SEED_TABLE_NAMES } from "./seedSources";

export function registerCommonSeedDomains(getDb: (omsInstance: string) => BaseDB): void {
  for (const table of SEED_TABLE_NAMES) {
    const seed = SEED_SOURCES[table];
    registerSnapshotDomain(
      { name: seed.name, table, projection: commonSchema.entities[table], ...seed.source },
      getDb,
    );
  }
}
```

- [ ] **Step 7: Delete the superseded modules and update the barrel**

```bash
git rm common/db/domains/seedEntities.ts common/db/domains/commonSeedEntities.ts \
       common/tests/seedEntities.spec.ts
```

In `common/db/index.ts`, replace the two deleted export lines with the new modules:

```ts
export * from "./defineEntity";
export * from "./defineSchema";
export * from "./domains/commonSchema";
export * from "./domains/seedSources";
```

and delete `export * from "./domains/seedEntities";` and
`export * from "./domains/commonSeedEntities";`.

- [ ] **Step 8: Run the full framework suite**

Run: `pnpm vitest run common/tests`
Expected: PASS for every db spec — `defineEntity` 18 (16 from Task 1 plus 2 added in Task 12), `defineSchema` 15, `projection` 19,
`dbClient` 5, `snapshotDomain.keys` 4, `commonSchema` 6, `defineAppDb` (retargeted). Only the two
pre-existing failures remain: `commonUtil.spec.ts` (4) and `useSolrSearch.spec.ts`.

- [ ] **Step 9: Commit**

```bash
git add -A common/db common/tests
git commit -m "feat(db)!: compose defineAppDb from an AppSchema; retire SEED_ENTITIES"
```

---

### Task 9b: Seed provenance on `AppSchema`

**Files:**
- Modify: `common/db/defineSchema.ts` (add `seedTables` to `AppSchema`; `defineSchema` gains an options arg)
- Modify: `common/db/domains/commonSchema.ts` (mark itself as the seed schema)
- Modify: `common/db/defineAppDb.ts` (`statusCatalog` and `AppDb` use provenance, not table-name lookup)
- Modify: `common/db/sync/registerSeedDomains.ts` (skip app-owned tables by provenance)
- Delete: `common/db/domains/commonSeedDomains.ts` (dead: zero callers repo-wide)
- Modify: `common/db/index.ts` (drop the deleted export)
- Test: `common/tests/defineSchema.spec.ts`, `common/tests/defineAppDb.spec.ts`

**Interfaces:**
- Consumes: `Entity`, `AppSchema`, `commonSchema`, `SEED_SOURCES`.
- Produces: `AppSchema.seedTables: ReadonlySet<string>`; `defineSchema(map, options?: { seed?: boolean })`; `AppDb.seedTables: ReadonlySet<string>`.

**Why this task exists.** Task 9 made `defineAppDb.statusCatalog` and `registerSeedDomains` decide
"is this a seed table?" by looking the TABLE NAME up in `SEED_SOURCES`. That is wrong, and Task 9's
review caught it. Five of Company's own tables share a name with a seed table —
`statuses`, `carriers`, `carrierShipmentMethods`, `facilityGroups`, `shopifyShops` — and every one
of them is a **documented deliberate rejection** of the seed version, recorded in
`apps/company/src/db/companyDb.ts:23-36`:

- `statuses` — the framework fetches `admin/status`, Company fetches `oms/statuses`.
- `carriers` / `carrierShipmentMethods` — the seed omits Company's `listParams: { roleTypeId: "CARRIER" }`, `refetchScope` and `strictCollection`.
- `facilityGroups` — the seed omits Company's `refetchScope`.
- `shopifyShops` — the seed omits Company's `byPk`, **whose comment documents a real previously-fixed bug**: a `refetchScope` keyed on `productStoreId` silently re-listed every shop instead of the one that changed.

Under table-name keying, all five would acquire a spurious `statusCatalog` row AND a snapshot domain
pointed at the framework's endpoint and fetch config. For `shopifyShops` that resurrects the fixed
bug. The old design could not make this mistake, because `defineAppDb({ seed: [...] })` listed the
picks explicitly; the deleted test "allows an own table whose name matches an UNPICKED seed table"
was that guard. Provenance restores it structurally rather than by convention.

Note this is why the fix must land BEFORE Task 15 composes Company's database.

- [ ] **Step 1: Write the failing tests**

Add to `common/tests/defineSchema.spec.ts`:

```ts
describe("seed provenance", () => {
  it("marks nothing as a seed table by default", () => {
    expect(base().seedTables.size).toBe(0);
  });

  it("marks every table when the schema declares itself the seed schema", () => {
    const seed = defineSchema({ facilities, productStores }, { seed: true });

    expect([...seed.seedTables].sort()).toEqual(["facilities", "productStores"]);
  });

  it("narrows provenance through pick", () => {
    const seed = defineSchema({ facilities, productStores }, { seed: true });

    expect([...seed.pick(["facilities"]).seedTables]).toEqual(["facilities"]);
  });

  it("preserves provenance through extendIndexes", () => {
    const seed = defineSchema({ facilities }, { seed: true });

    expect([...seed.extendIndexes({ facilities: ["ownerPartyId"] }).seedTables]).toEqual(["facilities"]);
  });

  it("keeps the two sides distinct when merged, even on a NAME COLLISION-free merge", () => {
    const seed = defineSchema({ facilities }, { seed: true });
    const own = defineSchema({ widgets: defineEntity({ primaryKey: "widgetId", fields: { widgetId: "text" } }) });
    const merged = mergeSchemas(seed, own);

    expect(merged.seedTables.has("facilities")).toBe(true);
    expect(merged.seedTables.has("widgets")).toBe(false);
  });

  it("treats an app's OWN table as app-owned even when its name matches a seed table", () => {
    // The real case: Company declares its own `statuses` because the framework fetches
    // admin/status while Company fetches oms/statuses.
    const own = defineSchema({ statuses: defineEntity({ primaryKey: "statusId", fields: { statusId: "text" } }) });

    expect(own.seedTables.has("statuses")).toBe(false);
  });
});
```

Add to `common/tests/defineAppDb.spec.ts`:

```ts
describe("provenance keeps an app's own table out of the seed machinery", () => {
  // Mirrors Company: its own `statuses` table, same name as the seed one, different endpoint.
  const ownStatuses = defineSchema({
    statuses: defineEntity({ primaryKey: "statusId", fields: { statusId: "text", statusTypeId: "text" } }),
  });

  it("omits it from statusCatalog", () => {
    const db = defineAppDb({ suffix: "TestDB", schema: ownStatuses });

    expect(db.statusCatalog).toEqual([]);
  });

  it("registers no seed domain for it", () => {
    clearSyncRegistry();
    registerSeedDomains(defineAppDb({ suffix: "TestDB", schema: ownStatuses }));

    expect(getAllSyncDomains()).toEqual([]);
  });

  it("still registers the seed table when it IS picked", () => {
    clearSyncRegistry();
    registerSeedDomains(defineAppDb({ suffix: "TestDB", schema: commonSchema.pick(["statuses"]) }));

    expect(getAllSyncDomains().map((d) => d.name)).toEqual(["status"]);
  });
});
```

- [ ] **Step 2: Run and confirm they fail**

Run: `pnpm vitest run common/tests/defineSchema.spec.ts common/tests/defineAppDb.spec.ts`
Expected: FAIL — `seedTables` does not exist, and the own-`statuses` cases currently pick up the
seed source by name.

- [ ] **Step 3: Add provenance to `defineSchema.ts`**

Add `seedTables: ReadonlySet<string>` to the `AppSchema` interface, thread it through `build`, and
give `defineSchema` an options argument:

```ts
function build(entities: Record<string, Entity>, seedTables: ReadonlySet<string>): AppSchema {
  return {
    entities,
    stores: storesOf(entities),
    seedTables,

    pick(tables) {
      const picked: Record<string, Entity> = {};
      for (const table of tables) {
        const entity = entities[table];
        if(!entity) {
          throw new Error(`[db] defineSchema: pick names "${table}", which is not a table in this schema.`);
        }
        picked[table] = entity;
      }
      return build(picked, new Set(tables.filter((t) => seedTables.has(t))));
    },

    extendIndexes(map) {
      /* ...unchanged body... */
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
export function defineSchema(
  map: Record<string, Entity>,
  options: { seed?: boolean } = {},
): AppSchema {
  if("syncMeta" in map) {
    throw new Error('[db] defineSchema: "syncMeta" is provided by BaseDB and must not be declared.');
  }
  return build({ ...map }, new Set(options.seed ? Object.keys(map) : []));
}

export function mergeSchemas(...schemas: AppSchema[]): AppSchema {
  const merged: Record<string, Entity> = {};
  const mergedSeed = new Set<string>();

  for (const schema of schemas) {
    for (const [table, entity] of Object.entries(schema.entities)) {
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

  return build(merged, mergedSeed);
}
```

- [ ] **Step 4: Mark `commonSchema` as the seed schema**

In `common/db/domains/commonSchema.ts`, close the `defineSchema` call with the options argument:

```ts
export const commonSchema = defineSchema({
  /* ...the 29 entities, unchanged... */
}, { seed: true });
```

- [ ] **Step 5: Use provenance in `defineAppDb.ts` and `registerSeedDomains.ts`**

In `defineAppDb.ts`, add `seedTables` to the `AppDb` interface and to the returned object, and
filter the catalog on provenance FIRST:

```ts
  /** Tables that came from the framework seed schema. The app's own tables are absent. */
  readonly seedTables: ReadonlySet<string>;
```

```ts
  const statusCatalog: SyncDomainCatalogItem[] = Object.keys(stores)
    // Provenance, not name. An app may declare its own table with a seed table's name.
    .filter((table) => def.schema.seedTables.has(table) && table in SEED_SOURCES)
    .map((table) => ({
      name: SEED_SOURCES[table as keyof typeof SEED_SOURCES].name,
      table,
      label: SEED_SOURCES[table as keyof typeof SEED_SOURCES].label,
      syncClass: "B" as const,
    }));
```

and `seedTables: def.schema.seedTables,` in the returned object.

In `registerSeedDomains.ts`, gate on provenance:

```ts
export function registerSeedDomains(appDb: AppDb): void {
  for (const [table, entity] of Object.entries(appDb.entities)) {
    // Provenance, not name: an app's own table may share a seed table's name but needs its own
    // endpoint and fetch config, and must NOT be registered against the seed source.
    if(!appDb.seedTables.has(table)) continue;

    const seed = SEED_SOURCES[table as keyof typeof SEED_SOURCES];
    if(!seed) continue;

    registerSnapshotDomain(
      { name: seed.name, table, projection: entity, ...seed.source },
      (omsInstance) => appDb.get(omsInstance),
    );
  }
}
```

- [ ] **Step 6: Delete the dead `commonSeedDomains.ts`**

`registerCommonSeedDomains` has ZERO callers anywhere in the workspace — verified by grep across
`common/` and every app's `src/`. Its only test lived in the deleted `seedEntities.spec.ts`, so it is
untested dead code whose "Kept for backwards compatibility" header is now false, and it duplicates
`registerSeedDomains` badly enough that it would not survive a provenance change anyway.

```bash
git rm common/db/domains/commonSeedDomains.ts
```

Remove its line from `common/db/index.ts`.

- [ ] **Step 7: Fix the two Minors Task 9's review raised**

In `common/tests/defineAppDb.spec.ts`, the test titled "lists the composed data tables; BaseDB adds
syncMeta on top" no longer touches a live handle, so the second clause is false. Retitle it to
"lists the composed data tables, excluding syncMeta".

In `common/tests/commonSchema.spec.ts`, the "every index is a projected field" loop does
`entity.fields[index]`, which is not compound-aware and will spuriously fail the moment a common
entity gains a `[a+b]` secondary index (now a legal form). Make it split compound entries:

```ts
      for (const index of entity.indexes) {
        const members = index.startsWith("[") ? index.slice(1, -1).split("+") : [index];
        for (const member of members) {
          expect(entity.fields[member], `${table}: index member ${member} not projected`).toBeTruthy();
        }
      }
```

- [ ] **Step 8: Run the full framework suite**

Run: `pnpm vitest run common/tests`
Expected: all db specs pass, including the new provenance tests. Only `commonUtil.spec.ts` (4) and
`useSolrSearch.spec.ts` still fail, for unrelated pre-existing reasons.

- [ ] **Step 9: Commit**

```bash
git add -A common/db common/tests
git commit -m "fix(db)!: decide seed membership by provenance, not table name"
```

---

# Repo B — Order Manager

### Task 10: Adopt the new schema shape

**Files:**
- Modify: `apps/order-manager/src/db/orderManagerDb.ts:20-34`
- Modify: `apps/order-manager/src/db/useSeedData.ts:41-51` (`row`), `:73-86` (`labels`)
- Modify: `apps/order-manager/tests/db/projectRow.spec.ts`
- Modify: `apps/order-manager/tests/db/projections.spec.ts` — imports the deleted `geoProjection`/`shopifyShopProjection`
- Modify: `apps/order-manager/tests/db/useSeedData.spec.ts` — imports the deleted `COMMON_DB_SCHEMA`

**Measured starting state** (with Task 9 landed, before this task): `pnpm test:unit` reports
**12 failed files / 84 passed (96)** and **8 failed / 428 passed (436)**. Five files import deleted
symbols; the other eight fail with "0 test" purely because they transitively import
`orderManagerDb` through a store, service or the router, and will go green the moment
`orderManagerDb.ts` resolves again. Do not edit those eight.

The five real edits:

| File | Deleted symbol | Replacement |
|---|---|---|
| `src/db/orderManagerDb.ts` | `SEED_ENTITY_NAMES` | `commonSchema` (take the whole schema) |
| `tests/db/projectRow.spec.ts` | `type EntityProjection` | `defineEntity({...})` |
| `tests/db/projections.spec.ts` | `geoProjection`, `shopifyShopProjection` | `commonSchema.entities.geos.fields`, `commonSchema.entities.shopifyShops.fields` |
| `tests/db/useSeedData.spec.ts` | `COMMON_DB_SCHEMA` | `commonSchema.stores` |
| `tests/db/syncDomainUrls.spec.ts` | `registerCommonSeedDomains` | `registerSeedDomains(orderManagerDb)` |

`tests/db/syncDomainUrls.spec.ts` needs care rather than deletion — it carries a real guardrail.
It asserts (a) a sync domain is registered for every seed dataset the app reads, and (b) that the
serialized domain registry never contains `oms/entityData` or `oms/dataDocumentView`, i.e. seed data
never arrives through a generic entity endpoint. Task 9b deleted `registerCommonSeedDomains` as dead
code, so swap the registration call for `registerSeedDomains(orderManagerDb)` — Order Manager takes
the whole `commonSchema`, so every seed domain still registers and BOTH assertions keep their exact
meaning. Keep the file's explanatory comment about replacing the deleted `tests/store/seed.spec.ts`.
Note it must `clearSyncRegistry()` first if registration is not already isolated, and that
`registerSeedDomains` takes the `AppDb` rather than a `getDb` callback.

**One failure is NOT ours and must not be "fixed":**
`../../common/components/DxpOmsInstanceFooter.spec.ts` has 1 failing test (timezone `data-color`).
It is a Vue component spec with no db, projection, schema or seed references, last touched in an
unrelated commit. OM's vitest picks up `common/components/**`, which the root `common/tests` run
does not, which is why it is invisible from the framework side. Leave it alone.

**Interfaces:**
- Consumes: `defineAppDb`, `commonSchema` from Repo A.
- Produces: no new exports. `orderManagerDb`, `omDb`, `getOrderManagerDb`, `orderManagerDbName`, `setOmsInstanceResolver` all keep their current names and signatures.

Order Manager reads every seed table by primary key only for **single-key** tables (`statuses`,
`enums`, `facilities`, `productStores`, `carriers`, `shopifyShops`, and the type lookups). Every
compound-key table it uses — `groupFacilities`, `geoAssocs`, `carrierShipmentMethods`,
`productStoreFacilities`, `shopifyShopLocations`, `statusFlowTransitions` — it reads **wholesale**
via `rows()`. So `row()` and `labels()` keep working; the change is to widen the type and to make
the latent hazard in `labels()` a loud failure rather than a silent wrong answer.

- [ ] **Step 1: Update the test**

Replace `apps/order-manager/tests/db/projectRow.spec.ts` in full:

```ts
import { describe, expect, it } from 'vitest';
import { defineEntity, projectRow, projectRows } from '@common/db';

const entity = defineEntity({
  primaryKey: 'statusFlowId,statusId,toStatusId',
  fields: {
    statusId: 'text',
    toStatusId: 'text',
    statusFlowId: 'text',
    transitionSequence: 'count',
  },
  indexes: ['statusId', 'toStatusId', 'statusFlowId'],
});

describe('projectRow', () => {
  const raw = {
    statusFlowId: 'DEFAULT',
    statusId: 'ORDER_CREATED',
    toStatusId: 'ORDER_APPROVED',
    transitionSequence: '2',
    unprojectedNoise: { big: 'payload' },
  };

  it('does not store the raw server payload', () => {
    const row = projectRow(raw, entity, 1000) as any;

    expect(row.raw).toBeUndefined();
    expect(row.unprojectedNoise).toBeUndefined();
  });

  it('keeps syncedAt', () => {
    expect((projectRow(raw, entity, 1000) as any).syncedAt).toBe(1000);
  });

  it('stores the key members as real fields, with no synthetic key column', () => {
    const row = projectRow(raw, entity, 1000) as any;

    expect(row.statusFlowId).toBe('DEFAULT');
    expect(row.statusId).toBe('ORDER_CREATED');
    expect(row.toStatusId).toBe('ORDER_APPROVED');
    expect(row.transitionKey).toBeUndefined();
    expect(row.transitionSequence).toBe(2);
  });

  it('drops records missing any key member', () => {
    expect(projectRow({ toStatusId: 'X' }, entity, 1000)).toBeNull();
    expect(projectRows([raw, { toStatusId: 'X' }], entity, 1000)).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/order-manager && pnpm test:unit projectRow`
Expected: FAIL — `defineEntity` is not exported from `@common/db` until Repo A's Task 9 commit is in
place, and `orderManagerDb.ts` no longer typechecks against the new `defineAppDb`.

- [ ] **Step 3: Adopt the new shape in `orderManagerDb.ts`**

Replace the imports and the `defineAppDb` call:

```ts
import { defineAppDb } from "@common/db/defineAppDb";
import { commonSchema } from "@common/db/domains/commonSchema";
import type { BaseDB } from "@common/db/baseDb";
import type { DbClient } from "@common/db/dbClient";

/**
 * Order Manager reads only HotWax seed reference data, so it takes the whole common schema and
 * declares no tables of its own. Deep imports, not the `@common/db` barrel: the barrel re-exports
 * modules that import `vue`, and the sync worker imports this file.
 */
export const orderManagerDb = defineAppDb({
  suffix: "OrderManagerDB",
  version: 1,
  schema: commonSchema,
});
```

Delete the `SEED_ENTITY_NAMES` import and the `COMPANY`-style comment block that described the
`seed`/`schema` split. Everything below (`orderManagerDbName`, `getOrderManagerDb`,
`setOmsInstanceResolver`, `omDb`) is unchanged.

- [ ] **Step 4: Widen `row()` and guard `labels()` in `useSeedData.ts`**

Add the type import:

```ts
import type { DbKey } from "@common/db/types";
```

Change `row`'s signature and guard:

```ts
/** Read one row by primary key, degrading to undefined. */
async function row(table: string, key: DbKey): Promise<Row | undefined> {
  const missing = !key || (Array.isArray(key) && key.length === 0);
  if(missing) {return undefined;}

  try {
    return await omDb().get(table, key);
  } catch (error) {
    console.warn(`[seed] Could not read ${table}/${String(key)} from the local database:`, error);

    return undefined;
  }
}
```

In `labels`, the `Map` keyed on a single field is only correct for a single-field key — an array key
would compare by identity and every lookup would miss. Every caller passes a single-key table today,
so make that a stated precondition rather than a silent wrong answer:

```ts
async function labels(
  table: string,
  keyField: string,
  ids: readonly string[],
  fields?: string[],
): Promise<Record<string, string>> {
  const wanted = [...new Set(ids.filter(Boolean))];
  if(!wanted.length) {return {};}

  const all = await rows(table);
  // Keyed on ONE field by design. A compound-key table would need its members joined, so passing
  // one here is a caller bug: the Map would compare array keys by identity and never match.
  const byKey = new Map(all.map((record) => [record[keyField], record]));

  return Object.fromEntries(wanted.map((id) => [id, labelOf(byKey.get(id), id, fields)]));
}
```

- [ ] **Step 5: Run the full Order Manager suite**

Run: `cd apps/order-manager && pnpm test:unit`
Expected: PASS, including the 4 rewritten `projectRow` tests. Record the total; compare it against
the count before this task to confirm nothing was silently dropped.

- [ ] **Step 6: Commit (Order Manager repo)**

```bash
cd apps/order-manager
git add src/db/orderManagerDb.ts src/db/useSeedData.ts tests/db/projectRow.spec.ts
git commit -m "feat(db)!: compose the Order Manager database from commonSchema"
```

---

# Repo C — Company

Company's conversion is **in scope for this plan** (changed from the original draft, which shipped a
transitional wrapper). It is five tasks because it touches four layers: its own projection module,
its 43 table declarations, its storage/sync layer, and its database composition.

**What must NOT change.** Company's stored row is `{ ...projectedFields, raw, cachedAt }` — it keeps
the untouched server payload, unlike the framework's `{ ...projectedFields, syncedAt }`. `.raw` is
read in 56 places across 20+ files and `cachedAt` in 3. Company therefore keeps its **own**
`projectRow`/`projectRows` and its own `CachedRow`. Only the *key* concern converges on the
framework. Do not "unify" Company onto the framework's `projectRow`; that would silently drop `raw`
and rename `cachedAt`, and it is not what this plan asks for.

---

### Task 11: Company's `cacheProjection.ts` learns compound keys

**Files:**
- Modify: `apps/company/src/utils/db/cacheProjection.ts`
- Test: `apps/company/tests/utils/cacheProjection.spec.ts`

**Interfaces:**
- Consumes: `Entity` from `@common/db/defineEntity`; `DbKey` from `@common/db/types`; `canonicalKey`, `entityKeyOf` from `@common/db/projection` (Repo A Tasks 1 and 3).
- Produces: `projectRow(raw, entity: Entity, now): CachedRow | null`, `projectRows(rawRows, entity: Entity, now): CachedRow[]`, `isUnkeyableFetch(rawRows, entity: Entity): boolean`, `diffStaleKeys(existing: readonly DbKey[], fresh: readonly DbKey[]): DbKey[]`. `EntityProjection`, `FieldKind` and `buildKey` are deleted from this module. `CachedRow`, `toMillis`, `toCount`, `toText`, `isEffectiveNow`, `newestValue`, `keepNewerThan` are unchanged.

Company currently duplicates the framework's `FieldKind`, `EntityProjection`, `COERCE`, and
`diffStaleKeys`. The duplication existed because the framework's row shape differs; the *key* logic
does not differ, so it stops being duplicated here. Import `canonicalKey` and `entityKeyOf` from
`@common/db/projection` rather than reimplementing them — that module imports only `./types` and
`./defineEntity`, both pure, so it is safe for Company's worker bundle.

- [ ] **Step 1: Write the failing tests**

In `apps/company/tests/utils/cacheProjection.spec.ts`, replace every construction of a projection
literal (`{ keyField: "...", fields: {...}, buildKey: ... }`) with a `defineEntity({...})` call, and
add these cases:

```ts
import { defineEntity } from "@common/db/defineEntity";

describe("projectRow with a compound key", () => {
  const groupFacility = defineEntity({
    primaryKey: "facilityGroupId,facilityId,fromDate",
    fields: {
      facilityGroupId: "text", facilityId: "text", facilityName: "text",
      fromDate: "date", thruDate: "date",
    },
    indexes: ["facilityGroupId", "facilityId", "fromDate", "thruDate"],
  });

  it("stores the key members as real fields, with no synthetic column", () => {
    const raw = { facilityGroupId: "GRP1", facilityId: "FAC1", fromDate: 1700000000000 };
    const row = projectRow(raw, groupFacility, 500)!;

    expect(row.facilityGroupId).toBe("GRP1");
    expect(row.fromDate).toBe(1700000000000);
    expect(row.memberKey).toBeUndefined();
  });

  it("keeps the untouched server payload and cachedAt", () => {
    const raw = { facilityGroupId: "GRP1", facilityId: "FAC1", fromDate: 1, extra: "kept" };
    const row = projectRow(raw, groupFacility, 500)!;

    expect(row.raw).toEqual(raw);
    expect(row.cachedAt).toBe(500);
  });

  it("returns null when any key member is missing", () => {
    expect(projectRow({ facilityGroupId: "GRP1", facilityId: "FAC1" }, groupFacility, 1)).toBeNull();
  });

  it("flags a fetch it can key none of", () => {
    expect(isUnkeyableFetch([{ wrong: "shape" }], groupFacility)).toBe(true);
  });
});

describe("diffStaleKeys with compound keys", () => {
  it("diffs array keys by value and returns the original array form", () => {
    const stale = diffStaleKeys([["A", "1"], ["B", "2"]], [["B", "2"]]);

    expect(stale).toEqual([["A", "1"]]);
    expect(Array.isArray(stale[0])).toBe(true);
  });

  it("still diffs scalar keys", () => {
    expect(diffStaleKeys(["A", "B"], ["B"])).toEqual(["A"]);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd apps/company && pnpm test:unit cacheProjection`
Expected: FAIL — `projectRow` still looks for `projection.keyField`, so the compound cases return
rows keyed on `undefined` or throw.

- [ ] **Step 3: Rewrite the key half of `cacheProjection.ts`**

Replace the `FieldKind` type, the `EntityProjection` interface and `COERCE` with imports, keeping the
`structured` behaviour note as a comment on the import (the framework's `COERCE` already has the same
four kinds and the same `structured` pass-through):

```ts
import type { Entity } from "@common/db/defineEntity";
import type { DbKey, FieldKind } from "@common/db/types";
import { canonicalKey, entityKeyOf, toCount, toMillis, toText } from "@common/db/projection";

export type { FieldKind };
```

Delete Company's local `toMillis`/`toCount`/`toText` definitions and re-export the framework's
instead, so there is one coercion implementation:

```ts
export { toCount, toMillis, toText };
```

Rewrite `projectRow` — the only difference from the framework's is the row tail:

```ts
/**
 * Project one raw server record into a cached row. Returns null when the record cannot be keyed —
 * for a compound key that means ANY member failed to project.
 *
 * Unlike the framework's `projectRow`, this keeps `raw` (the untouched server object) and stamps
 * `cachedAt`. 56 read sites across the app reach into `row.raw`, so that field is load-bearing.
 */
export function projectRow(
  raw: Record<string, unknown>,
  entity: Entity,
  now: number,
): CachedRow | null {
  const row: Record<string, unknown> = {};
  for (const [field, kind] of Object.entries(entity.fields)) {
    const source = raw?.[field] !== undefined ? field : entity.rename?.[field] ?? field;
    const value = COERCE[kind](raw?.[source]);
    if (value !== undefined) row[field] = value;
  }

  for (const field of entity.primaryKeyFields) {
    if (row[field] === undefined) return null;
  }

  return { ...row, raw, cachedAt: now } as CachedRow;
}
```

Keep `COERCE` local only if the framework does not export it; if it does not, import the four
coercers and build the same four-entry map, with the existing `structured` comment preserved
verbatim — it documents a real bug (`String()` turning a nested payload into
`"[object Object],[object Object]"`).

Retype `projectRows` and `isUnkeyableFetch` to take `entity: Entity`, and replace `diffStaleKeys`:

```ts
export function diffStaleKeys(existingKeys: readonly DbKey[], freshKeys: readonly DbKey[]): DbKey[] {
  const fresh = new Set(freshKeys.map(canonicalKey));
  return existingKeys.filter((key) => !fresh.has(canonicalKey(key)));
}
```

`isEffectiveNow`, `newestValue` and `keepNewerThan` are untouched. Keep every existing doc comment
on them — several record measured live findings.

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd apps/company && pnpm test:unit cacheProjection`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
cd apps/company
git add src/utils/db/cacheProjection.ts tests/utils/cacheProjection.spec.ts
git commit -m "feat(db)!: key cached rows by Entity, supporting compound primary keys"
```

---

### Task 12: Company's 26 single-key tables → `companySchema.ts`

**Files:**
- Create: `apps/company/src/db/companySchema.ts`
- Test: `apps/company/tests/db/companySchema.spec.ts`, `apps/company/tests/fixtures/companySchemaAfter.json`

**Interfaces:**
- Consumes: `defineEntity`, `defineSchema` (Repo A Tasks 1–2).
- Produces: `companySchema: AppSchema`. Task 13 extends it; Task 15 composes it.

**The authority for what each table's key and indexes are is `COMPANY_SCHEMA` in
`apps/company/src/db/companyDb.ts`** — the existing Dexie string per table. **The authority for each
table's `fields` map is the matching projection in `apps/company/src/utils/db/cacheEntities.ts`.**
Move both verbatim; add no field and change no `FieldKind`.

For the 26 tables in this task, the conversion is mechanical, exactly as in Repo A Task 7: the first
segment of the existing schema string becomes `primaryKey`, the remaining segments become `indexes`.

**Compound SECONDARY indexes must be preserved.** Ten of Company's tables carry them
(`dataManagerLogs`, `systemMessages`, `serviceJobRuns`, `syncRuns`, `productUpdateHistories`,
`shopifyInventoryAdjustmentDetails`, `inventoryChannels`, `netSuiteDecisionRules`,
`netSuiteRuleGroupRuns`, `productStoreShippingMethods`), and their comments in `companyDb.ts` record
measured findings about why each exists. `defineEntity` validates each `indexes` entry against
`fields`, and `[a+b]` is not a field name — so `defineEntity` needs to accept them.

Repo A **Task 9 already extended `defineEntity`** to accept these: an `indexes` entry matching
`/^\[[A-Za-z0-9_+]+\]$/` is a compound index, each `+`-separated member is validated against
`fields`, and the entry is emitted verbatim. So declare them in `indexes` exactly as they appear in
`COMPANY_SCHEMA` today and they will pass through unchanged.

- [ ] **Step 1: Write the failing Company test**

Create `apps/company/tests/db/companySchema.spec.ts`:

```ts
import { describe, expect, it } from "vitest";
import { companySchema } from "@/db/companySchema";
import after from "../fixtures/companySchemaAfter.json";

describe("companySchema", () => {
  it("emits the intended Dexie string for every table it declares", () => {
    for (const [table, schema] of Object.entries(after.schema)) {
      expect(companySchema.stores[table], `${table}`).toBe(schema);
    }
  });

  it("declares every primary-key field and every index member as a projected field", () => {
    for (const [table, entity] of Object.entries(companySchema.entities)) {
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

  it("preserves every compound secondary index", () => {
    expect(companySchema.stores.dataManagerLogs).toContain("[configId+createdDate]");
    expect(companySchema.stores.dataManagerLogs).toContain("[configId+finishDateTime]");
    expect(companySchema.stores.syncRuns).toContain("[shopId+systemMessageTypeId+initDate]");
    expect(companySchema.stores.syncRuns).toContain("[shopId+configId+initDate]");
    expect(companySchema.stores.systemMessages).toContain("[systemMessageRemoteId+systemMessageTypeId+initDate]");
  });
});
```

Create `apps/company/tests/fixtures/companySchemaAfter.json` holding, for each of this task's 26
tables, its schema string copied **verbatim** from `COMPANY_SCHEMA` in `companyDb.ts` — these tables
are single-key, so their emitted string must be byte-identical to today's apart from whitespace
normalization to `", "` between segments.

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/company && pnpm test:unit companySchema`
Expected: FAIL — cannot resolve `@/db/companySchema`.

- [ ] **Step 3: Create `companySchema.ts` with the 26 single-key tables**

```ts
/**
 * Company's own tables, each declared exactly once.
 *
 * Keyed by IndexedDB store name. Replaces the split between `COMPANY_SCHEMA`'s hand-written Dexie
 * strings in `companyDb.ts` and the projections in `src/utils/db/cacheEntities.ts` — the two could
 * disagree, and nothing checked them against each other.
 *
 * Deep imports, never the `@common/db` barrel: the sync worker reaches this file and Vite must emit
 * that chunk as a single iife.
 */

import { defineEntity } from "@common/db/defineEntity";
import { defineSchema } from "@common/db/defineSchema";

export const companySchema = defineSchema({
  // ... 26 entities, each defineEntity({ primaryKey, fields, indexes }) ...
});
```

Carry across every explanatory comment from both source files. Several are load-bearing: the
`syncRuns` block explaining why the shop-scoped cursor exists, the
`shopifyInventoryAdjustmentDetails` block on its four-part identity, the
`productUpdateHistories` note that it is a bounded window rather than a snapshot, and the
`facilityGroupTypes` / `enumGroupMembers` / `facilityIdentifications` PK-UNVERIFIED warnings.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/company && pnpm test:unit companySchema`
Expected: PASS for the tables present. The `dataManagerLogs`/`syncRuns`/`systemMessages`
compound-index assertions must pass in this task — all three are single-key tables.

- [ ] **Step 5: Commit (Company repo)**

```bash
cd apps/company
git add src/db/companySchema.ts tests/db/companySchema.spec.ts tests/fixtures/companySchemaAfter.json
git commit -m "feat(db): declare Company's single-key tables via defineEntity"
```

---

### Task 13: Company's 17 compound-key tables

**Files:**
- Modify: `apps/company/src/db/companySchema.ts`
- Modify: `apps/company/tests/fixtures/companySchemaAfter.json`
- Modify: `apps/company/src/utils/db/cacheEntities.ts` (delete the 17 `buildKey`s and their synthetic key fields)

**Interfaces:**
- Consumes: Task 12's `companySchema`.
- Produces: `companySchema` complete at 43 tables. `cacheEntities.ts` no longer defines any `buildKey`.

**The 17 tables and their synthetic key fields**, from `keyField:` in `cacheEntities.ts`:

`organizationRelationships` (`relationshipKey`), `groupFacilities` (`memberKey`), `shopifyLocations`
(`locationKey`), `shopifyInventoryAdjustmentDetails` (`adjustmentKey`), `shopifyTypeMappings`
(`typeMappingKey`), `inventoryEventDocuments` (`documentFeedKey`), `carrierShipmentMethods`
(`carrierShipmentMethodKey`), `carrierFacilities` (`carrierFacilityKey`), `shopifyCarrierShipments`
(`carrierShipmentKey`), `enumGroupMembers` (`enumGroupMemberKey`), `facilityIdentifications`
(`facilityIdentificationKey`), `geoAssocs` (`geoAssocKey`), `productStoreFacilities`
(`storeFacilityKey`), `systemMessageErrors` (`errorKey`), `productUpdateHistories` (`updateKey`),
`facilityGroupProductStores` (`facilityGroupProductStoreKey`), `appVersions` (`appVersionKey`).

**The conversion rule is mechanical and its source of truth is in the file.** Each projection's
`buildKey` joins the composite fields with `|`, in order, and each projection's doc comment states
the real entity PK in prose. For example:

```ts
/**
 * FacilityGroupAndMember — date-effective association with a COMPOSITE natural key
 * (facilityGroupId + facilityId + fromDate), so the cache stores a synthetic `memberKey`.
 */
buildKey: (raw) => `${group}|${facility}|${raw?.fromDate ?? ""}`
```

becomes `primaryKey: "facilityGroupId,facilityId,fromDate"`, with `memberKey` deleted from `fields`.

For each of the 17: read its `buildKey`, take the fields it joins **in join order** as `primaryKey`,
delete the synthetic field from `fields`, and set `indexes` to the old schema string's segments minus
the synthetic key. Cross-check the result against the doc comment's stated PK; if the two disagree,
STOP and report it rather than guessing — a disagreement means one of them is already wrong.

**Where `buildKey` tolerated a missing trailing member** (the `?? ""` pattern — present in
`groupFacilities`, `systemMessageErrors`, `facilityGroupProductStores` and others), a compound key
cannot. Default to making the field a required key member, which is correct when the server
genuinely always supplies it. Confirm each against a live response where one is available; where the
endpoint returns an empty 200 (`enumGroupMembers`, `facilityIdentifications`) keep the implied key and
carry the existing PK-UNVERIFIED comment across. If a field is genuinely optional, drop it from
`primaryKey` and record why in the commit message — never reintroduce a synthetic column.

**Where `buildKey` read an alternative source field** (a `a || b` fallback), express it as `rename`,
as Repo A Task 8 did for `geoAssocs` and `productStoreShipmentMethods`.

- [ ] **Step 1: Extend the fixture**

For each of the 17, add its intended emitted string to
`apps/company/tests/fixtures/companySchemaAfter.json`, in the form
`"[<pk members joined by +>], <indexes>"`. Derive each from the rule above before writing any
implementation — the fixture is the specification for this task.

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/company && pnpm test:unit companySchema`
Expected: FAIL — `companySchema.stores` is missing all 17.

- [ ] **Step 3: Add the 17 entities and delete the 17 `buildKey`s**

Append the 17 `defineEntity` calls to `companySchema.ts`, then remove from `cacheEntities.ts` every
`buildKey` function and every synthetic key field in the corresponding `fields` maps. Leave the rest
of `cacheEntities.ts` in place — Task 15 retargets what remains of it.

- [ ] **Step 4: Run the tests**

Run: `cd apps/company && pnpm test:unit companySchema cacheProjection`
Expected: PASS. Add to `companySchema.spec.ts`:

```ts
  it("has no synthetic key column left anywhere", () => {
    for (const [table, entity] of Object.entries(companySchema.entities)) {
      expect(entity.fieldNames.filter((f) => /Key$/.test(f)), `${table}`).toEqual([]);
    }
  });
```

- [ ] **Step 5: Commit (Company repo)**

```bash
cd apps/company
git add src/db/companySchema.ts src/utils/db/cacheEntities.ts tests/db/companySchema.spec.ts tests/fixtures/companySchemaAfter.json
git commit -m "feat(db)!: give Company's 17 composite tables real Dexie compound keys"
```

---

### Task 14: `appCacheDb.ts` and Company's `snapshotDomain.ts` learn array keys

**Files:**
- Modify: `apps/company/src/utils/db/appCacheDb.ts:134` (`remove`), `:174` (`defineCachedEntity`), `:191-198` (the prune), `:295-297`
- Modify: `apps/company/src/workers/domains/snapshotDomain.ts:24` and its key-extraction sites
- Test: `apps/company/tests/utils/cacheEntities.spec.ts` (or the nearest existing appCacheDb test), `apps/company/tests/workers/snapshotDomain.*.spec.ts`

**Interfaces:**
- Consumes: `DbKey`, `entityKeyOf`, `canonicalKey` (Repo A Task 3); Company's retyped `cacheProjection` (Task 11).
- Produces: `CachedEntity.remove(key: DbKey)`, `defineCachedEntity(table, entity: Entity)`. No other signature changes.

Three concrete sites in `appCacheDb.ts`:

1. `remove(key: string)` in the `CachedEntity` interface and its implementation → `key: DbKey`, and
   `dexieTable().delete(key as any)`.
2. `defineCachedEntity(table: CacheTableName, projection: EntityProjection)` →
   `(table: CacheTableName, entity: Entity)`, and the `Table<CachedRow, string>` generic →
   `Table<CachedRow, DbKey>`.
3. The prune at `:191-198` currently reads
   `rows.map((row) => String(row[projection.keyField]))` against `primaryKeys()`. Replace the map
   with `entityKeyOf`, dropping unkeyable rows, and leave `primaryKeys()` as-is — Dexie already
   returns arrays for a compound-key store:

```ts
        const existingKeys = (scope
          ? await dexieTable().where(scope.field).equals(scope.value as any).primaryKeys()
          : await dexieTable().toCollection().primaryKeys()) as DbKey[];

        const freshKeys: DbKey[] = [];
        for (const row of rows) {
          const key = entityKeyOf(row, entity);
          if (key !== undefined) freshKeys.push(key);
        }

        const stale = diffStaleKeys(existingKeys, freshKeys);
        if (stale.length) await dexieTable().bulkDelete(stale as any[]);
```

In Company's `src/workers/domains/snapshotDomain.ts`, change `projection: EntityProjection` to
`projection: Entity` at `:24` and replace every `String(row[projection.keyField])` and any local
`keyOfRecord` with `entityKeyOf` + `canonicalKey`, exactly as Repo A Task 6 did for the framework's
copy. Where a key feeds a `Set` for dedup it must be `canonicalKey(...)` (a string); where it feeds
`bulkDelete`/`delete`/`get` it must be the `DbKey` itself.

The existing worker specs construct projection literals inline
(`projection: { keyField: "jobName", fields: { jobName: "text" } }` and similar in
`snapshotDomain.refetchEnvelope.spec.ts`, `snapshotDomain.wipeGuard.spec.ts`,
`snapshotDomain.fanOutScope.spec.ts`, `organizationDomain.spec.ts`). Convert each to
`defineEntity({ primaryKey: "...", fields: {...} })`. The one in `snapshotDomain.fanOutScope.spec.ts`
uses `buildKey` for `storeMethodKey` — convert it to the equivalent compound `primaryKey`.

- [ ] **Step 1: Convert the affected worker specs, run them, confirm they fail**

Run: `cd apps/company && pnpm test:unit snapshotDomain organizationDomain`
Expected: FAIL — `defineCachedEntity` and Company's `snapshotDomain` still expect `keyField`.

- [ ] **Step 2: Apply the three `appCacheDb.ts` changes and the `snapshotDomain.ts` changes**

As specified above.

- [ ] **Step 3: Add a compound-key prune test**

Add to the appCacheDb/cacheEntities spec a case proving the prune deletes by array key: seed a
compound-key table with two rows, snapshot a fresh set containing only one, and assert the other is
gone. This is the case that silently deleted everything if `diffStaleKeys` compared arrays by
identity, so it is worth an explicit test.

- [ ] **Step 4: Run the full Company suite**

Run: `cd apps/company && pnpm test:unit`
Expected: PASS. Record the total and compare against the pre-task count.

- [ ] **Step 5: Commit (Company repo)**

```bash
cd apps/company
git add src/utils/db/appCacheDb.ts src/workers/domains/snapshotDomain.ts tests/
git commit -m "feat(db)!: store and prune Company's cached rows by compound key"
```

---

### Task 15: Compose Company's database; return the three reclaimed seed picks

**Files:**
- Modify: `apps/company/src/db/companyDb.ts`
- Modify: `apps/company/src/workers/domains/registerSeedDomains.ts`
- Modify: `apps/company/src/utils/db/cacheEntities.ts` (its `defineCachedEntity` calls now pass entities from `companySchema`)
- Test: `apps/company/tests/db/companyDb.spec.ts`

**Interfaces:**
- Consumes: `defineAppDb`, `commonSchema`, `mergeSchemas` (Repo A Tasks 2 and 9); `companySchema` (Tasks 12–13); `SEED_SOURCES` (Repo A Task 7).
- Produces: `companyDb` unchanged in name and exported shape. `COMPANY_SCHEMA` is deleted — `companySchema` replaces it. `registerCompanySeedDomains(entities: readonly SeedPick[])` where `SeedPick = { name: string; table: string; projection: Entity; source: SeedSource }`.

Because Company now handles compound keys, **`groupFacilities`, `geoAssocs` and
`productStoreFacilities` stay framework seed picks** — the original draft's reclaiming of them into
Company's own schema is no longer needed and must NOT be done. Company's pick list keeps all 12
entries, rewritten from singular domain names to plural TABLE names, because `commonSchema.pick`
addresses tables:

```ts
const COMPANY_SEED_TABLES = [
  "productStores", "enums", "enumTypes", "facilities", "facilityTypes",
  "groupFacilities", "geos", "geoAssocs", "shipmentMethodTypes",
  "paymentMethodTypes", "roleTypes", "productStoreFacilities",
] as const;
```

Those three tables must therefore NOT also appear in `companySchema` — `mergeSchemas` throws on a
table claimed twice, which is the check that catches it. If Task 12 or 13 declared them in
`companySchema`, remove them here and note it in the commit message.

Compose:

```ts
export const companyDb = defineAppDb({
  suffix: "CompanyDB",
  version: 1,
  schema: mergeSchemas(commonSchema.pick([...COMPANY_SEED_TABLES]), companySchema),
});
```

Retarget `cacheEntities.ts`: every `defineCachedEntity("<table>", <table>Projection)` call becomes
`defineCachedEntity("<table>", companySchema.entities["<table>"])`, and the now-unused projection
consts are deleted. Keep every doc comment that sits on a `defineCachedEntity` call or explains a
table's semantics; move a comment that documents an entity's *fields* to that entity in
`companySchema.ts` rather than deleting it.

Update `registerSeedDomains.ts` to accept `SeedPick[]` built from `companyDb.entities` plus the
framework's `SEED_SOURCES`, and pass `entity.projection` straight through — no down-conversion is
needed now, because Company's `snapshotDomain` takes an `Entity`. Keep the long comment explaining
why Company does not use the framework's `registerSeedDomains`; it is still true and still
load-bearing. Find its caller with `grep -rn "registerCompanySeedDomains" apps/company/src`.

- [ ] **Step 1: Update `companyDb.spec.ts`, run it, confirm it fails**

Assert that `companyDb.tableNames` still has the same count it had before this plan started (record
the number first), that all 12 seed tables are present, and that
`companyDb.entities.groupFacilities.primaryKeyFields` has length 3 — proving the seed pick, not a
Company-local copy, is what got composed.

Run: `cd apps/company && pnpm test:unit companyDb`
Expected: FAIL.

- [ ] **Step 2: Apply the changes above**

- [ ] **Step 3: Run the full Company suite**

Run: `cd apps/company && pnpm test:unit`
Expected: PASS. This is the real gate — Company has the largest suite of the three repos. Compare the
total against the pre-task count; a drop means a spec stopped being collected rather than passing.

- [ ] **Step 4: Commit (Company repo)**

```bash
cd apps/company
git add src/db/companyDb.ts src/db/companySchema.ts src/utils/db/cacheEntities.ts src/workers/domains/registerSeedDomains.ts tests/
git commit -m "feat(db)!: compose the Company database from commonSchema and companySchema"
```

---

## Definition of Done

- [ ] `pnpm vitest run common/tests` — every db spec passes; only `commonUtil.spec.ts` (4) and `useSolrSearch.spec.ts` still fail, exactly as they did before this work.
- [ ] `cd apps/order-manager && pnpm test:unit` — passes, at the same or higher test count as before.
- [ ] `cd apps/company && pnpm test:unit` — passes, at the same or higher test count as before.
- [ ] `grep -rn "buildKey\|EntityProjection" common/db` returns nothing.
- [ ] `grep -rn "buildKey\|EntityProjection" apps/company/src` returns nothing.
- [ ] `grep -rn "keyField" apps/company/src` returns nothing.
- [ ] `apps/company/src/db/companyDb.ts` no longer defines `COMPANY_SCHEMA`; `companySchema.ts` owns the declarations.
- [ ] Company's `.raw` and `cachedAt` row fields still exist — `grep -c "raw," apps/company/src/utils/db/cacheProjection.ts` is non-zero.
- [ ] `grep -rn "memberKey\|geoAssocKey\|carrierShipmentMethodKey\|transitionKey\|storeFacilityKey\|storeFacilityGroupKey\|storeShipmentMethodKey\|locationKey\|emailSettingKey" common/db` returns nothing.
- [ ] Commits in all three repos, all on `app-db-refined`.
- [ ] `common/tests/fixtures/seedBefore.json`'s `domainNames` assertion still passes — no domain was renamed.

## Deferred (not this plan)

- **Unifying Company onto the framework's `projectRow`.** Company's stored row keeps `raw` (the untouched server payload, read in 56 places) and stamps `cachedAt`; the framework's keeps neither. Converging the two row shapes is a separate, larger change and is explicitly NOT part of this plan — Tasks 11-15 converge only the KEY concern.
- **Company's three PK-UNVERIFIED tables.** `enumGroupMembers`, `facilityIdentifications` and `facilityGroupTypes` return an empty 200 on the available OMS instance, so their natural keys still cannot be confirmed. Task 13 converts them to their implied compound keys and carries the warning comment across; confirming them needs an instance with data.
- **Typed rows from `fieldNames`.** `Entity.fieldNames` makes a `Record<fieldName, ...>` row type derivable, which would let `useDb` return typed records instead of `Record<string, any>`. Out of scope; nothing here depends on it.
- **Retiring `registerCommonSeedDomains`.** Now that `registerSeedDomains(appDb)` covers every case, the all-29 helper has no caller left in either app. Deleting it is a separate cleanup.
