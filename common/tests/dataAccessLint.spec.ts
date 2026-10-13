import { describe, expect, it } from "vitest";
import { ESLint } from "eslint";
import path from "path";
// @ts-expect-error -- plain JS config module
import { dbConfig } from "../../eslint.config.js";

/**
 * The data-access rules in the root `eslint.config.js`: app code reaches the app database only
 * through useLiveEntity and appDb.entity(appDb.tables.x). They are built from core rules
 * (`no-restricted-syntax`, `@typescript-eslint/no-restricted-imports`), so this runs the real config
 * and keeps only the data-access messages. Paths matter — `src/workers/**`, the worker entry and
 * `src/db/**` carry the allowances — so every case names its file.
 */
const ROOT = path.resolve(__dirname, "../..");
const eslint = new ESLint({ cwd: ROOT, overrideConfigFile: path.join(ROOT, "eslint.config.js") });

const COMPOSABLE = "apps/app/src/composables/useWidgets.ts";
const VIEW = "apps/app/src/views/Settings.vue";
const STORE = "apps/app/src/store/order.ts";
const SERVICE = "apps/app/src/services/sync.ts";
const WORKER_DOMAIN = "apps/app/src/workers/domains/widgetDomain.ts";
const WORKER_ENTRY = "apps/app/src/workers/appSync.worker.ts";
const DB_MODULE = "apps/app/src/db/appDb.ts";
const DB_IMPORT = 'import { appDb } from "@/db/appDb";\n';

/** The data-access messages ESLint reports for `code` at `file`. */
async function dataAccessErrors(file: string, code: string): Promise<string[]> {
  const source = file.endsWith(".vue") ? `<script setup lang="ts">\n${code}\n</script>\n` : code;
  const [result] = await eslint.lintText(source, { filePath: path.join(ROOT, file) });
  return result.messages
    .filter((message) => message.message.includes("APP_DB_DEVELOPER_GUIDE"))
    .map((message) => message.message);
}

const valid: Array<[string, string]> = [
  [COMPOSABLE, DB_IMPORT + "appDb.entity(appDb.tables.facilities).all();"],
  [COMPOSABLE, 'import type { EntityClient } from "@common/db/storage/dbClient";'],
  [COMPOSABLE, 'import { type BaseDB } from "@common/db/storage/baseDb";'],
  [COMPOSABLE, 'import type Dexie from "dexie";'],
  [COMPOSABLE, 'import { toMillis } from "@common/db/storage/projection";'],
  [COMPOSABLE, 'import { useLiveEntity, type BaseDB } from "@common";'],
  [COMPOSABLE, DB_IMPORT + "const table = appDb.tables.facilities;\nappDb.entity(table);"],
  [COMPOSABLE, DB_IMPORT + "useLiveEntity<any>(appDb.tables.facilities, { equals: { a: 1 } });"],
  [COMPOSABLE, "useLiveEntity<any>(LEDGER_TABLES[kind], scoped);"],
  [COMPOSABLE, DB_IMPORT + "useLiveEntity<any>(appDb.tables.facilities, null);"],
  [COMPOSABLE, 'otherThing.entity("facilities");'],
  [VIEW, DB_IMPORT + 'import { useDbStatus } from "@common";\nuseDbStatus(appDb.client(), [], {});'],
  [VIEW, DB_IMPORT + "useLiveEntity<any>(appDb.tables.facilities);"],
  ["apps/app/src/components/FacilityList.ts", "useLiveEntity<any>(appDb.tables.facilities);"],
  [WORKER_DOMAIN, DB_IMPORT + 'const c = appDb.client();\nc.syncedThisLogin("widget");'],
  [WORKER_DOMAIN, DB_IMPORT + "appDb.client().count(appDb.tables.widgets);"],
  [WORKER_ENTRY, DB_IMPORT + "export const getDb = (oms: string) => appDb.get(oms);"],
  [DB_MODULE, "export const get = (oms: string) => appDb.get(oms);"],
  ["common/db/composables/useLiveEntity.ts", "useLiveEntity<any>(t);"],
];

const invalid: Array<[string, string]> = [
  [COMPOSABLE, 'import Dexie from "dexie";'],
  [COMPOSABLE, 'import { liveQuery } from "dexie";'],
  [COMPOSABLE, 'import { dbClient } from "@common/db/storage/dbClient";'],
  [COMPOSABLE, 'import { ensureDbReady } from "@common/db/storage/baseDb";'],
  [COMPOSABLE, 'import { getAppDb } from "@common/db/schema/appDbRegistry";'],
  [COMPOSABLE, 'import { markSyncedThisLogin } from "@common/db";'],
  [COMPOSABLE, DB_IMPORT + "appDb.raw();"],
  [COMPOSABLE, DB_IMPORT + 'appDb.get("oms");'],
  [STORE, DB_IMPORT + 'appDb.get("oms");'],
  [COMPOSABLE, DB_IMPORT + "appDb.client().all(appDb.tables.facilities);"],
  [VIEW, DB_IMPORT + "const client = appDb.client();"],
  [COMPOSABLE, DB_IMPORT + 'appDb.entity("facilities").all();'],
  [COMPOSABLE, DB_IMPORT + 'appDb.entity("facilities" as any);'],
  [COMPOSABLE, DB_IMPORT + 'useLiveEntity<any>("facilities", opts);'],
  [COMPOSABLE, 'useLiveEntity(client, "facilities");'],
  [WORKER_DOMAIN, DB_IMPORT + 'appDb.client().put("facilities" as any, row);'],
  [WORKER_DOMAIN, DB_IMPORT + 'appDb.client().liveRead(["facilities", appDb.tables.widgets], fn);'],
  [STORE, "useLiveEntity<any>(appDb.tables.statuses);"],
  [SERVICE, "useLiveEntity<any>(t);"],
  ["apps/app/src/utils/rows.ts", "useLiveEntity<any>(t);"],
  [WORKER_DOMAIN, "useLiveEntity<any>(t);"],
  ["apps/app/src/router/guards.ts", "useLiveEntity<any>(t);"],
  ["apps/app/src/main.ts", "useLiveEntity<any>(t);"],
  [DB_MODULE, "useLiveEntity<any>(t);"],
];

describe("data-access lint rules", () => {
  it.each(valid)("allows %s: %s", async (file, code) => {
    expect(await dataAccessErrors(file, code)).toEqual([]);
  });

  it.each(invalid)("rejects %s: %s", async (file, code) => {
    expect(await dataAccessErrors(file, code)).toHaveLength(1);
  });

  it("reports each low-level name imported from @common", async () => {
    expect(await dataAccessErrors(COMPOSABLE, 'import { dbClient, getAppDb } from "@common";')).toHaveLength(2);
  });

  it("dbConfig alone (what the apps lint with) reports the same violations and nothing else", async () => {
    const appOnly = new ESLint({ cwd: ROOT, overrideConfigFile: true, overrideConfig: dbConfig });
    for (const [file, code] of invalid) {
      const source = file.endsWith(".vue") ? `<script setup lang="ts">\n${code}\n</script>\n` : code;
      const [result] = await appOnly.lintText(source, { filePath: path.join(ROOT, file) });
      expect(result.messages.map((message) => message.message)).toHaveLength(1);
      expect(result.messages[0].message).toContain("APP_DB_DEVELOPER_GUIDE");
    }
    const [clean] = await appOnly.lintText('export const orderStore = defineStore("order", {});\napi({ url: "x" });', {
      filePath: path.join(ROOT, STORE),
    });
    expect(clean.messages).toEqual([]);
  });

  it("keeps the existing per-folder rules on files the data-access blocks also cover", async () => {
    const [store] = await eslint.lintText('export const orderStore = defineStore("order", {});', {
      filePath: path.join(ROOT, STORE),
    });
    expect(store.messages.map((message) => message.message)).toContain(
      "Store names must start with 'use' and end with 'Store' (e.g., useUserStore).",
    );
    const [view] = await eslint.lintText('<script setup lang="ts">\napi({ url: "x" });\n</script>\n', {
      filePath: path.join(ROOT, VIEW),
    });
    expect(view.messages.map((message) => message.message)).toContain(
      "Calling 'api' directly in vue files is not allowed. Use services or composables for API calls.",
    );
  });
});
