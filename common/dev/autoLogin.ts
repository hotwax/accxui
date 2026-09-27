/**
 * Dev-only auto-login that runs at mount, before the login page is ever shown.
 *
 * Login.vue offers a one-click dev user once you are on the login page; this
 * signs in during boot instead, so a dev reload lands straight on the app. It
 * is shared by every AccxUI app, replacing the per-app copies that each read
 * their own variable set.
 *
 * Wired from an app's main.ts, only in dev:
 *
 *   if (import.meta.env.DEV) {
 *     const { tryDevAutoLogin } = await import('@common/dev/autoLogin');
 *     await tryDevAutoLogin();
 *   }
 *
 * On by default whenever the target server has credentials. Opt out per app
 * with VITE_DEV_AUTO_LOGIN="false".
 *
 * Tree-shaken out of production builds because every call site is guarded by
 * import.meta.env.DEV.
 */

import { accxuiConfig } from "../core/configRegistry";
import { cookieHelper } from "../helpers/cookieHelper";
import { useAuth } from "../composables/useAuth";
import { commonUtil } from "../utils/commonUtil";
import logger from "../core/logger";
import { getDevCredentialsFor } from "../utils/devCredentials";

const redirectFromLogin = () => {
  if (window.location.pathname.endsWith("/login")) {
    window.location.replace("/");
  }
};

/**
 * The server to sign in to: an explicit VITE_DEV_OMS, else the app's default.
 * An alias label is resolved to its URL, because the OMS cookie is read as a
 * URL everywhere except for HotWax-hosted host prefixes.
 */
const getTargetOms = (): string => {
  const configured = (import.meta.env.VITE_DEV_OMS || import.meta.env.VITE_DEFAULT_ALIAS || "").trim();
  if (!configured) return "";

  try {
    const alias = import.meta.env.VITE_ALIAS ? JSON.parse(import.meta.env.VITE_ALIAS) : {};
    const resolved = alias[configured.toLowerCase()];
    return typeof resolved === "string" ? resolved : configured;
  } catch {
    return configured;
  }
};

export const tryDevAutoLogin = async (): Promise<void> => {
  if (!import.meta.env.DEV) return;
  if (import.meta.env.VITE_DEV_AUTO_LOGIN === "false") return;

  const oms = getTargetOms();
  if (!oms) return;

  const credentials = getDevCredentialsFor(oms);
  if (!credentials) return;

  const auth = useAuth();

  // An existing session belongs to whoever signed in; never replace it.
  if (auth.isAuthenticated.value && commonUtil.getMaargURL()) {
    redirectFromLogin();
    return;
  }

  try {
    // Seed the OMS so getOmsURL() resolves before the login call is made.
    accxuiConfig.value.oms = oms;
    auth.updateOMS(oms);
    cookieHelper().set("oms", oms);

    // Populates the Maarg URL in cookies, as Login.vue does before signing in.
    await auth.fetchLoginOptions();
    await auth.login(credentials.username, credentials.password);

    accxuiConfig.value.oms = oms;
    accxuiConfig.value.current = {
      ...accxuiConfig.value.current,
      userId: accxuiConfig.value.current?.userId || cookieHelper().get("userId")
    };

    redirectFromLogin();
    // The username is half of a credential, so only the server is logged.
    logger.info("[dev] auto-login succeeded on", oms);
  } catch {
    // Never log the password. useAuth already surfaces a toast on failure.
    logger.warn("[dev] auto-login failed; falling back to the login page");
  }
};
