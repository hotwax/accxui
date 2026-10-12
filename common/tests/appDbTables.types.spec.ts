import { describe, expect, it } from "vitest";
import { defineAppDb, type AppDbTables } from "../db/schema/defineAppDb";
import { defineEntity } from "../db/schema/defineEntity";
import { defineSchema, mergeSchemas } from "../db/schema/defineSchema";

/**
 * An app database type-checks table names against the tables ITS schema declared: the ones it
 * picked from a seed schema plus its own. `tables` names them statically. The `@ts-expect-error`
 * lines are the assertions; they are enforced by type-checking this file
 * (`npx tsc -p common/tests/tsconfig.types.json`), and the probes are never run.
 */
const seed = defineSchema({
  statuses: defineEntity({ primaryKey: "statusId", fields: { statusId: "text" } }),
  enums: defineEntity({ primaryKey: "enumId", fields: { enumId: "text" } }),
}, { seed: true });

const own = defineSchema({
  widgets: defineEntity({ primaryKey: "widgetId", fields: { widgetId: "text" } }),
});

const appDb = defineAppDb({ suffix: "TypesDB", schema: mergeSchemas(seed.pick(["statuses"]), own) });

function probes() {
  appDb.entity("statuses");
  appDb.entity("widgets");
  appDb.client().all("widgets");
  appDb.client().get("syncMeta", "loginSync:status");

  // @ts-expect-error — not a table anywhere
  appDb.entity("widgetz");
  // @ts-expect-error — a seed table this app did not pick
  appDb.entity("enums");
  // @ts-expect-error — the client checks names too
  appDb.client().all("nope");
  // @ts-expect-error — there is no raw Dexie handle on an app database
  appDb.raw();

  const table: AppDbTables<typeof appDb> = "widgets";
  // @ts-expect-error — the helper type is the same set
  const wrong: AppDbTables<typeof appDb> = "enums";
  return [table, wrong];
}

/** `tables` names exactly the app's tables, statically, and goes wherever a table name does. */
function tableNameProbes() {
  const name: string = appDb.tables.widgets;
  appDb.entity(appDb.tables.widgets);
  // @ts-expect-error — not a table of this app
  appDb.tables.widgetz;
  // @ts-expect-error — a seed table this app did not pick is absent, as in the database
  appDb.tables.enums;
  // pick accepts the schema's names, and the picked schema has only those.
  const picked = seed.pick([seed.tables.statuses]);
  // @ts-expect-error — not picked
  picked.tables.enums;
  return [name, picked];
}

describe("app database table names", () => {
  it("is checked at compile time (see the @ts-expect-error probes)", () => {
    expect(typeof probes).toBe("function");
    expect(typeof tableNameProbes).toBe("function");
    expect(appDb.tableNames).toEqual(["statuses", "widgets"]);
  });

  it("names every table statically, narrowed by pick and combined by mergeSchemas", () => {
    expect(appDb.tables).toEqual({ statuses: "statuses", widgets: "widgets" });
    expect(seed.tables).toEqual({ statuses: "statuses", enums: "enums" });
    expect(seed.pick(["statuses"]).tables).toEqual({ statuses: "statuses" });
  });
});
