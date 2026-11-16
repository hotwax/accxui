import path from "path";
import { fileURLToPath } from "url";
import { loadEnv, type Plugin } from "vite";

const ACCXUI_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

// App .env files copied from older .env.example files have placeholders like `VITE_ALIAS=` or
// `VITE_ALIAS={}`; those mean "not configured", so they must not hide the root value.
const isUnset = (value?: string) => value === undefined || value.trim() === "" || value.trim() === "{}";

// Shares every VITE_ variable in the accxui root env (.env / .env.local next to accxui's
// package.json) with the app `vite` is serving, so settings like the dev login are configured
// once instead of in each app's .env. An app's own non-empty value, or one already set in the
// shell, always wins. It does nothing on `vite build`, so root dev credentials never reach a
// release bundle.
export const commonEnvPlugin = (): Plugin => ({
  name: "accxui-common-env",
  config(config, { command, mode }) {
    if (command !== "serve") return;

    const appRoot = path.resolve(config.root || process.cwd());
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
