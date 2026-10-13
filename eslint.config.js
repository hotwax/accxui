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
 * Data access: app code reaches the app database (IndexedDB) only through two patterns,
 *   - rows live on screen:       useLiveEntity(appDb.tables.x, options)  (components, views, composables)
 *   - an answer now, or a write: appDb.entity(appDb.tables.x)            (anywhere)
 * with table names always from `appDb.tables`. An "app db" is any identifier ending in `Db`
 * (`appDb`, `companyDb`, …). See docs/APP_DB_DEVELOPER_GUIDE.md §7.
 *
 * Built from core rules only. Because flat config replaces `no-restricted-syntax` per file rather
 * than merging it, the folder-specific selector lists are composed below and the data-access blocks
 * at the end restate the existing per-folder selectors they would otherwise override.
 */
const DATA_ACCESS_GUIDE = " See docs/APP_DB_DEVELOPER_GUIDE.md §7.";
const APP_DB = "/^[A-Za-z_$][\\w$]*Db$/";
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
      message: "Do not use Dexie in app code. Read with useLiveEntity(appDb.tables.x) on screen, or appDb.entity(appDb.tables.x) for one-shot reads and writes." + DATA_ACCESS_GUIDE,
    },
    ...["@common/db/storage/dbClient", "@common/db/storage/baseDb", "@common/db/schema/appDbRegistry"].map((name) => ({
      name,
      allowTypeImports: true,
      message: "This is the framework layer beneath the app database. Import its types only; read and write through appDb.entity(...) / useLiveEntity." + DATA_ACCESS_GUIDE,
    })),
    ...["@common", "@common/db"].map((name) => ({
      name,
      importNames: LOW_LEVEL_EXPORTS,
      allowTypeImports: true,
      message: "Framework-internal. Read and write through appDb.entity(appDb.tables.x) / useLiveEntity(appDb.tables.x)." + DATA_ACCESS_GUIDE,
    })),
  ],
}];

/** Everywhere in app source. */
const DA_EVERYWHERE = [
  {
    selector: `CallExpression[callee.object.name=${APP_DB}][callee.property.name='raw']`,
    message: "There is no raw Dexie handle on an app database. Use appDb.entity(appDb.tables.x) or useLiveEntity(appDb.tables.x)." + DATA_ACCESS_GUIDE,
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
    selector: `CallExpression[callee.object.callee.object.name=${APP_DB}][callee.object.callee.property.name='client'][callee.property.name=/^(liveRead|read|transaction)$/] > ArrayExpression > ${STRING}`,
    message: "Name the tables through appDb.tables: appDb.client().liveRead([appDb.tables.x, …], …). A typo there fails to compile." + DATA_ACCESS_GUIDE,
  },
];

/** Outside `src/db/**` and the worker entry. */
const DA_NO_GET = [{
  selector: `CallExpression[callee.object.name=${APP_DB}][callee.property.name='get']`,
  message: "appDb.get(oms) hands out the database handle and is for the worker entry only. Use appDb.entity(appDb.tables.x)." + DATA_ACCESS_GUIDE,
}];

/** Outside `src/workers/**` and `src/db/**`, except as the useDbStatus source. */
const DA_NO_CLIENT = [{
  selector: `CallExpression[callee.object.name=${APP_DB}][callee.property.name='client']:not(CallExpression[callee.name='useDbStatus'] > CallExpression.arguments:first-child)`,
  message: "appDb.client() is for worker sync domains and the useDbStatus argument only. Use appDb.entity(appDb.tables.x) (one-shot) or useLiveEntity(appDb.tables.x) (live)." + DATA_ACCESS_GUIDE,
}];

/** Outside Vue setup code (.vue files, src/components, src/views, src/composables). */
const DA_NO_LIVE_ENTITY = [{
  selector: "CallExpression[callee.name='useLiveEntity']",
  message: "useLiveEntity is a Vue composable and only works during setup (components, views, composables). Here use appDb.entity(appDb.tables.x) for a one-shot read." + DATA_ACCESS_GUIDE,
}];

/** The existing per-folder selectors, shared with the data-access blocks that restate them. */
const VUE_NO_API_SYNTAX = [
  {
    "selector": "CallExpression[callee.name='api']",
    "message": "Calling 'api' directly in vue files is not allowed. Use services or composables for API calls."
  },
  {
    "selector": "CallExpression[callee.name='client']",
    "message": "Calling 'client' directly in vue files is not allowed. Use services or composables for API calls."
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

const syntax = (...lists) => ["error", ...lists.flat()];

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
      "no-restricted-imports": ["error", {
        "paths": [{
          "name": "@common",
          "importNames": ["api", "client"],
          "message": "Direct import of 'api' or 'client' is not allowed in vue files. Please use services or composables instead."
        }]
      }],
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
  /**
   * Data access (see the constants at the top). App source is `src/**` of the app being linted, so
   * the patterns hold whether ESLint runs from the repo root or from an app that spreads this config.
   * Later blocks win for `no-restricted-syntax`, so the general block comes first and each narrower
   * folder restates the full list it needs. An app exempts its own non-app-db Dexie store in its
   * eslint.config.js.
   */
  {
    files: ["**/src/**/*.ts", "**/src/**/*.vue"],
    rules: {
      "@typescript-eslint/no-restricted-imports": DATA_ACCESS_IMPORTS,
      "no-restricted-syntax": syntax(DA_EVERYWHERE, DA_NO_GET, DA_NO_CLIENT, DA_NO_LIVE_ENTITY),
    }
  },
  {
    files: ["**/src/components/**/*.ts", "**/src/views/**/*.ts", "**/src/composables/**/*.ts"],
    rules: { "no-restricted-syntax": syntax(DA_EVERYWHERE, DA_NO_GET, DA_NO_CLIENT) }
  },
  {
    files: ["**/src/**/*.vue"],
    rules: { "no-restricted-syntax": syntax(VUE_NO_API_SYNTAX, DA_EVERYWHERE, DA_NO_GET, DA_NO_CLIENT) }
  },
  {
    files: ["**/src/**/composables/*.ts"],
    rules: { "no-restricted-syntax": syntax(COMPOSABLE_NAME_SYNTAX, DA_EVERYWHERE, DA_NO_GET, DA_NO_CLIENT) }
  },
  {
    files: ["**/src/store/*.ts"],
    rules: { "no-restricted-syntax": syntax(STORE_NAME_SYNTAX, DA_EVERYWHERE, DA_NO_GET, DA_NO_CLIENT, DA_NO_LIVE_ENTITY) }
  },
  {
    files: ["**/src/db/**/*.ts"],
    rules: { "no-restricted-syntax": syntax(DA_EVERYWHERE, DA_NO_LIVE_ENTITY) }
  },
  {
    files: ["**/src/workers/**/*.ts"],
    rules: { "no-restricted-syntax": syntax(DA_EVERYWHERE, DA_NO_GET, DA_NO_LIVE_ENTITY) }
  },
  {
    files: ["**/src/workers/*.worker.ts"],
    rules: { "no-restricted-syntax": syntax(DA_EVERYWHERE, DA_NO_LIVE_ENTITY) }
  }
];
