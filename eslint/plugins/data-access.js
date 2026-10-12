/**
 * `data-access` — how app code may reach the app database (IndexedDB).
 *
 * Two patterns, and only these:
 *   - rows live on screen:      useLiveEntity(appDb.tables.x, options)   (components, views, composables)
 *   - an answer now, or a write: appDb.entity(appDb.tables.x).get / query / upsertMany …   (anywhere)
 *
 * `appDb` is whatever the file imports from `@/db/…` (`companyDb`, `orderManagerDb`). Everything below
 * Dexie — `dbClient`, `baseDb`, the registry, `raw()` / `get()` handles — belongs to `common/db` and the
 * worker wiring, not to app code. See docs/APP_DB_DEVELOPER_GUIDE.md §1 and the `accxui-data-access`
 * agent skill. Add further data-access rules to this plugin.
 */

const GUIDE = "See docs/APP_DB_DEVELOPER_GUIDE.md §1.";

/** Low-level names the `@common` / `@common/db` barrels re-export; app code may import them as types only. */
const LOW_LEVEL_EXPORTS = new Set([
  "dbClient",
  "getAppDb",
  "setAppDb",
  "ensureDbReady",
  "clearDatabaseTables",
  "hasSyncedThisLogin",
  "markSyncedThisLogin",
  "clearSyncedThisLogin",
  "BaseDB",
]);

const STORAGE_MODULES = new Set(["@common/db/storage/dbClient", "@common/db/storage/baseDb"]);

const posix = (filename) => filename.replace(/\\/g, "/");
const inAppDbModule = (filename) => /\/src\/db\//.test(posix(filename));
const inWorkers = (filename) => /\/src\/workers\//.test(posix(filename));
const isWorkerEntry = (filename) => /\/src\/workers\/[^/]+\.worker\.ts$/.test(posix(filename));
const inNonComponentCode = (filename) => /\/src\/(store|services|utils|workers)\//.test(posix(filename));

const isTypeOnly = (declaration, specifier) =>
  declaration.importKind === "type" || specifier?.importKind === "type";

/** Local names this file imports from the app's db modules (`@/db/…`). */
function collectAppDbNames(program) {
  const names = new Set();
  for (const statement of program.body) {
    if (statement.type !== "ImportDeclaration" || !String(statement.source.value).startsWith("@/db/")) continue;
    for (const specifier of statement.specifiers) {
      if (!isTypeOnly(statement, specifier)) names.add(specifier.local.name);
    }
  }
  return names;
}

/** `appDb.<method>(...)` on an imported app db object: the object's name, or undefined. */
function appDbMethodCall(node, appDbNames, method) {
  const callee = node.callee;
  if (callee.type !== "MemberExpression" || callee.computed) return undefined;
  if (callee.object.type !== "Identifier" || !appDbNames.has(callee.object.name)) return undefined;
  if (callee.property.type !== "Identifier" || callee.property.name !== method) return undefined;
  return callee.object.name;
}

/** The expression under any TypeScript wrapper: `"x" as any`, `"x" satisfies T`, `x!`. */
const unwrap = (node) =>
  node && ["TSAsExpression", "TSSatisfiesExpression", "TSNonNullExpression", "TSTypeAssertion"].includes(node.type)
    ? unwrap(node.expression)
    : node;

const isStringTable = (node) => {
  const inner = unwrap(node);
  return Boolean(inner) && ((inner.type === "Literal" && typeof inner.value === "string") || inner.type === "TemplateLiteral");
};

const tableText = (node) => (unwrap(node).type === "Literal" ? unwrap(node).value : null);

const noDirectDb = {
  meta: {
    type: "problem",
    docs: { description: "App code reaches the app database only through useLiveEntity and appDb.entity(...)." },
    schema: [],
    messages: {
      dexie: "Do not use Dexie in app code. Read with useLiveEntity(appDb.tables.x) on screen, or appDb.entity(appDb.tables.x) for one-shot reads and writes. " + GUIDE,
      storage: "'{{source}}' is the storage layer beneath the app database. Import its types only; read and write through appDb.entity(...) / useLiveEntity. " + GUIDE,
      registry: "Use the app's own db object (companyDb, orderManagerDb), not the app-db registry. " + GUIDE,
      lowLevel: "'{{name}}' is framework-internal. Read and write through appDb.entity(...) / useLiveEntity. " + GUIDE,
      raw: "There is no raw Dexie handle on an app database. Use {{db}}.entity({{db}}.tables.x) or useLiveEntity({{db}}.tables.x). " + GUIDE,
      get: "{{db}}.get(oms) hands out the database handle and is for the worker entry only. Use {{db}}.entity({{db}}.tables.x). " + GUIDE,
      client: "{{db}}.client() is for worker sync domains and the useDbStatus argument only. Use {{db}}.entity({{db}}.tables.x) (one-shot) or useLiveEntity({{db}}.tables.x) (live). " + GUIDE,
    },
  },
  create(context) {
    const filename = context.filename;
    let appDbNames = new Set();
    return ({
      Program(program) {
        appDbNames = collectAppDbNames(program);
      },
      ImportDeclaration(node) {
        const source = String(node.source.value);
        if (source === "dexie") {
          if (node.importKind !== "type") context.report({ node, messageId: "dexie" });
          return;
        }
        if (STORAGE_MODULES.has(source)) {
          const valueImport = node.importKind !== "type"
            && (node.specifiers.length === 0 || node.specifiers.some((specifier) => !isTypeOnly(node, specifier)));
          if (valueImport) context.report({ node, messageId: "storage", data: { source } });
          return;
        }
        if (source === "@common/db/schema/appDbRegistry") {
          if (node.importKind !== "type") context.report({ node, messageId: "registry" });
          return;
        }
        if (source === "@common" || source === "@common/db") {
          for (const specifier of node.specifiers) {
            if (specifier.type !== "ImportSpecifier" || isTypeOnly(node, specifier)) continue;
            const name = specifier.imported.name ?? specifier.imported.value;
            if (LOW_LEVEL_EXPORTS.has(name)) context.report({ node: specifier, messageId: "lowLevel", data: { name } });
          }
        }
      },
      CallExpression(node) {
        const raw = appDbMethodCall(node, appDbNames, "raw");
        if (raw) {
          context.report({ node, messageId: "raw", data: { db: raw } });
          return;
        }

        const get = appDbMethodCall(node, appDbNames, "get");
        const getWrapper = node.callee.type === "Identifier" && appDbNames.has(node.callee.name)
          && /^get[A-Z]\w*Db$/.test(node.callee.name);
        if ((get || getWrapper) && !isWorkerEntry(filename) && !inAppDbModule(filename)) {
          context.report({ node, messageId: "get", data: { db: get ?? node.callee.name } });
          return;
        }

        const client = appDbMethodCall(node, appDbNames, "client");
        if (client && !inWorkers(filename) && !inAppDbModule(filename)) {
          const parent = node.parent;
          const isUseDbStatusSource = parent?.type === "CallExpression"
            && parent.callee.type === "Identifier" && parent.callee.name === "useDbStatus"
            && parent.arguments[0] === node;
          if (!isUseDbStatusSource) context.report({ node, messageId: "client", data: { db: client } });
        }
      },
    });
  },
};

const tableNameFromSchema = {
  meta: {
    type: "problem",
    fixable: "code",
    docs: { description: "Name tables through appDb.tables, never as string literals." },
    schema: [],
    messages: {
      entity: "Name the table through {{db}}.tables: {{db}}.entity({{db}}.tables.{{table}}). A typo there fails to compile. " + GUIDE,
      liveEntity: "Name the table through the app db's tables object: useLiveEntity(appDb.tables.{{table}}, …). A typo there fails to compile. " + GUIDE,
    },
  },
  create(context) {
    let appDbNames = new Set();
    return ({
      Program(program) {
        appDbNames = collectAppDbNames(program);
      },
      CallExpression(node) {
        const db = appDbMethodCall(node, appDbNames, "entity");
        if (db) {
          const [table] = node.arguments;
          if (isStringTable(table)) {
            const name = tableText(table);
            context.report({
              node: table,
              messageId: "entity",
              data: { db, table: name ?? "x" },
              fix: name && /^[A-Za-z_$][\w$]*$/.test(name)
                ? (fixer) => fixer.replaceText(table, `${db}.tables.${name}`)
                : null,
            });
          }
          return;
        }

        if (node.callee.type === "Identifier" && node.callee.name === "useLiveEntity") {
          const [first, second] = node.arguments;
          const table = isStringTable(first) ? first : (first && !isStringTable(first) && isStringTable(second) ? second : null);
          if (table) {
            const onlyDb = appDbNames.size === 1 ? [...appDbNames][0] : null;
            const name = tableText(table);
            context.report({
              node: table,
              messageId: "liveEntity",
              data: { table: name ?? "x" },
              fix: onlyDb && table === first && name && /^[A-Za-z_$][\w$]*$/.test(name)
                ? (fixer) => fixer.replaceText(table, `${onlyDb}.tables.${name}`)
                : null,
            });
          }
        }
      },
    });
  },
};

const liveEntityInSetup = {
  meta: {
    type: "problem",
    docs: { description: "useLiveEntity is a composable: components, views and composables only." },
    schema: [],
    messages: {
      notSetup: "useLiveEntity is a Vue composable and only works during setup (components, views, composables). In stores, services, utils and workers use appDb.entity(appDb.tables.x) for a one-shot read. " + GUIDE,
    },
  },
  create(context) {
    if (!inNonComponentCode(context.filename)) return {};
    return ({
      CallExpression(node) {
        if (node.callee.type === "Identifier" && node.callee.name === "useLiveEntity") {
          context.report({ node, messageId: "notSetup" });
        }
      },
    });
  },
};

const plugin = {
  meta: { name: "data-access" },
  rules: {
    "no-direct-db": noDirectDb,
    "table-name-from-schema": tableNameFromSchema,
    "live-entity-in-setup": liveEntityInSetup,
  },
};

/** Every data-access rule, as errors. */
export const dataAccessRules = {
  "data-access/no-direct-db": "error",
  "data-access/table-name-from-schema": "error",
  "data-access/live-entity-in-setup": "error",
};

/** App code the rules apply to, and the app-local Dexie stores deliberately outside the app database. */
export const DATA_ACCESS_FILES = ["apps/*/src/**/*.ts", "apps/*/src/**/*.vue"];
export const DATA_ACCESS_EXEMPT = ["apps/company/src/utils/storage.ts", "apps/order-manager/src/services/productDb.ts"];

export default plugin;
