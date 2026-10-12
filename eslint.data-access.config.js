/**
 * Data-access rules only — the gate each app's build runs (`pnpm lint:data-access`).
 *
 * Kept apart from `eslint.config.js` so the repo's existing lint backlog cannot fail a build; the
 * main config loads the same plugin, so editors show these errors as you type. Add further
 * data-access rules to `eslint/plugins/data-access.js`.
 */
import vueParser from "vue-eslint-parser";
import typescriptParser from "@typescript-eslint/parser";
import dataAccess, { DATA_ACCESS_EXEMPT, DATA_ACCESS_FILES, dataAccessRules } from "./eslint/plugins/data-access.js";

export default [
  {
    files: DATA_ACCESS_FILES,
    ignores: DATA_ACCESS_EXEMPT,
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
    plugins: { "data-access": dataAccess },
    linterOptions: { reportUnusedDisableDirectives: "off" },
    rules: dataAccessRules,
  },
];
