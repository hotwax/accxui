import fs from "fs";
import path from "path";
import js from "@eslint/js";
import pluginVue from "eslint-plugin-vue";
import vueParser from "vue-eslint-parser";
import * as espree from "espree";
import eslintPluginImport from "eslint-plugin-import-x";
import stylistic from "@stylistic/eslint-plugin";
import typescriptEslint from "@typescript-eslint/eslint-plugin";
import typescriptParser from "@typescript-eslint/parser";
import globals from "globals";

/**
 * Data access and layers. App code (outside `src/workers/**` and `src/db/**`) reads the app database
 * (IndexedDB) only through the composables, in a composable or a .vue file during setup:
 *   - rows live on screen:       useLiveEntity(appDb.tables.x, options)
 *   - seed labels and options:   useSeedData()  (never in App.vue)
 * Stores, utils and the router never read it: they take rows from their caller. Table names always
 * come from `appDb.tables`. Only a table's sync domain (`src/workers/**`) writes it: app code fetches
 * a missing record with refreshAfterMutation, and after a server write reconciles with
 * refreshAfterMutation / resyncDomain. API calls live only in composables, Pinia stores and worker
 * sync domains; utils are pure. An "app db" is any identifier ending in `Db` (`appDb`, `companyDb`,
 * …); a client held in a variable is any identifier ending in `Client` (`companyClient =
 * companyDb.client()`). See docs/APP_DB_DEVELOPER_GUIDE.md §7 and AGENTS.md (App layout).
 *
 * Built from core rules only. Because flat config replaces a rule's options per file rather than
 * merging them, the folder-specific lists are composed below and the data-access blocks at the end
 * restate the existing per-folder selectors they would otherwise override.
 */
const DATA_ACCESS_GUIDE = " See docs/APP_DB_DEVELOPER_GUIDE.md §7.";
const LAYERS_GUIDE = " See AGENTS.md (App layout).";
const APP_DB = "/^[A-Za-z_$][\\w$]*Db$/";
/** A DbClient held in a variable, by the naming the sync domains use: `companyClient = companyDb.client()`. */
const DB_CLIENT = "/^[A-Za-z_$][\\w$]*Client$/";
const TABLE_METHODS = "/^(entity|get|getMany|all|query|first|count|put|bulkPut|remove|bulkRemove|clear)$/";
const STRING = ":matches(Literal[value=/.*/], TemplateLiteral)";
/** A string-literal argument of the calls `call` matches, bare or as `"x" as any`. */
const stringArgOf = (call) => `${call} > ${STRING}.arguments, ${call} > TSAsExpression.arguments > ${STRING}`;

const LOW_LEVEL_EXPORTS = [
  "dbClient", "getAppDb", "setAppDb", "ensureDbReady", "clearDatabaseTables",
  "hasSyncedThisLogin", "markSyncedThisLogin", "clearSyncedThisLogin", "BaseDB",
];

const DATA_ACCESS_IMPORTS = ["error", {
  paths: [
    {
      name: "dexie",
      allowTypeImports: true,
      message: "Do not use Dexie in app code. Read with useLiveEntity(appDb.tables.x) in a composable or .vue file; only worker sync domains write." + DATA_ACCESS_GUIDE,
    },
    ...["@common/db/storage/dbClient", "@common/db/storage/baseDb", "@common/db/schema/appDbRegistry"].map((name) => ({
      name,
      allowTypeImports: true,
      message: "This is the framework layer beneath the app database. Import its types only; read with useLiveEntity(appDb.tables.x)." + DATA_ACCESS_GUIDE,
    })),
    ...["@common", "@common/db"].map((name) => ({
      name,
      importNames: LOW_LEVEL_EXPORTS,
      allowTypeImports: true,
      message: "Framework-internal. Read with useLiveEntity(appDb.tables.x) in a composable or .vue file." + DATA_ACCESS_GUIDE,
    })),
  ],
}];

/** Everywhere in app source. */
const DA_EVERYWHERE = [
  {
    selector: `CallExpression[callee.object.name=${APP_DB}][callee.property.name='raw']`,
    message: "There is no raw Dexie handle on an app database. Read with useLiveEntity(appDb.tables.x); worker domains use appDb.entity(appDb.tables.x)." + DATA_ACCESS_GUIDE,
  },
  {
    selector: stringArgOf(`CallExpression[callee.object.name=${APP_DB}][callee.property.name='entity']`),
    message: "Name the table through appDb.tables: appDb.entity(appDb.tables.x). A typo there fails to compile." + DATA_ACCESS_GUIDE,
  },
  {
    selector: stringArgOf("CallExpression[callee.name='useLiveEntity']"),
    message: "Name the table through appDb.tables: useLiveEntity(appDb.tables.x, …). A typo there fails to compile." + DATA_ACCESS_GUIDE,
  },
  {
    selector: stringArgOf(`CallExpression[callee.object.callee.object.name=${APP_DB}][callee.object.callee.property.name='client'][callee.property.name=${TABLE_METHODS}]`),
    message: "Name the table through appDb.tables: appDb.client().get(appDb.tables.x, …). A typo there fails to compile." + DATA_ACCESS_GUIDE,
  },
  {
    selector: stringArgOf(`CallExpression[callee.object.name=${DB_CLIENT}][callee.property.name=${TABLE_METHODS}]`),
    message: "Name the table through appDb.tables: companyClient.count(appDb.tables.x) for a client held in a variable. A typo there fails to compile." + DATA_ACCESS_GUIDE,
  },
  {
    selector: `CallExpression[callee.object.name=${DB_CLIENT}][callee.property.name=/^(liveRead|read|transaction)$/] > ArrayExpression > ${STRING}`,
    message: "Name the tables through appDb.tables: client.liveRead([appDb.tables.x, …], …) for a client held in a variable. A typo there fails to compile." + DATA_ACCESS_GUIDE,
  },
  {
    selector: `CallExpression[callee.object.callee.object.name=${APP_DB}][callee.object.callee.property.name='client'][callee.property.name=/^(liveRead|read|transaction)$/] > ArrayExpression > ${STRING}`,
    message: "Name the tables through appDb.tables: appDb.client().liveRead([appDb.tables.x, …], …). A typo there fails to compile." + DATA_ACCESS_GUIDE,
  },
];

/** Outside `src/db/**` and the worker entry. */
const DA_NO_GET = [{
  selector: `CallExpression[callee.object.name=${APP_DB}][callee.property.name='get']`,
  message: "appDb.get(oms) hands out the database handle and is for the worker entry only. Read with useLiveEntity(appDb.tables.x)." + DATA_ACCESS_GUIDE,
}];

/** Outside `src/workers/**` and `src/db/**`, except as the useDbStatus source. */
const DA_NO_CLIENT = [{
  selector: `CallExpression[callee.object.name=${APP_DB}][callee.property.name='client']:not(CallExpression[callee.name='useDbStatus'] > CallExpression.arguments:first-child)`,
  message: "appDb.client() is for worker sync domains and the useDbStatus argument only. Read with useLiveEntity(appDb.tables.x)." + DATA_ACCESS_GUIDE,
}];

/**
 * Outside composables (`src/composables`) and `.vue` files: the framework's Vue composables register
 * setup-time effects (provide/inject, unmount teardown), so they only run where a component is set up.
 */
const DA_NO_SETUP_COMPOSABLES = [
  {
    selector: "CallExpression[callee.name='useLiveEntity']",
    message: "useLiveEntity is a composable: call it only in a composable or a .vue file, during setup. A store, util or router takes the rows from its caller instead." + DATA_ACCESS_GUIDE,
  },
  {
    selector: "CallExpression[callee.name='useSeedData']",
    message: "useSeedData is a composable: call it only in a composable or a .vue file, during setup. A store, util or router takes the seed rows it needs as arguments from its caller." + DATA_ACCESS_GUIDE,
  },
  {
    selector: "CallExpression[callee.name='useDbStatus']",
    message: "useDbStatus is a composable: call it only in a composable or a .vue file, during setup." + DATA_ACCESS_GUIDE,
  },
];

/**
 * Outside `src/workers/**` and `src/db/**`: app code reads the app db only through useLiveEntity, so
 * there is no one-shot `appDb.entity(...)` read and no `loadSeedData()` snapshot in app code.
 */
const DA_NO_ENTITY = [
  {
    selector: `CallExpression[callee.object.name=${APP_DB}][callee.property.name='entity']`,
    message: "App code reads the app db only through useLiveEntity(appDb.tables.x, options), in a composable or a .vue file. appDb.entity(...) is for worker sync domains. A store, util or router takes the rows from its caller." + DATA_ACCESS_GUIDE,
  },
  {
    selector: "CallExpression[callee.name='loadSeedData']",
    message: "App code reads seed rows through useSeedData(), in a composable or a .vue file. A store, util or router takes the seed rows it needs as arguments from its caller." + DATA_ACCESS_GUIDE,
  },
];

/**
 * In App.vue: the first useSeedData() in a tree provides its live reads to every component below it,
 * so one in the root would hold every seed table open for the whole session.
 */
const DA_APP_NO_SEED = [{
  selector: "CallExpression[callee.name='useSeedData']",
  message: "No useSeedData() in App.vue: every component would inject this one instance and its seed reads would stay open for the session. Call it in the page (or component) that shows the labels." + DATA_ACCESS_GUIDE,
}];

/** In the sync worker: it writes and renders nothing, so a live query has no consumer. */
const DA_WORKER_NO_LIVE = [{
  selector: "CallExpression[callee.property.name=/^(live|liveRead)$/]",
  message: "No live queries in the sync worker: it writes and renders nothing, and nothing would unsubscribe them. Read once with appDb.entity(appDb.tables.x).get / query / all." + DATA_ACCESS_GUIDE,
}];

/**
 * Outside `src/workers/**`: a table's sync domain is its only writer, so a row has one shape however it
 * arrived. `upsertMany` / `snapshotReplace` are app-db names, flagged on any receiver (an entity held
 * in a variable included); the generic `put` / `bulkPut` / `remove` / `bulkRemove` / `clear` only when
 * called straight on `appDb.entity(...)`, so an app-local Dexie store keeps them.
 */
const DA_NO_WRITE = [
  {
    selector: "CallExpression[callee.property.name=/^(upsertMany|snapshotReplace)$/]",
    message: "Only worker sync domains write the app db. For a record the db is missing, call refreshAfterMutation(domain, pk); after a server write, call refreshAfterMutation(domain, pk) or resyncDomain(domain). useLiveEntity shows the new rows." + DATA_ACCESS_GUIDE,
  },
  {
    selector: `CallExpression[callee.property.name=/^(put|bulkPut|remove|bulkRemove|clear)$/][callee.object.callee.property.name='entity'][callee.object.callee.object.name=${APP_DB}]`,
    message: "Only worker sync domains write the app db. For a record the db is missing, call refreshAfterMutation(domain, pk); after a server write, call refreshAfterMutation(domain, pk) or resyncDomain(domain). useLiveEntity shows the new rows." + DATA_ACCESS_GUIDE,
  },
];

/** In `src/utils/**`: a util is pure, so it takes store data from its caller rather than reading a store. */
const UTIL_NO_STORE = [{
  selector: "CallExpression[callee.name=/^use[A-Z]\\w*Store$/]",
  message: "Utils do not read Pinia stores. Take the data as a parameter and let the composable, store or page that calls the util pass it." + LAYERS_GUIDE,
}];

/** Page-level sync: an activation is always retired, and only by its own owner. */
const DA_PAGE_SYNC = [
  {
    selector: "Program:not(:has(CallExpression[callee.name='deactivateSyncDomains'])) CallExpression[callee.name='activateSyncDomains']",
    message: "activateSyncDomains without a matching deactivateSyncDomains(owner) in this file keeps the worker polling after the page is left. Deactivate with the same owner on leave (onIonViewDidLeave)." + DATA_ACCESS_GUIDE,
  },
  {
    selector: "CallExpression[callee.name='deactivateSyncDomains'][arguments.length=0]",
    message: "Pass the owner: deactivateSyncDomains(SYNC_OWNER). Without it the call clears whatever page now holds the worker, including the one being entered." + DATA_ACCESS_GUIDE,
  },
];

/** A page (.vue) that activates domains retires them when Ionic leaves it. */
const DA_PAGE_LEAVE = [{
  selector: "Program:not(:has(CallExpression[callee.name='onIonViewDidLeave'])) CallExpression[callee.name='activateSyncDomains']",
  message: "This page activates sync domains but has no onIonViewDidLeave. Call deactivateSyncDomains(SYNC_OWNER) there (directly or through the composable's deactivate()), or the domains keep polling after the page is left." + DATA_ACCESS_GUIDE,
}];

/**
 * Layers: which folder may import which. Core `no-restricted-imports`, composed per folder below (flat
 * config replaces a rule's options per file, it does not merge them).
 *   - API calls (`api` / `client`) only in composables, Pinia stores and worker sync domains;
 *   - composables only in other composables and .vue files (framework helpers such as useAuth,
 *     useSolrSearch and useMaargConfig are plain functions and stay allowed);
 *   - stores never read the app db (only `@/db/appDbSync`, to reconcile after a write), and the app db
 *     and its workers never reach a store;
 *   - utils are pure: no API, no stores, no app db, no composables.
 */
const IMPORT_API = [
  {
    name: "@common",
    importNames: ["api", "client"],
    message: "API calls live only in composables, Pinia stores and worker sync domains. Call the composable or store that owns the request." + LAYERS_GUIDE,
  },
  {
    name: "@common/core/remoteApi",
    message: "API calls live only in composables, Pinia stores and worker sync domains. Call the composable or store that owns the request." + LAYERS_GUIDE,
  },
];
const IMPORT_COMPOSABLES = [{
  group: ["@/composables/*", "./composables/*", "../composables/*", "../../composables/*"],
  allowTypeImports: true,
  message: "Composables are used only by other composables and .vue files. A store, util or router takes what it needs as arguments, and a page or composable passes it." + LAYERS_GUIDE,
}];
const IMPORT_STORES = [{
  group: ["@/store/*", "./store/*", "../store/*", "../../store/*", "pinia"],
  allowTypeImports: true,
  message: "Pinia stores are not reached from here: the app db, its workers and utils stay independent of stores. A composable or page joins store data with what this provides." + LAYERS_GUIDE,
}];
const IMPORT_APP_DB_FROM_STORE = [{
  group: ["@/db/*", "!@/db/appDbSync"],
  allowTypeImports: true,
  message: "Pinia stores hold server data only and do not read the app db. A page or domain composable joins store data with useLiveEntity / useSeedData rows. A store may import @/db/appDbSync to reconcile after a write." + LAYERS_GUIDE,
}];
const IMPORT_APP_DB_FROM_UTIL = [{
  group: ["@/db/*"],
  allowTypeImports: true,
  message: "Utils are pure and do not read the app db. Take the rows as a parameter from the composable or page that calls the util." + LAYERS_GUIDE,
}];
const IMPORT_DB_READS_FROM_UTIL = ["@common", "@common/db"].map((name) => ({
  name,
  importNames: ["useLiveEntity", "useSeedData", "loadSeedData"],
  allowTypeImports: true,
  message: "Utils are pure and do not read the app db. Take the rows as a parameter from the composable or page that calls the util." + LAYERS_GUIDE,
}));

const imports = (paths, patterns = []) => ["error", { paths: paths.flat(Infinity), patterns: patterns.flat(Infinity) }];
/** The data-access import bans plus a folder's layer bans, in the TypeScript rule so type imports pass. */
const layerImports = (paths = [], patterns = []) => ["error", {
  paths: [DATA_ACCESS_IMPORTS[1].paths, paths].flat(Infinity),
  patterns: patterns.flat(Infinity),
}];

/** No API calls in .vue files, kept as its own list so an app still moving its calls can switch it off alone. */
const VUE_NO_API_IMPORTS = imports(IMPORT_API);

/** The existing per-folder selectors, shared with the data-access blocks that restate them. */
const VUE_NO_API_SYNTAX = [
  {
    "selector": "CallExpression[callee.name='api']",
    "message": "Calling 'api' directly in vue files is not allowed. Use composables or stores for API calls."
  },
  {
    "selector": "CallExpression[callee.name='client']",
    "message": "Calling 'client' directly in vue files is not allowed. Use composables or stores for API calls."
  }
];
const COMPOSABLE_NAME_SYNTAX = [
  {
    "selector": "ExportNamedDeclaration > FunctionDeclaration[id.name!=/^use.*/]",
    "message": "Composable function names must start with 'use'."
  },
  {
    "selector": "ExportNamedDeclaration > VariableDeclaration > VariableDeclarator[init.type='ArrowFunctionExpression'][id.name!=/^use.*/]",
    "message": "Composable arrow function names must start with 'use'."
  }
];
const STORE_NAME_SYNTAX = [
  {
    "selector": "VariableDeclarator[init.type='CallExpression'][init.callee.name='defineStore'][id.name!=/^use.*Store$/]",
    "message": "Store names must start with 'use' and end with 'Store' (e.g., useUserStore)."
  }
];

const syntax = (...lists) => ["error", ...lists.flat(Infinity)];

/**
 * The data-access and layer blocks. App source is `src/**` of the app being linted, so the patterns
 * hold whether ESLint runs from the repo root or from an app. Later blocks win for a rule, so the
 * general block comes first and each narrower folder restates the full list it needs — including
 * `folder`, the per-folder selectors the full config already has there (no `api()` in `.vue`, `use*`
 * composable and store names), which this block would otherwise override.
 *
 * Every folder not named below (router, authorization, config, types, main.ts, plain .ts under
 * components / views) gets the general block: no API, no composables, no app-db reads.
 */
function dataAccessBlocks(folder = { vue: [], composables: [], store: [] }) {
  const appCode = [DA_EVERYWHERE, DA_PAGE_SYNC, DA_NO_GET, DA_NO_CLIENT, DA_NO_WRITE, DA_NO_ENTITY];
  return [
    {
      files: ["**/src/**/*.ts", "**/src/**/*.vue"],
      rules: {
        "no-restricted-imports": imports(IMPORT_API),
        "@typescript-eslint/no-restricted-imports": layerImports([], IMPORT_COMPOSABLES),
        "no-restricted-syntax": syntax(appCode, DA_NO_SETUP_COMPOSABLES),
      }
    },
    {
      files: ["**/src/**/*.vue"],
      rules: {
        "@typescript-eslint/no-restricted-imports": DATA_ACCESS_IMPORTS,
        "no-restricted-syntax": syntax(folder.vue, appCode, DA_PAGE_LEAVE),
      }
    },
    {
      files: ["**/src/App.vue"],
      rules: { "no-restricted-syntax": syntax(folder.vue, appCode, DA_PAGE_LEAVE, DA_APP_NO_SEED) }
    },
    {
      files: ["**/src/**/composables/**/*.ts"],
      rules: {
        "no-restricted-imports": "off",
        "@typescript-eslint/no-restricted-imports": DATA_ACCESS_IMPORTS,
        "no-restricted-syntax": syntax(folder.composables, appCode),
      }
    },
    {
      files: ["**/src/store/**/*.ts"],
      rules: {
        "no-restricted-imports": "off",
        "@typescript-eslint/no-restricted-imports": layerImports([], [IMPORT_COMPOSABLES, IMPORT_APP_DB_FROM_STORE]),
        "no-restricted-syntax": syntax(folder.store, appCode, DA_NO_SETUP_COMPOSABLES),
      }
    },
    {
      files: ["**/src/utils/**/*.ts"],
      rules: {
        "@typescript-eslint/no-restricted-imports": layerImports(IMPORT_DB_READS_FROM_UTIL, [IMPORT_COMPOSABLES, IMPORT_STORES, IMPORT_APP_DB_FROM_UTIL]),
        "no-restricted-syntax": syntax(appCode, DA_NO_SETUP_COMPOSABLES, UTIL_NO_STORE),
      }
    },
    {
      files: ["**/src/db/**/*.ts"],
      rules: {
        "@typescript-eslint/no-restricted-imports": layerImports([], [IMPORT_COMPOSABLES, IMPORT_STORES]),
        "no-restricted-syntax": syntax(DA_EVERYWHERE, DA_PAGE_SYNC, DA_NO_WRITE, DA_NO_SETUP_COMPOSABLES),
      }
    },
    {
      files: ["**/src/workers/**/*.ts"],
      rules: {
        "@typescript-eslint/no-restricted-imports": layerImports([], [IMPORT_COMPOSABLES, IMPORT_STORES]),
        "no-restricted-syntax": syntax(DA_EVERYWHERE, DA_PAGE_SYNC, DA_NO_GET, DA_NO_SETUP_COMPOSABLES, DA_WORKER_NO_LIVE),
      }
    },
    {
      files: ["**/src/workers/*.worker.ts"],
      rules: { "no-restricted-syntax": syntax(DA_EVERYWHERE, DA_PAGE_SYNC, DA_NO_SETUP_COMPOSABLES, DA_WORKER_NO_LIVE) }
    },
  ];
}

/**
 * The rules an app lints with and gates its build on (`eslint src && vite build`), with just the
 * parsers they need — `import { dbConfig } from "../../eslint.config.js"`: the local-database
 * (IndexedDB) rules, plus no API calls in .vue files. The full default export below includes them too.
 */
export const dbConfig = [
  {
    ignores: ["**/node_modules/**", "**/dist/**", "**/dev-dist/**", "**/platforms/**", "**/build/**"]
  },
  {
    files: ["**/src/**/*.ts", "**/src/**/*.vue"],
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "module",
      parser: vueParser,
      parserOptions: {
        parser: typescriptParser,
        ecmaVersion: "latest",
        sourceType: "module",
        extraFileExtensions: [".vue"],
      },
    },
    plugins: { "@typescript-eslint": typescriptEslint },
    // eslint-disable comments for rules this config does not load are not this config's concern.
    linterOptions: { reportUnusedDisableDirectives: "off" },
  },
  // In .vue files the API ban is `no-restricted-imports` alone, so an app still moving its calls out of
  // a page can switch that rule off for the page without losing the data-access rules.
  ...dataAccessBlocks(),
];

const localesCache = new Map();

function getEnKeys(filePath) {
  let currentDir = path.dirname(filePath);
  const root = path.parse(filePath).root;

  while (currentDir !== root) {
    // Try src/locales/en.json (if we are at app root)
    let localePath = path.join(currentDir, "src", "locales", "en.json");
    if (!fs.existsSync(localePath)) {
      // Try locales/en.json (if we are already in src)
      localePath = path.join(currentDir, "locales", "en.json");
    }

    if (fs.existsSync(localePath)) {
      if (localesCache.has(localePath)) {
        return localesCache.get(localePath);
      }
      try {
        const content = JSON.parse(fs.readFileSync(localePath, "utf8"));
        const keys = Object.keys(content);
        localesCache.set(localePath, keys);
        return keys;
      } catch (e) {
        return [];
      }
    }
    currentDir = path.dirname(currentDir);
  }
  return [];
}

export default [
  {
    ignores: ["**/node_modules/**", "**/dist/**", "**/platforms/**", "**/build/**", ".git/"]
  },
  js.configs.recommended,
  ...pluginVue.configs["flat/recommended"],
  {
    plugins: {
      "@typescript-eslint": typescriptEslint,
    },
    rules: {
      ...typescriptEslint.configs.recommended.rules,
    },
  },
  {
    files: ["**/*.js", "**/*.mjs", "**/*.cjs", "**/*.ts", "**/*.vue"],
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "module",
      globals: {
        ...globals.browser,
        ...globals.node,
        ...globals.es2021,
      },
      parser: vueParser,
      parserOptions: {
        parser: typescriptParser,
        ecmaVersion: "latest",
        sourceType: "module",
        extraFileExtensions: [".vue"],
        ecmaFeatures: {
          jsx: true,
        },
      },
    },
    plugins: {
      "import-x": eslintPluginImport,
      "@stylistic": stylistic,
      "local": {
        rules: {
          "i18n-check-keys": {
            create(context) {
              return {
                CallExpression(node) {
                  if (node.callee.name === "translate") {
                    const firstArg = node.arguments[0];
                    if (firstArg && firstArg.type === "Literal" && typeof firstArg.value === "string") {
                      const key = firstArg.value;
                      const enKeys = getEnKeys(context.filename);
                      if (enKeys.length > 0 && !enKeys.includes(key)) {
                        context.report({
                          node,
                          message: `Translation key "${key}" is missing in en.json`,
                        });
                      }
                    }
                  }
                }
              };
            }
          }
        }
      }
    },
    settings: {
      "import-x/resolver": {
        typescript: true,
        node: {
          extensions: [".js", ".mjs", ".cjs", ".json", ".vue", ".ts"]
        }
      }
    },
    rules: {
      // CRITICAL: Ionic uses the 'slot' attribute for positioning (e.g., slot="start")
      "vue/no-deprecated-slot-attribute": "off",
      "vue/multi-word-component-names": "off",
      "vue/html-indent": ["error", 2],
      "vue/max-attributes-per-line": ["warn", { "singleline": 10, "multiline": 1 }],
      "vue/html-closing-bracket-newline": ["error", { "singleline": "never", "multiline": "always" }],
      "vue/html-quotes": ["error", "double"],
      "@stylistic/quotes": ["error", "double"],
      // "@stylistic/semi": ["error", "never"],
      "@stylistic/indent": ["error", 2],
      "@stylistic/brace-style": ["error", "1tbs", { "allowSingleLine": true }],
      "@stylistic/comma-style": ["error", "last"],
      "@stylistic/object-curly-spacing": ["error", "always"],
      "@stylistic/array-bracket-spacing": ["error", "never"],
      "@stylistic/space-before-blocks": ["error", "always"],
      "@stylistic/space-before-function-paren": ["error", {
        "anonymous": "never",
        "named": "never",
        "asyncArrow": "always"
      }],
      "@stylistic/space-in-parens": ["error", "never"],
      "@stylistic/keyword-spacing": ["error", {
        "before": true, "after": true, "overrides": {
          "if": { "after": false },
          "for": { "after": false },
          "while": { "after": false }
        }
      }],
      "@stylistic/spaced-comment": ["error", "always", { "markers": ["/"] }],
      "@stylistic/eol-last": ["error", "always"],
      "@stylistic/no-trailing-spaces": ["error"],
      "@stylistic/no-multi-spaces": ["error"],
      "@stylistic/operator-linebreak": ["error", "after", { "overrides": { "?": "before", ":": "before" } }],
      "@stylistic/function-paren-newline": ["error", "multiline"],
      // "@stylistic/object-curly-newline": ["error", {
      //   "ObjectExpression": { "multiline": true, "minProperties": 4 },
      //   "ObjectPattern": { "multiline": true, "minProperties": 4 },
      //   "ImportDeclaration": { "multiline": true, "minProperties": 20 },
      //   "ExportDeclaration": { "multiline": true, "minProperties": 4 }
      // }],
      "@stylistic/no-whitespace-before-property": ["error"],
      "@stylistic/padding-line-between-statements": [
        "error",
        { "blankLine": "always", "prev": "*", "next": "return" }
      ],
      "curly": ["error", "all"],
      "no-case-declarations": ["error"],
      "default-case": ["error"],
      "no-unreachable-loop": ["error"],
      "no-unsafe-finally": ["error"],
      "no-useless-return": ["error"],
      "no-return-assign": ["error"],
      "no-self-assign": ["error"],
      "no-global-assign": ["error"],
      "no-unneeded-ternary": ["error", { "defaultAssignment": false }],
      // "no-mixed-operators": ["error", {
      //   "groups": [
      //     ["+", "-", "*", "/", "%", "**"],
      //     ["&", "|", "^", "~", "<<", ">>", ">>>"],
      //     ["==", "!=", "===", "!==", ">", ">=", "<", "<="],
      //     ["&&", "||"],
      //     ["in", "instanceof"]
      //   ],
      //   "allowSamePrecedence": false
      // }],
      "no-floating-decimal": ["error"],
      "require-await": ["error"],
      "no-var": ["error"],
      "prefer-const": ["error"],
      "object-shorthand": ["error", "always"],
      "prefer-object-spread": ["error"],
      "prefer-template": ["error"],
      "dot-notation": ["error"],
      "camelcase": ["error", { "properties": "never", "ignoreDestructuring": false }],
      "func-names": ["error", "as-needed"],
      "prefer-arrow-callback": ["error", { "allowNamedFunctions": false }],
      "no-console": process.env.NODE_ENV === "production" ? "error" : "off",
      "no-debugger": process.env.NODE_ENV === "production" ? "error" : "off",
      "no-alert": ["error"],
      "no-multi-assign": ["error"],
      "sort-imports": ["error", {
        "ignoreCase": false,
        "ignoreDeclarationSort": true,
        "ignoreMemberSort": false,
        "memberSyntaxSortOrder": ["none", "all", "multiple", "single"]
      }],
      "import-x/no-unresolved": ["error", { "commonjs": true, "caseSensitive": true }],
      "import-x/no-duplicates": ["error"],
      // "import-x/no-extraneous-dependencies": ["error", {
      //   "devDependencies": [
      //     "**/test/**", "**/__tests__/**", "**/*.test.*",
      //     "**/scripts/**", "**/webpack.config.*", "**/rollup.config.*"
      //   ],
      //   "optionalDependencies": false,
      //   "peerDependencies": false
      // }],
      "import-x/order": ["error", {
        "groups": ["builtin", "external", "internal", "parent", "sibling", "index"],
        "alphabetize": { "order": "asc", "caseInsensitive": true }
      }],
      "import-x/newline-after-import": ["error", { "count": 1 }],
      "import-x/no-cycle": ["error", { "maxDepth": 1 }],
      "import-x/no-self-import": ["error"],
      "import-x/no-useless-path-segments": ["error", { "noUselessIndex": true }],
      "@typescript-eslint/no-explicit-any": "off",
      "local/i18n-check-keys": "error",
    }
  },
  {
    files: ["**/*.vue"],
    rules: {
      "no-restricted-imports": VUE_NO_API_IMPORTS,
      "no-restricted-syntax": syntax(VUE_NO_API_SYNTAX)
    }
  },
  {
    files: ["**/composables/*.ts"],
    rules: {
      "no-restricted-syntax": syntax(COMPOSABLE_NAME_SYNTAX)
    }
  },
  {
    files: ["**/store/*.ts"],
    rules: {
      "no-restricted-syntax": syntax(STORE_NAME_SYNTAX)
    }
  },
  ...dataAccessBlocks({ vue: VUE_NO_API_SYNTAX, composables: COMPOSABLE_NAME_SYNTAX, store: STORE_NAME_SYNTAX })
];
