import { createRequire } from "module";
import path from "path";
import { fileURLToPath } from "url";
import { loadEnv, type Plugin } from "vite";

const ACCXUI_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

// App .env files copied from older .env.example files have placeholders like `VITE_ALIAS=` or
// `VITE_ALIAS={}`; those mean "not configured", so they must not hide the root value.
const isUnset = (value?: string) => value === undefined || value.trim() === "" || value.trim() === "{}";

// luxon's ES build, resolved from the app the way the app's own `import "luxon"` resolves it.
// cron-parser (used by commonUtil) is CommonJS only, so its `require("luxon")` picks luxon's Node
// build and a production bundle ends up with two copies of luxon. Pointing bare `luxon` at the ES
// build makes both resolve to one copy.
const luxonEsBuild = (appRoot: string) => {
  try {
    const luxonPackage = createRequire(path.join(appRoot, "package.json")).resolve("luxon/package.json");
    return path.join(path.dirname(luxonPackage), "build/es6/luxon.mjs");
  } catch {
    return undefined; // the app doesn't use luxon
  }
};

// Every app adds this plugin, so it is also where framework-wide build settings live:
// - `vite` (serve): shares every VITE_ variable in the accxui root env (.env / .env.local next to
//   accxui's package.json) with the app being served, so settings like the dev login are configured
//   once instead of in each app's .env. An app's own non-empty value, or one already set in the
//   shell, always wins. Nothing of this runs on `vite build`, so root dev credentials never reach
//   a release bundle.
// - `vite build`: resolves bare `luxon` to one copy (see luxonEsBuild).
export const commonEnvPlugin = (): Plugin => ({
  name: "accxui-common-env",
  config(config, { command, mode }) {
    const appRoot = path.resolve(config.root || process.cwd());

    if (command === "build") {
      const luxon = luxonEsBuild(appRoot);
      return luxon ? { resolve: { alias: [{ find: /^luxon$/, replacement: luxon }] } } : undefined;
    }

    if (command !== "serve") return;

    const appEnv = loadEnv(mode, path.resolve(appRoot, config.envDir || ""), "");
    // Only VITE_ keys: an empty prefix would also return all of process.env (PATH, HOME, ...).
    const rootEnv = loadEnv(mode, ACCXUI_ROOT, "VITE_");

    // Vite loads .env files after the config hook, and values already in process.env take
    // precedence over them, so setting them here is what makes them reach import.meta.env.
    for (const [key, value] of Object.entries(rootEnv)) {
      if (isUnset(appEnv[key]) && !isUnset(value)) {
        process.env[key] = value;
      }
    }
  }
});
