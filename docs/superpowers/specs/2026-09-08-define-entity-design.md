# `defineEntity` — one declaration per IndexedDB entity

**Date:** 2026-09-08
**Status:** Approved, ready for planning
**Supersedes parts of:** [2026-09-07-declarative-app-db-design.md](2026-09-07-declarative-app-db-design.md)

## Problem

An entity is currently declared twice, in two shapes that can disagree.

`SEED_ENTITIES` in `common/db/domains/seedEntities.ts` gives each entity a hand-written Dexie
schema string:

```ts
groupFacility: {
  schema: "memberKey, facilityGroupId, facilityId, fromDate, thruDate",
  projection: groupFacilityProjection,
}
```

and a separate `EntityProjection` listing the stored fields:

```ts
export const groupFacilityProjection: EntityProjection = {
  keyField: "memberKey",
  fields: { memberKey: "text", facilityGroupId: "text", /* ... */ },
  buildKey: (raw) => `${raw.facilityGroupId}|${raw.facilityId}|${raw.fromDate ?? ""}`,
};
```

Three defects follow from the split:

1. **Drift.** Nothing checks that an indexed field is a projected field. An index on a field the
   projection never writes is a permanently empty index, and it fails silently.
2. **Invented columns.** Nine seed entities and about twelve Company tables have composite natural
   keys, but Dexie is only told about a synthetic single-string key (`memberKey`, `geoAssocKey`,
   `errorKey`, `adjustmentKey`, …). That column exists only to paper over the composite key, must
   be declared in `fields`, and must be kept in step with a `buildKey` function.
3. **Unparseable schema strings.** `composeAppSchema`'s `extendIndexes` recovers the primary key by
   taking `schema.split(",")[0]`, which is wrong the moment a schema string contains a compound
   expression such as `[a+b]`.

## Goals

- One call declares an entity's storage completely: primary key, projected fields, secondary indexes.
- Composite natural keys become real Dexie compound primary keys. No synthetic key columns.
- Validation at declaration time: an index or primary-key member must be a declared field.
- The emitted Dexie string is derived, never hand-written.

## Non-goals

- `label` and `source` (the fetch config) stay **out** of `defineEntity`. It covers storage only,
  and lives in a sibling map keyed by the same table name. Tables written locally need no `source`.
- No data migration. Nothing is in production, so a changed keyPath is handled by rebuilding the
  local database in development.

## Design

### `defineEntity`

New file `common/db/defineEntity.ts`. Pure string and object work — no Dexie import, no Vue — so it
is fully unit-testable and safe for the sync-worker chunk.

```ts
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
  primaryKey: string | string[];   // normalized: scalar for one field, array for many
  primaryKeyFields: string[];      // always an array, for iteration
  fields: Record<string, FieldKind>;
  fieldNames: string[];            // declaration order — the projection field list
  indexes: string[];
  rename?: Record<string, string>;
  schema: string;                  // the derived Dexie stores() string
}

export function defineEntity(def: EntityDefinition): Entity;
```

Primary-key normalization is exactly the shape requested:

```ts
function normalizePrimaryKey(primaryKey: string): string | string[] {
  const fields = primaryKey.split(",").map((field) => field.trim()).filter(Boolean);
  return fields.length === 1 ? fields[0] : fields;
}
```

`defineEntity` then **throws** on each of:

- an empty `primaryKey`, or a duplicate field within it
- a primary-key field absent from `fields` — an unstored key member is unsatisfiable
- an index absent from `fields` — the drift defect, now a declaration-time error
- an index restating a primary-key field, or restating the compound expression
- a duplicate entry in `indexes`

and emits the schema string:

| `primaryKey` | `indexes` | emitted `schema` |
|---|---|---|
| `"facilityId"` | `["facilityTypeId"]` | `"facilityId, facilityTypeId"` |
| `"productId,facilityId"` | `["productId", "facilityId"]` | `"[productId+facilityId], productId, facilityId"` |

Dexie does not implicitly index the individual members of a compound primary key, so an entity that
queries by one member must list it in `indexes`. That is why the second row above indexes both.

`syncedAt` stays implicit. `projectRow` adds it to every row and no schema indexes it today, so it
is not a declared field.

### `defineSchema` and composition

```ts
export interface AppSchema {
  entities: Record<string, Entity>;   // keyed by TABLE name
  stores: Record<string, string>;     // table → schema string, ready for version().stores()
  pick(tables: string[]): AppSchema;                        // subset; throws on unknown table
  extendIndexes(map: Record<string, string[]>): AppSchema;  // widen a picked table
}

export function defineSchema(map: Record<string, Entity>): AppSchema;
export function mergeSchemas(...schemas: AppSchema[]): AppSchema;
```

The map key **is** the IndexedDB store name. There is no domain/table split and no pluralization
guessing: existing plural store names (`facilities`, `productStores`, `geoAssocs`) are kept verbatim
as keys, so no store is renamed. The sibling `label`/`source` map is keyed by the same table name.

Two files own the declarations:

- `common/db/domains/commonSchema.ts` — the 29 framework seed entities
- `apps/company/src/db/companySchema.ts` — Company's own tables

Composition at the call site:

```ts
export const companyDb = defineAppDb({
  suffix: "CompanyDB",
  version: 1,
  schema: mergeSchemas(
    commonSchema.pick(["facilities", "productStores", "enums", "geos", "groupFacilities"]),
    companySchema,
  ),
});
```

Passing bare `commonSchema` takes all 29; `pick` takes a subset.

`defineSchema` throws on a `syncMeta` key, since `BaseDB` injects that store itself.
`mergeSchemas` throws when two inputs claim the same table — one rule replacing two checks in
today's `composeAppSchema`: `assertDistinctSeedTables`, and the "declared in `schema` but already
provided by seed entity" check.

`extendIndexes` moves off `defineAppDb` onto `AppSchema`, merging into the `indexes` **array** before
the string is built. This deletes the string-splicing in `composeAppSchema` and with it the
`existing[0]` primary-key assumption that cannot parse `[a+b]`.

`defineAppDb` shrinks to `{ suffix, version, schema }` — no `seed`, no `extendIndexes`. Its
`statusCatalog` derives from the sibling label/source map filtered to the composed tables.

### Versioning

`version` is threaded into `BaseDB`, replacing the hardcoded `this.version(1).stores(...)`:

```ts
constructor(dbName: string, schema: Record<string, string>, version = 1) {
  super(dbName);
  this.version(version).stores({ ...schema, syncMeta: "key" });
}
```

Dexie upgrades **additive** changes in place — new tables, added or removed secondary indexes. It
throws `"Not yet support for changing primary key"` (verified in Dexie 4.4.3) when a store's keyPath
changes, so `version` cannot carry this change's compound-key conversions.

No migration is built, because nothing is in production. A developer holding a stale local database
hits the existing `ensureDbReady` path, which deletes and rebuilds it; every table in every app
database is server-derived (class A/B/C) and re-syncs. No `recreate` list, no schema fingerprint.

### `Entity` replaces `EntityProjection`

`keyField: string` becomes `primaryKeyFields: string[]`, and `buildKey` is **deleted outright** —
all 21 synthetic-key tables (9 seed, ~12 Company) convert in this change, so there is exactly one
key convention repo-wide and no escape hatch to drift back to.

`projectRow` gets simpler:

```ts
export function projectRow(raw, entity: Entity, now: number): DbRow | null {
  const row: Record<string, unknown> = {};
  for (const [field, kind] of Object.entries(entity.fields)) {
    const source = raw?.[field] !== undefined ? field : entity.rename?.[field] ?? field;
    const value = COERCE[kind](raw?.[source]);
    if (value !== undefined) row[field] = value;
  }
  // Unkeyable: a compound member that did not project cannot be stored.
  for (const field of entity.primaryKeyFields) {
    if (row[field] === undefined) return null;
  }
  return { ...row, syncedAt: now } as DbRow;
}
```

`rename` absorbs the `||` source fallbacks three `buildKey`s were performing (`toGeoId || geoIdTo`,
`emailTypeEnumId || emailType`, `partyId || carrierPartyId`).

#### Per-entity decisions required

A compound key cannot tolerate a missing member, but four `buildKey`s did, defaulting it to `""`.
Each needs a decision **checked against a live API response** during implementation — either the
field is part of the identity (make it a pk member; rows missing it are correctly rejected) or it is
not (drop it from the pk, accepting that rows differing only in it collapse):

| Entity | Tolerated | Proposed default |
|---|---|---|
| `groupFacility` | `fromDate ?? ""` | pk member — OFBiz date-effective PKs are non-null server-side |
| `statusFlowTransition` | `statusFlowId ?? ""` | pk member — same reasoning; confirm against a live response |
| `productStoreShipmentMethod` | `partyId \|\| carrierPartyId \|\| ""` | `rename` the fallback; verify whether it is ever genuinely absent |
| `systemMessageError` (Company) | `errorDate` | pk member |

Company tables whose PKs are marked UNVERIFIED in `companyDb.ts` (`enumGroupMembers`,
`facilityIdentifications`, `facilityGroupTypes`) return an empty 200 on the available instance. They
convert to their implied compound keys, and the comment recording that they are unverified is
carried over rather than dropped.

### Array keys downstream

New in `types.ts`:

```ts
export type DbKey = string | number | Array<string | number>;
```

- **`dbClient.ts`** — `get`/`remove` take `DbKey`; `getMany`/`bulkRemove` take `DbKey[]`. The
  `if (!key) return undefined` guard in `get` becomes an explicit emptiness check, because a valid
  array key is always truthy.
- **`projection.ts`** — `diffStaleKeys(existing: DbKey[], fresh: DbKey[]): DbKey[]` builds its `Set`
  over a canonical join and returns the **original** key forms so they pass straight to
  `bulkDelete`. The separator is `\u0000`, not `|`: `|` occurs in real data, `\u0000` cannot occur
  in an OFBiz id.
- **New `entityKeyOf(row, entity): DbKey | undefined`** — scalar for a single-field pk, array in
  declared order for a compound one. Replaces `keyOfRecord` in `snapshotDomain.ts` and the four
  `String(r[config.projection.keyField])` maps in the same file.
- **`apps/order-manager/src/db/useSeedData.ts`** — `new Map(all.map(r => [r[keyField], r]))` breaks
  silently on array keys, since `Map` compares arrays by identity. Needs the same canonical join.
- `snapshotDomain`'s `byPk` and `refetchScope` callbacks take `pk: Record<string, unknown>` and need
  **no** change; the field-map form was already key-shape-agnostic.

## Testing

`defineEntity` and `defineSchema` are pure, so they are plain unit tests:

- each throw case, named individually (empty pk, duplicate pk field, pk field not in `fields`, index
  not in `fields`, index restating the pk, duplicate index, unknown table in `pick`, table claimed
  twice in `mergeSchemas`, `syncMeta` as a key)
- schema-string emission for single-field and compound primary keys
- `pick` and `extendIndexes` returning subsets and widened index arrays without mutating the source

Behavioural coverage:

- `projectRow` with a compound key: all members present, one member missing (returns `null`), a
  member supplied only under its `rename` source
- `diffStaleKeys` with array keys, including two keys sharing a prefix that a naive join would
  conflate
- a schema-snapshot test asserting the emitted string for all 21 converted entities — this is what
  catches an accidental keyPath change

## Consequences

**Removed:** 9 seed + ~12 Company synthetic key columns; 9 seed `buildKey` functions; `EntityProjection.keyField`
and `EntityProjection.buildKey`; the string-splicing `extendIndexes` in `composeAppSchema`; `defineAppDb`'s
`seed` and `extendIndexes` options; `assertDistinctSeedTables` and the two sibling clash checks.

**Added:** `defineEntity`, `defineSchema`, `mergeSchemas`, `AppSchema.pick`, `AppSchema.extendIndexes`,
`entityKeyOf`, `DbKey`, `BaseDB`'s `version` parameter.

**Cost:** 21 stores get new keyPaths, so every local development database is rebuilt once and
re-syncs. `dbClient`'s key-taking signatures widen, which touches its call sites across both apps.
