import js from "@eslint/js";
import pluginVue from "eslint-plugin-vue";
import vueParser from "vue-eslint-parser";
import * as espree from "espree";
import eslintPluginImport from "eslint-plugin-import";
import stylistic from "@stylistic/eslint-plugin";
import typescriptEslint from "@typescript-eslint/eslint-plugin";
import typescriptParser from "@typescript-eslint/parser";
import globals from "globals";

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
      import: eslintPluginImport,
      "@stylistic": stylistic,
    },
    settings: {
      "import/resolver": {
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
      "@stylistic/keyword-spacing": ["error", { "before": true, "after": true, "overrides": {
        "if": { "after": false },
        "for": { "after": false },
        "while": { "after": false }
      } }],
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
      "import/no-unresolved": ["error", { "commonjs": true, "caseSensitive": true }],
      "import/no-duplicates": ["error"],
      // "import/no-extraneous-dependencies": ["error", {
      //   "devDependencies": [
      //     "**/test/**", "**/__tests__/**", "**/*.test.*",
      //     "**/scripts/**", "**/webpack.config.*", "**/rollup.config.*"
      //   ],
      //   "optionalDependencies": false,
      //   "peerDependencies": false
      // }],
      "import/order": ["error", {
        "groups": ["builtin", "external", "internal", "parent", "sibling", "index"],
        "alphabetize": { "order": "asc", "caseInsensitive": true }
      }],
      "import/newline-after-import": ["error", { "count": 1 }],
      "import/no-cycle": ["error", { "maxDepth": 1 }],
      "import/no-self-import": ["error"],
      "import/no-useless-path-segments": ["error", { "noUselessIndex": true }],
      "@typescript-eslint/no-explicit-any": "off",
    }
  }
];