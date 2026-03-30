# ESLint Rules Documentation

This guide provides an overview of the ESLint rules configured for this project, along with examples for each rule.

## Table of Contents
1. [Vue Rules](#vue-rules)
2. [Stylistic Rules](#stylistic-rules)
3. [ESLint Core Rules](#eslint-core-rules)
4. [TypeScript Rules](#typescript-eslint-rules)
5. [Import Rules](#import-rules)

---

## Vue Rules <a name="vue-rules"></a>

### `vue/no-deprecated-slot-attribute`
- **Configuration**: `"off"`
- **Description**: Disallows the use of the deprecated `slot` attribute.
- **Why it's off**: Ionic uses the `slot` attribute for positioning (e.g., `slot="start"`), so this rule is disabled to allow its usage.

**Correct:**
```html
<ion-button slot="start">Click me</ion-button>
```

---

### `vue/multi-word-component-names`
- **Configuration**: `"off"`
- **Description**: Requires component names to be always multi-word.
- **Why it's off**: Some components in this project may use single-word names for simplicity or compatibility reasons.

**Incorrect:**
```javascript
// If this rule were 'error'
export default {
  name: 'Login' // Should be 'AppLogin'
}
```

**Correct:**
```javascript
export default {
  name: 'Login'
}
```

---

### `vue/html-indent`
- **Configuration**: `["error", 2]`
- **Description**: Enforces a consistent indentation of 2 spaces in `<template>`.

**Incorrect:**
```html
<template>
    <div>
      <p>Indented with 4 spaces</p>
    </div>
</template>
```

**Correct:**
```html
<template>
  <div>
    <p>Indented with 2 spaces</p>
  </div>
</template>
```

---

### `vue/max-attributes-per-line`
- **Configuration**: `["warn", { "singleline": 10, "multiline": 1 }]`
- **Description**: Enforces a maximum number of attributes per line in `<template>`. 

**Incorrect:**
```html
<!-- Multiline with multiple attributes on one line -->
<img 
  src="..." alt="..." 
  title="..."
/>
```

**Correct:**
```html
<!-- Single line up to 10 attributes -->
<img src="..." alt="..." title="..." />

<!-- Multiline with 1 attribute per line -->
<img
  src="..."
  alt="..."
  title="..."
/>
```

---

### `vue/html-closing-bracket-newline`
- **Configuration**: `["error", { "singleline": "never", "multiline": "always" }]`
- **Description**: Requires a line break before the closing bracket of a tag in multi-line elements, but disallows it for single-line elements.

**Incorrect:**
```html
<!-- Single line with newline -->
<div
></div>

<!-- Multiline without newline -->
<div
  class="my-class"
  id="my-id"></div>
```

**Correct:**
```html
<!-- Single line -->
<div></div>

<!-- Multiline -->
<div
  class="my-class"
  id="my-id"
></div>
```

---

## Stylistic Rules <a name="stylistic-rules"></a>

### `@stylistic/quotes`
- **Configuration**: `["error", "double"]`
- **Description**: Enforces the use of double quotes.

**Incorrect:**
```javascript
const message = 'Hello World';
```

**Correct:**
```javascript
const message = "Hello World";
```

---

### `@stylistic/indent`
- **Configuration**: `["error", 2]`
- **Description**: Enforces a consistent indentation of 2 spaces.

**Incorrect:**
```javascript
function foo() {
    console.log("Too much indent");
}
```

**Correct:**
```javascript
function foo() {
  console.log("2 space indent");
}
```

---

### `@stylistic/brace-style`
- **Configuration**: `["error", "1tbs", { "allowSingleLine": true }]`
- **Description**: Enforces the "one true brace style" where the opening brace of a block is placed on the same line as its corresponding statement or declaration.

**Incorrect:**
```javascript
if (foo)
{
  bar();
}
```

**Correct:**
```javascript
if (foo) {
  bar();
}

// Single line is allowed
if (foo) { bar(); }
```

---

### `@stylistic/comma-style`
- **Configuration**: `["error", "last"]`
- **Description**: Enforces that commas are placed at the end of the line.

**Incorrect:**
```javascript
const obj = {
  a: 1
  , b: 2
};
```

**Correct:**
```javascript
const obj = {
  a: 1,
  b: 2
};
```

---

### `@stylistic/object-curly-spacing`
- **Configuration**: `["error", "always"]`
- **Description**: Enforces consistent spacing inside of curly braces.

**Incorrect:**
```javascript
const obj = {foo: "bar"};
```

**Correct:**
```javascript
const obj = { foo: "bar" };
```

---

### `@stylistic/array-bracket-spacing`
- **Configuration**: `["error", "never"]`
- **Description**: Disallows spaces inside of array brackets.

**Incorrect:**
```javascript
const arr = [ 1, 2 ];
```

**Correct:**
```javascript
const arr = [1, 2];
```

---

### `@stylistic/space-before-blocks`
- **Configuration**: `["error", "always"]`
- **Description**: Requires a space before blocks.

**Incorrect:**
```javascript
if (foo){
  bar();
}
```

**Correct:**
```javascript
if (foo) {
  bar();
}
```

---

### `@stylistic/space-before-function-paren`
- **Configuration**: `["error", { "anonymous": "never", "named": "never", "asyncArrow": "always" }]`
- **Description**: Enforces spacing before parentheses in function definitions.

**Incorrect:**
```javascript
function named () {}
const anon = function () {}
const asyncArrow = async() => {}
```

**Correct:**
```javascript
function named() {}
const anon = function() {}
const asyncArrow = async () => {}
```

---

### `@stylistic/space-in-parens`
- **Configuration**: `["error", "never"]`
- **Description**: Disallows spaces inside of parentheses.

**Incorrect:**
```javascript
foo( bar );
```

**Correct:**
```javascript
foo(bar);
```

---

### `@stylistic/keyword-spacing`
- **Configuration**: `["error", { "before": true, "after": true, "overrides": { "if": { "after": false }, "for": { "after": false }, "while": { "after": false } } }]`
- **Description**: Enforces spacing before and after keywords.

**Incorrect:**
```javascript
if(foo) {}
else{ bar(); }
```

**Correct:**
```javascript
if(foo) {}
else { bar(); }
```

---

### `@stylistic/spaced-comment`
- **Configuration**: `["error", "always", { "markers": ["/"] }]`
- **Description**: Enforces a space after `//` or `/*`.

**Incorrect:**
```javascript
//comment
/*comment*/
```

**Correct:**
```javascript
// comment
/* comment */
```

---

### `@stylistic/eol-last`
- **Configuration**: `["error", "always"]`
- **Description**: Enforces a newline at the end of every file.

---

### `@stylistic/no-trailing-spaces`
- **Configuration**: `["error"]`
- **Description**: Disallows spaces at the end of lines.

---

### `@stylistic/no-multi-spaces`
- **Configuration**: `["error"]`
- **Description**: Disallows multiple spaces between tokens.

**Incorrect:**
```javascript
const  x  =  1;
```

**Correct:**
```javascript
const x = 1;
```

---

### `@stylistic/operator-linebreak`
- **Configuration**: `["error", "after", { "overrides": { "?": "before", ":": "before" } }]`
- **Description**: Enforces breaks after operators, except for ternary operators.

---

### `@stylistic/function-paren-newline`
- **Configuration**: `["error", "multiline"]`
- **Description**: Enforces line breaks inside function parentheses if the arguments occupy multiple lines.

---

### `@stylistic/no-whitespace-before-property`
- **Configuration**: `["error"]`
- **Description**: Disallows whitespace before properties.

**Incorrect:**
```javascript
foo .bar
```

**Correct:**
```javascript
foo.bar
```

---

### `@stylistic/padding-line-between-statements`
- **Configuration**: `["error", { "blankLine": "always", "prev": "*", "next": "return" }]`
- **Description**: Requires a blank line before `return` statements.

**Incorrect:**
```javascript
function foo() {
  const x = 1;
  return x;
}
```

**Correct:**
```javascript
function foo() {
  const x = 1;

  return x;
}
```

---

## ESLint Core Rules <a name="eslint-core-rules"></a>

### `curly`
- **Configuration**: `["error", "all"]`
- **Description**: Requires curly braces for all control statements.

**Incorrect:**
```javascript
if (foo) bar();
```

**Correct:**
```javascript
if (foo) {
  bar();
}
```

---

### `no-case-declarations`
- **Configuration**: `["error"]`
- **Description**: Disallows lexical declarations (`let`, `const`, `function`, `class`) in case clauses.
- **Why**: Lexical declarations are visible in the entire switch block, but only initialized when the specific case is reached. This can lead to unexpected errors if another case tries to access the uninitialized variable.

**Incorrect:**
```javascript
switch (foo) {
  case 1:
    let x = 1; // 'x' is hoisted to the top of the switch block but not initialized
    break;
  case 2:
    console.log(x); // Potential ReferenceError or unexpected behavior
    break;
}
```

**Correct:**
```javascript
switch (foo) {
  case 1: { 
    // Braces create a block scope, keeping 'x' local to this case
    let x = 1;
    break;
  }
  case 2:
    // 'x' is not accessible here, avoiding conflicts
    break;
}
```

---

### `default-case`
- **Configuration**: `["error"]`
- **Description**: Requires a `default` case in `switch` statements.

---

### `no-unreachable-loop`
- **Configuration**: `["error"]`
- **Description**: Disallows loops with a body that allows only one iteration.

---

### `no-unsafe-finally`
- **Configuration**: `["error"]`
- **Description**: Disallows control flow statements in `finally` blocks.

---

### `no-useless-return`
- **Configuration**: `["error"]`
- **Description**: Disallows redundant return statements.

---

### `no-return-assign`
- **Configuration**: `["error"]`
- **Description**: Disallows assignment operators in `return` statements.

---

### `no-self-assign`
- **Configuration**: `["error"]`
- **Description**: Disallows assignments where both sides are exactly the same.

---

### `no-global-assign`
- **Configuration**: `["error"]`
- **Description**: Disallows assignments to native objects or read-only global variables.

---

### `no-unneeded-ternary`
- **Configuration**: `["error", { "defaultAssignment": false }]`
- **Description**: Disallows ternary operators when simpler alternatives exist.

**Incorrect:**
```javascript
const x = a ? a : b;
```

**Correct:**
```javascript
const x = a || b;
```

---

### `no-floating-decimal`
- **Configuration**: `["error"]`
- **Description**: Disallows leading or trailing decimal points in numeric literals.

**Incorrect:**
```javascript
const x = .5;
const y = 2.;
```

**Correct:**
```javascript
const x = 0.5;
const y = 2.0;
```

---

### `require-await`
- **Configuration**: `["error"]`
- **Description**: Disallows `async` functions which have no `await` expression.

---

### `no-var`
- **Configuration**: `["error"]`
- **Description**: Requires `let` or `const` instead of `var`.

---

### `prefer-const`
- **Configuration**: `["error"]`
- **Description**: Requires `const` declarations for variables that are never reassigned.

---

### `object-shorthand`
- **Configuration**: `["error", "always"]`
- **Description**: Enforces using shorthand syntax for properties and methods.

**Incorrect:**
```javascript
const bar = {
  foo: foo,
  baz: function() {}
};
```

**Correct:**
```javascript
const bar = {
  foo,
  baz() {}
};
```

---

### `prefer-object-spread`
- **Configuration**: `["error"]`
- **Description**: Enforces the use of object spread instead of `Object.assign`.

---

### `prefer-template`
- **Configuration**: `["error"]`
- **Description**: Enforces the use of template literals instead of string concatenation.

**Incorrect:**
```javascript
const str = "Hello " + name;
```

**Correct:**
```javascript
const str = `Hello ${name}`;
```

---

### `dot-notation`
- **Configuration**: `["error"]`
- **Description**: Enforce dot notation whenever possible.

**Incorrect:**
```javascript
const name = user["name"];
```

**Correct:**
```javascript
const name = user.name;
```

---

### `camelcase`
- **Configuration**: `["error", { "properties": "never", "ignoreDestructuring": false }]`
- **Description**: Enforce camelcase naming convention.

---

### `func-names`
- **Configuration**: `["error", "as-needed"]`
- **Description**: Requires function expressions to have names if they are not clear from context.

---

### `prefer-arrow-callback`
- **Configuration**: `["error", { "allowNamedFunctions": false }]`
- **Description**: Requires arrow functions for callbacks.

---

### `no-console`
- **Configuration**: `process.env.NODE_ENV === "production" ? "error" : "off"`
- **Description**: Disallows the use of `console`.
- **Why**: Console statements are great for debugging but should be removed from production code to keep the console clean and avoid exposing internal data.

**Incorrect (in production):**
```javascript
function login(user) {
  console.log("Logging in user:", user); // Error in production
}
```

**Correct:**
```javascript
function login(user) {
  // Use a proper logging library or remove console before production
}
```

---

### `no-debugger`
- **Configuration**: `process.env.NODE_ENV === "production" ? "error" : "off"`
- **Description**: Disallows the use of `debugger`.
- **Why**: Use of `debugger` in production code can cause the browser to stop execution, leading to a poor user experience.

**Incorrect (in production):**
```javascript
function troubleshoot() {
  debugger; // Error in production
}
```

**Correct:**
```javascript
function troubleshoot() {
  // Use breakpoints in your IDE or browser devtools during development
}
```

---

### `no-alert`
- **Configuration**: `["error"]`
- **Description**: Disallows the use of `alert`, `confirm`, and `prompt`.
- **Why**: These native UI elements are intrusive and non-customizable. Use modern UI components (like Ionic alerts) instead.

**Incorrect:**
```javascript
alert("Please enter a valid email.");
```

**Correct:**
```javascript
// Example using a hypothetical custom alert service
alertService.show("Please enter a valid email.");
```

---

### `no-multi-assign`
- **Configuration**: `["error"]`
- **Description**: Disallows chained assignment expressions.
- **Why**: Chained assignments can be difficult to read and may cause confusion about variable scope.

**Incorrect:**
```javascript
const a = b = c = 1;
```

**Correct:**
```javascript
const a = 1;
const b = 1;
const c = 1;
```

---

### `sort-imports`
- **Configuration**: `["error", { "ignoreCase": false, "ignoreDeclarationSort": true, "ignoreMemberSort": false, "memberSyntaxSortOrder": ["none", "all", "multiple", "single"] }]`
- **Description**: Enforces alphabetical sorting of members in import statements.
- **Why**: Keeps imports predictable and easier to scan.

**Incorrect:**
```javascript
import { b, a } from 'module';
```

**Correct:**
```javascript
import { a, b } from 'module';
```

---

## TypeScript Rules <a name="typescript-eslint-rules"></a>

### `@typescript-eslint/no-explicit-any`
- **Configuration**: `"off"`
- **Description**: Disallows the `any` type.
- **Why it's off**: Allowed where necessary in this project to avoid overly complex type definitions for dynamic data.

---

## Import Rules <a name="import-rules"></a>

### `import/no-unresolved`
- **Configuration**: `["error", { "commonjs": true, "caseSensitive": true }]`
- **Description**: Ensures an imported module can be resolved to a module on the local filesystem.
- **Why**: Catches typos in filenames or incorrect paths early.

**Incorrect:**
```javascript
import { something } from './misspeled-file';
```

**Correct:**
```javascript
import { something } from './correct-file';
```

---

### `import/no-duplicates`
- **Configuration**: `["error"]`
- **Description**: Reports duplicate imports from the same module.
- **Why**: Keeps the import section clean and avoids redundant declarations.

**Incorrect:**
```javascript
import { a } from 'module';
import { b } from 'module';
```

**Correct:**
```javascript
import { a, b } from 'module';
```

---

### `import/order`
- **Configuration**: `["error", { "groups": ["builtin", "external", "internal", "parent", "sibling", "index"], "alphabetize": { "order": "asc", "caseInsensitive": true } }]`
- **Description**: Enforces a consistent order for import statements.
- **Why**: Organizes imports into logical groups (e.g., node built-ins first, then external libraries).

**Incorrect:**
```javascript
import { siblingFunc } from './sibling';
import fs from 'fs'; // Node built-ins should come first
```

**Correct:**
```javascript
import fs from 'fs';
import { siblingFunc } from './sibling';
```

---

### `import/newline-after-import`
- **Configuration**: `["error", { "count": 1 }]`
- **Description**: Enforces one or more blank lines after the last top-level import statement or require call.
- **Why**: Visually separates the import section from the rest of the code.

**Incorrect:**
```javascript
import { foo } from 'bar';
const x = 1;
```

**Correct:**
```javascript
import { foo } from 'bar';

const x = 1;
```

---

### `import/no-cycle`
- **Configuration**: `["error", { "maxDepth": 1 }]`
- **Description**: Forbids a module from importing itself or a module that imports it.
- **Why**: Circular dependencies can lead to runtime errors and make code harder to maintain.

---

### `import/no-self-import`
- **Configuration**: `["error"]`
- **Description**: Forbids a module from importing itself.
- **Why**: Self-imports are redundant and logic-breaking.

---

### `import/no-useless-path-segments`
- **Configuration**: `["error", { "noUselessIndex": true }]`
- **Description**: Forbids unnecessary path segments in import and require statements.
- **Why**: Keeps imports concise.

**Incorrect:**
```javascript
import { something } from './utils/index';
```

**Correct:**
```javascript
import { something } from './utils';
```
