/**
 * Dev-only credential resolution shared by every AccxUI app.
 *
 * Credentials live in one workspace-level list that maps each dev server to its
 * own pair, so a single pair is no longer sent to every server in VITE_ALIAS.
 * An entry is matched by its VITE_ALIAS label first and then by its normalized
 * URL, so an app may point VITE_DEFAULT_ALIAS at either form.
 *
 *   VITE_DEV_CREDENTIALS='{"local":{"username":"…","password":"…"}}'
 *
 * Precedence, highest first:
 *   1. the VITE_DEV_CREDENTIALS entry for the selected OMS
 *   2. VITE_DEV_USERNAME / VITE_DEV_PASSWORD
 *   3. VITE_USERNAME / VITE_PASSWORD
 *
 * Levels 2 and 3 are a single flat pair with no server of its own, so they are
 * still offered to whichever server is selected. They remain only so an app
 * configured before the shared list keeps working; an app that talks to more
 * than one server should give each server its own VITE_DEV_CREDENTIALS entry.
 *
 * Everything here is dev-only. Callers gate on import.meta.env.DEV, and the
 * shared list is injected only for non-production modes, so a release build
 * carries no credential to inline.
 */

export interface DevCredential {
  username: string;
  password: string;
}

/**
 * The env the resolver reads. Defaults to import.meta.env; tests pass one in,
 * because Vite inlines import.meta.env at transform time and it cannot be
 * stubbed at runtime.
 */
export type DevEnv = Record<string, any>;

const defaultEnv = (): DevEnv => ((import.meta as any).env ?? {});

const readEnv = (env: DevEnv, key: string): string => {
  const value = env[key];
  return typeof value === "string" ? value : "";
};

export const normalizeOmsUrl = (url: string) => url.trim().toLowerCase().replace(/\/+$/, "");

const parseJsonEnv = (env: DevEnv, key: string): Record<string, any> => {
  const raw = readEnv(env, key);
  if (!raw) return {};

  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    console.warn(`[dev] ${key} is not valid JSON and was ignored.`);
    return {};
  }
};

const getAlias = (env: DevEnv) => parseJsonEnv(env, "VITE_ALIAS");

/** Resolves an alias label to its URL, and leaves a URL untouched. */
const resolveOms = (oms: string, alias: Record<string, any>) => {
  const key = oms.trim().toLowerCase();
  return typeof alias[key] === "string" ? alias[key] : oms;
};

const toCredential = (value: any): DevCredential | null => {
  if (!value || typeof value !== "object") return null;

  const username = typeof value.username === "string" ? value.username : "";
  const password = typeof value.password === "string" ? value.password : "";
  return username && password ? { username, password } : null;
};

/** The pre-shared-list pair, which has no server of its own. */
const getFallbackCredential = (env: DevEnv): DevCredential | null => {
  const username = readEnv(env, "VITE_DEV_USERNAME") || readEnv(env, "VITE_USERNAME");
  const password = readEnv(env, "VITE_DEV_PASSWORD") || readEnv(env, "VITE_PASSWORD");
  return username && password ? { username, password } : null;
};

/**
 * The credentials configured for one specific server, or null when that server
 * has none. `oms` may be an alias label or a URL.
 */
export const getDevCredentialsFor = (oms: string, env: DevEnv = defaultEnv()): DevCredential | null => {
  const configured = parseJsonEnv(env, "VITE_DEV_CREDENTIALS");
  const target = (oms || "").trim();

  if (target) {
    const alias = getAlias(env);

    // Label first: VITE_DEV_CREDENTIALS keys are normally VITE_ALIAS labels.
    const byLabel = toCredential(configured[target] ?? configured[target.toLowerCase()]);
    if (byLabel) return byLabel;

    // Then by URL. Either side may be written as a label or as a URL, so both
    // are resolved through VITE_ALIAS before they are compared.
    const targetUrl = normalizeOmsUrl(resolveOms(target, alias));
    for (const [key, value] of Object.entries(configured)) {
      if (normalizeOmsUrl(resolveOms(key, alias)) !== targetUrl) continue;

      const match = toCredential(value);
      if (match) return match;
    }
  }

  return getFallbackCredential(env);
};

/** Whether one specific server can be signed into without retyping anything. */
export const hasDevCredentialsFor = (oms: string, env: DevEnv = defaultEnv()): boolean => {
  return Boolean(env.DEV && getDevCredentialsFor(oms, env));
};

/** Whether any dev credential is configured at all, for any server. */
export const hasAnyDevCredentials = (env: DevEnv = defaultEnv()): boolean => {
  if (!env.DEV) return false;
  if (getFallbackCredential(env)) return true;

  return Object.values(parseJsonEnv(env, "VITE_DEV_CREDENTIALS")).some((value) => toCredential(value));
};
