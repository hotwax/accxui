import fs from "fs";
import path from "path";
import { loadEnv, type Plugin } from "vite";

/**
 * Shares the workspace-level dev credential list with every app, so adding an
 * app needs no credential setup of its own.
 *
 * Vite only reads env files from the app's own root, and `envDir` cannot be
 * used to point several apps at one file because it replaces that directory
 * rather than adding to it — every per-app key (VITE_APP_VERSION_CONFIG,
 * VITE_ALIAS, the dev server port) would stop loading. So the workspace file is
 * read separately here and merged in, leaving each app's own env untouched.
 *
 * `apply: "serve"` keeps this to the dev server: no build of any mode receives
 * the shared list, so a release build has no shared credential to inline.
 */
const SHARED_DEV_KEYS = ["VITE_DEV_CREDENTIALS"] as const;

/** Walks up from the app to the directory holding pnpm-workspace.yaml. */
const findWorkspaceRoot = (from: string): string | null => {
  let dir = path.resolve(from);

  for (let depth = 0; depth < 8; depth += 1) {
    if (fs.existsSync(path.join(dir, "pnpm-workspace.yaml"))) return dir;

    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }

  return null;
};

const buildDefine = (mode: string, appDir: string): Record<string, string> => {
  const workspaceRoot = findWorkspaceRoot(appDir);
  if (!workspaceRoot) {
    console.warn(`[accxui] no pnpm-workspace.yaml above ${appDir}; shared dev credentials were not loaded.`);
    return {};
  }
  if (workspaceRoot === path.resolve(appDir)) return {};

  const rootEnv = loadEnv(mode, workspaceRoot, "");
  const appEnv = loadEnv(mode, appDir, "");

  const define: Record<string, string> = {};
  for (const key of SHARED_DEV_KEYS) {
    // Vite already inlines a key the app's own env sets, and the app is meant
    // to win, so only a key the app leaves unset is taken from the workspace.
    if (appEnv[key] || !rootEnv[key]) continue;
    define[`import.meta.env.${key}`] = JSON.stringify(rootEnv[key]);
  }

  return define;
};

/** Add to an app's `plugins` array. Reads the app root from Vite's own config. */
export const sharedDevEnvPlugin = (): Plugin => ({
  name: "accxui-shared-dev-env",
  apply: "serve",
  config(config, { mode }) {
    if (mode === "production") return null;

    const define = buildDefine(mode, config.root ? path.resolve(config.root) : process.cwd());
    return Object.keys(define).length ? { define } : null;
  }
});
