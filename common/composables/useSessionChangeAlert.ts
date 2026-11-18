import { onMounted, onUnmounted, toRaw, unref } from "vue";
import { alertController } from "@ionic/vue";
import emitter from "../core/emitter";
import { SESSION_CHANGED, type SessionChange } from "../core/sessionChange";
import { accxuiConfig } from "../core/configRegistry";
import { translate } from "../core/i18n";
import { cookieHelper } from "../helpers/cookieHelper";
import { commonUtil } from "../utils/commonUtil";

const POLL_MS = 5_000;
const SESSION_COOKIES = ["oms", "maarg", "userId"];

/**
 * Watches for a login elsewhere that replaced this tab's session, and asks the user to reload.
 *
 * The session (`token`, `oms`, `maarg`, `userId`) lives in cookies shared by every tab and every
 * HotWax app on the domain, so a login in another tab or app replaces it without running this tab's
 * `postLogin`. This tab then talks to another instance, or as another user, with its stores,
 * permissions and app db still on the old session. A BroadcastChannel can't announce it: it only
 * reaches tabs of the same origin, and the login may happen in another app. So the cookies themselves
 * are watched, against what this tab signed in with:
 *   - `oms` against `accxuiConfig.oms` and `userId` against `accxuiConfig.current.userId`, which this
 *     tab's own login sets together with the cookies (`isAuthenticated` compares the same pairs);
 *   - `maarg` against the value it had when this tab was first seen signed in, as nothing else holds
 *     it; taken again after this tab's own logout and login, and never compared on the Login page.
 * Checked on every cookie change where the browser has `cookieStore`, every few seconds otherwise, and
 * whenever the tab comes back into view.
 *
 * On a change it emits `sessionChanged` (the app db sync stops on it) and shows a reload alert
 * that can't be dismissed. The same alert shows when the sync service detects a switch first.
 * Mount once, in App.vue.
 */
export function useSessionChangeAlert() {
  let shown = false;
  let pollTimer: ReturnType<typeof setInterval> | null = null;
  /** The `maarg` cookie this tab signed in with; null until the tab is first seen signed in. */
  let signedInMaarg: string | null = null;
  const cookieStore = (globalThis as any).cookieStore;

  /** A change, or null. Only for a signed-in, non-embedded tab: a logout elsewhere is not a change. */
  function detectChange(): SessionChange | null {
    if (commonUtil.isAppEmbedded()) return null; // embedded apps keep a session per tab, not in cookies
    const oms = accxuiConfig.value.oms;
    const userId = accxuiConfig.value.current?.userId;
    // The config is a deep ref, which unwraps the router's currentRoute ref on access: read the raw one.
    const routeName = unref(toRaw(accxuiConfig.value)?.router?.currentRoute)?.name;
    // Signed out, or signing in on this tab: its own login rewrites the cookies, so forget the baseline.
    if (!oms || !userId || routeName === "Login") {
      signedInMaarg = null;
      return null;
    }
    const cookie = cookieHelper();
    const cookieOms = cookie.get("oms");
    const cookieUserId = cookie.get("userId");
    const cookieMaarg = cookie.get("maarg") || ""; // absent on an OFBiz-only deployment
    // A cleared cookie is a logout elsewhere (it clears userId), not a new session: the
    // 401 / INVALID_APP_CONTEXT path handles it.
    if (!cookieOms || !cookieUserId) return null;
    // Report only a change from a session this tab was seen holding. A page that loads with cookies of
    // another session isn't authenticated (isAuthenticated compares the same pairs) and goes to Login;
    // an alert there would come back after every Reload.
    if (signedInMaarg === null) {
      if (cookieOms === oms && cookieUserId === userId) signedInMaarg = cookieMaarg;
      return null;
    }
    // The instance name ("adoc-hn"), as the sync service reports it, rather than a full URL cookie.
    if (cookieOms !== oms) return { field: "oms", from: oms, to: commonUtil.getOMSInstanceName() || cookieOms };
    if (cookieUserId !== userId) return { field: "userId", from: userId, to: cookieUserId };
    return cookieMaarg !== signedInMaarg ? { field: "maarg", from: signedInMaarg, to: cookieMaarg } : null;
  }

  function checkSession() {
    if (shown) return;
    const change = detectChange();
    if (change) emitter.emit(SESSION_CHANGED, change);
  }

  async function showReloadAlert(change: SessionChange) {
    if (shown) return;
    shown = true;
    stopWatching();
    // Another instance names it; another user or Maarg on the same instance gets the general message.
    const toInstance = !change.field || change.field === "oms";
    const alert = await alertController.create({
      header: toInstance ? translate("Signed in to another instance") : translate("Session changed"),
      message: toInstance
        ? translate("This browser is now signed in to {instance} from another tab or app. Reload to continue.", { instance: change.to })
        : translate("This browser is now signed in to a different session from another tab or app. Reload to continue."),
      backdropDismiss: false,
      buttons: [{
        text: translate("Reload"),
        handler: () => { window.location.reload(); },
        htmlAttributes: { "data-testid": "session-changed-reload-btn" },
      }],
      htmlAttributes: { "data-testid": "session-changed-alert" },
    });
    await alert.present();
  }

  const onSessionChanged = (change: unknown) => { void showReloadAlert(change as SessionChange); };
  const onCookieChange = (event: any) => {
    const names = [...(event?.changed ?? []), ...(event?.deleted ?? [])].map((cookie: any) => cookie?.name);
    if (names.some((name) => SESSION_COOKIES.includes(name))) checkSession();
  };
  const onVisible = () => { if (!document.hidden) checkSession(); };

  function stopWatching() {
    if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
    cookieStore?.removeEventListener?.("change", onCookieChange);
    document.removeEventListener("visibilitychange", onVisible);
    window.removeEventListener("focus", checkSession);
  }

  onMounted(() => {
    emitter.on(SESSION_CHANGED, onSessionChanged);
    checkSession(); // takes the maarg baseline while the session is still this tab's
    cookieStore?.addEventListener?.("change", onCookieChange);
    pollTimer = setInterval(checkSession, POLL_MS); // also where cookieStore exists: it may miss a change
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", checkSession);
  });

  onUnmounted(() => {
    stopWatching();
    emitter.off(SESSION_CHANGED, onSessionChanged);
  });

  return { checkSession };
}
