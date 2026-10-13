import { afterAll, describe, it } from "vitest";
import { RuleTester } from "eslint";
import typescriptParser from "@typescript-eslint/parser";
import dataAccess from "../../eslint/plugins/data-access.js";

/**
 * The data-access lint rules: app code reaches the app database only through useLiveEntity and
 * appDb.entity(appDb.tables.x). Paths matter — `src/workers/**`, the worker entry and `src/db/**`
 * carry the allowances — so every case names its file.
 */
RuleTester.afterAll = afterAll;
RuleTester.describe = describe;
RuleTester.it = it;
RuleTester.itOnly = it.only;

const tester = new RuleTester({
  languageOptions: { parser: typescriptParser, ecmaVersion: "latest", sourceType: "module" },
});

const COMPOSABLE = "/repo/apps/company/src/composables/useWidgets.ts";
const VIEW = "/repo/apps/company/src/views/Settings.ts";
const STORE = "/repo/apps/order-manager/src/store/order.ts";
const WORKER_DOMAIN = "/repo/apps/company/src/workers/domains/organizationDomain.ts";
const WORKER_ENTRY = "/repo/apps/company/src/workers/appSync.worker.ts";
const DB_MODULE = "/repo/apps/order-manager/src/db/orderManagerDb.ts";
const DB_IMPORT = 'import { companyDb } from "@/db/companyDb";\n';

tester.run("data-access/no-direct-db", dataAccess.rules["no-direct-db"], {
  valid: [
    { filename: COMPOSABLE, code: DB_IMPORT + "companyDb.entity(companyDb.tables.facilities).all();" },
    { filename: COMPOSABLE, code: 'import type { EntityClient } from "@common/db/storage/dbClient";' },
    { filename: COMPOSABLE, code: 'import { type BaseDB } from "@common/db/storage/baseDb";' },
    { filename: COMPOSABLE, code: 'import type Dexie from "dexie";' },
    { filename: COMPOSABLE, code: 'import { toMillis } from "@common/db/storage/projection";' },
    { filename: COMPOSABLE, code: 'import { useLiveEntity, type BaseDB } from "@common";' },
    { filename: VIEW, code: DB_IMPORT + 'import { useDbStatus } from "@common";\nuseDbStatus(companyDb.client(), [], {});' },
    { filename: WORKER_DOMAIN, code: DB_IMPORT + 'const c = companyDb.client();\nc.syncedThisLogin("organization");' },
    { filename: WORKER_ENTRY, code: DB_IMPORT + "export const getDb = (oms: string) => companyDb.get(oms);" },
    { filename: DB_MODULE, code: 'import { orderManagerDb } from "@/db/orderManagerDb";\nexport const get = (oms: string) => orderManagerDb.get(oms);' },
  ],
  invalid: [
    { filename: COMPOSABLE, code: 'import Dexie from "dexie";', errors: [{ messageId: "dexie" }] },
    { filename: COMPOSABLE, code: 'import { liveQuery } from "dexie";', errors: [{ messageId: "dexie" }] },
    { filename: COMPOSABLE, code: 'import { dbClient } from "@common/db/storage/dbClient";', errors: [{ messageId: "storage" }] },
    { filename: COMPOSABLE, code: 'import { ensureDbReady } from "@common/db/storage/baseDb";', errors: [{ messageId: "storage" }] },
    { filename: COMPOSABLE, code: 'import { getAppDb } from "@common/db/schema/appDbRegistry";', errors: [{ messageId: "registry" }] },
    { filename: COMPOSABLE, code: 'import { dbClient, getAppDb } from "@common";', errors: [{ messageId: "lowLevel" }, { messageId: "lowLevel" }] },
    { filename: COMPOSABLE, code: 'import { markSyncedThisLogin } from "@common/db";', errors: [{ messageId: "lowLevel" }] },
    { filename: COMPOSABLE, code: DB_IMPORT + "companyDb.raw();", errors: [{ messageId: "raw" }] },
    { filename: COMPOSABLE, code: DB_IMPORT + 'companyDb.get("oms");', errors: [{ messageId: "get" }] },
    { filename: STORE, code: 'import { getOrderManagerDb } from "@/db/orderManagerDb";\ngetOrderManagerDb("oms");', errors: [{ messageId: "get" }] },
    { filename: COMPOSABLE, code: DB_IMPORT + 'companyDb.client().all("facilities");', errors: [{ messageId: "client" }] },
    { filename: VIEW, code: DB_IMPORT + "const client = companyDb.client();", errors: [{ messageId: "client" }] },
  ],
});

tester.run("data-access/table-name-from-schema", dataAccess.rules["table-name-from-schema"], {
  valid: [
    { filename: COMPOSABLE, code: DB_IMPORT + "companyDb.entity(companyDb.tables.facilities);" },
    { filename: COMPOSABLE, code: DB_IMPORT + "const table = companyDb.tables.facilities;\ncompanyDb.entity(table);" },
    { filename: COMPOSABLE, code: DB_IMPORT + "useLiveEntity<any>(companyDb.tables.facilities, { equals: { a: 1 } });" },
    { filename: COMPOSABLE, code: "useLiveEntity<any>(LEDGER_TABLES[kind], scoped);" },
    { filename: COMPOSABLE, code: 'otherThing.entity("facilities");' },
    { filename: WORKER_DOMAIN, code: DB_IMPORT + "const c = companyDb.client();\nc.count(companyDb.tables.organizations);" },
    { filename: WORKER_DOMAIN, code: DB_IMPORT + 'const c = companyDb.client();\nc.syncedThisLogin("organization");' },
    { filename: WORKER_DOMAIN, code: 'const c = makeThing();\nc.count("organizations");' },
  ],
  invalid: [
    {
      filename: COMPOSABLE,
      code: DB_IMPORT + 'companyDb.entity("facilities").all();',
      output: DB_IMPORT + "companyDb.entity(companyDb.tables.facilities).all();",
      errors: [{ messageId: "entity" }],
    },
    {
      filename: COMPOSABLE,
      code: DB_IMPORT + 'useLiveEntity<any>("facilities", opts);',
      output: DB_IMPORT + "useLiveEntity<any>(companyDb.tables.facilities, opts);",
      errors: [{ messageId: "liveEntity" }],
    },
    {
      filename: COMPOSABLE,
      code: DB_IMPORT + 'companyDb.entity("facilities" as any);',
      output: DB_IMPORT + "companyDb.entity(companyDb.tables.facilities);",
      errors: [{ messageId: "entity" }],
    },
    {
      filename: COMPOSABLE,
      code: 'useLiveEntity("facilities");',
      output: null,
      errors: [{ messageId: "liveEntity" }],
    },
    {
      filename: COMPOSABLE,
      code: 'useLiveEntity(client, "facilities");',
      output: null,
      errors: [{ messageId: "liveEntity" }],
    },    {
      filename: WORKER_DOMAIN,
      code: DB_IMPORT + 'const c = companyDb.client();\nc.count("organizations");',
      output: DB_IMPORT + "const c = companyDb.client();\nc.count(companyDb.tables.organizations);",
      errors: [{ messageId: "client" }],
    },
    {
      filename: WORKER_DOMAIN,
      code: DB_IMPORT + 'companyDb.client().put("facilities" as any, row);',
      output: DB_IMPORT + "companyDb.client().put(companyDb.tables.facilities, row);",
      errors: [{ messageId: "client" }],
    },
    {
      filename: WORKER_DOMAIN,
      code: DB_IMPORT + 'const c = companyDb.client();\nc.transaction("rw", ["facilities", companyDb.tables.organizations], fn);',
      output: DB_IMPORT + "const c = companyDb.client();\nc.transaction(\"rw\", [companyDb.tables.facilities, companyDb.tables.organizations], fn);",
      errors: [{ messageId: "client" }],
    },
  ],
});

tester.run("data-access/live-entity-in-setup", dataAccess.rules["live-entity-in-setup"], {
  valid: [
    { filename: COMPOSABLE, code: "useLiveEntity<any>(companyDb.tables.facilities);" },
    { filename: "/repo/apps/company/src/views/Facilities.ts", code: "useLiveEntity<any>(companyDb.tables.facilities);" },
    { filename: "/repo/apps/company/src/components/FacilityList.ts", code: "useLiveEntity<any>(companyDb.tables.facilities);" },
    { filename: "/repo/apps/company/src/App.vue", code: "useLiveEntity<any>(companyDb.tables.facilities);" },
    { filename: "/repo/common/db/composables/useLiveEntity.ts", code: "useLiveEntity<any>(t);" },
  ],
  invalid: [
    { filename: STORE, code: "useLiveEntity<any>(orderManagerDb.tables.statuses);", errors: [{ messageId: "notSetup" }] },
    { filename: "/repo/apps/company/src/services/sync.ts", code: "useLiveEntity<any>(t);", errors: [{ messageId: "notSetup" }] },
    { filename: "/repo/apps/company/src/utils/rows.ts", code: "useLiveEntity<any>(t);", errors: [{ messageId: "notSetup" }] },
    { filename: WORKER_DOMAIN, code: "useLiveEntity<any>(t);", errors: [{ messageId: "notSetup" }] },
    { filename: "/repo/apps/company/src/router/guards.ts", code: "useLiveEntity<any>(t);", errors: [{ messageId: "notSetup" }] },
    { filename: "/repo/apps/company/src/main.ts", code: "useLiveEntity<any>(t);", errors: [{ messageId: "notSetup" }] },
    { filename: DB_MODULE, code: "useLiveEntity<any>(t);", errors: [{ messageId: "notSetup" }] },
  ],
});
