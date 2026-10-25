import { commonUtil } from "../utils/commonUtil";
import { cookieHelper } from "../helpers/cookieHelper";
import logger from "../core/logger";
import { translate } from "../core/i18n";
import api from "../core/remoteApi";
import { useEmbeddedAppStore } from "../store/embeddedApp";
import { DateTime } from "luxon";
import { computed, ref } from "vue";
import emitter from "../core/emitter";
import { accxuiConfig } from "../core/configRegistry";
import { clearSessionScopedState, onSessionCleared } from "../core/sessionScope";
import { getCanonicalPath, getVersionedPathInfo } from "../utils/appVersionUtil";

interface LoginOption {
  loginAuthType?: string,
  maargInstanceUrl?: string,
  loginAuthUrl?: string
}

const loginOption = ref<LoginOption>({})
export const omsRef = ref("")
// Share the verified backend across tabs, scoped to the OMS cookie. Only detection metadata
// is stored here; credentials and authentication still follow the existing session flow.
const backendStorageKey = "accxui.omsBackend";
const readBackendMode = (): boolean => {
  try {
    // Migrate a previously verified tab when upgrading from tab-local persistence.
    const saved = JSON.parse(localStorage.getItem(backendStorageKey) || sessionStorage.getItem(backendStorageKey) || "null");
    const oms = cookieHelper().get("oms");
    if (oms && saved?.oms === oms && typeof saved?.isMoqui === "boolean") {
      try { localStorage.setItem(backendStorageKey, JSON.stringify(saved)); } catch { /* Optional persistence. */ }
      return saved.isMoqui;
    }
  } catch { /* Storage may be unavailable; detection still works for this page. */ }
  return commonUtil.isMoqui();
};
export const isMoquiOmsRef = ref(readBackendMode());
const clearBackendMode = () => {
  isMoquiOmsRef.value = commonUtil.isMoqui();
  try { localStorage.removeItem(backendStorageKey); } catch { /* Optional persistence. */ }
  try { sessionStorage.removeItem(backendStorageKey); } catch { /* Optional persistence. */ }
};
const token = ref(cookieHelper().get("token") || "")
const expirationTime = ref(cookieHelper().get("expirationTime") || "")
let explicitlyLoggedOut = false;
// Revalidate persisted deployment settings once per document/session, before enforcing their URL.
let appVersionLookup: { context: string; complete: boolean; resolved?: boolean; promise?: Promise<void> } | undefined;
const appVersionContext = () => JSON.stringify([
  commonUtil.getMaargURL(), commonUtil.getToken(), accxuiConfig.value.oms,
  import.meta.env.VITE_APP_VERSION_CONFIG
]);
onSessionCleared(() => { appVersionLookup = undefined; });

export function useAuth() {
  const getDuration = (expirationTime?: any) => {
    const expiry = (expirationTime !== undefined && expirationTime !== null) ? expirationTime : commonUtil.getTokenExpiration();
    return expiry ? Math.floor(DateTime.fromMillis(Number(expiry)).diffNow().as('seconds')) : undefined;
  }


  const updateToken = (newToken: any, newExpirationTime: any) => {
    if (newToken) explicitlyLoggedOut = false;
    const duration = getDuration(newExpirationTime);
    cookieHelper().set("token", newToken, duration)
    cookieHelper().set("expirationTime", newExpirationTime, duration)
    cookieHelper().set("oms", cookieHelper().get("oms")!, duration)
    cookieHelper().set("maarg", cookieHelper().get("maarg")!, duration)
    token.value = newToken
    expirationTime.value = newExpirationTime
  }

  const updateOMS = (oms: any) => {
    if (oms !== cookieHelper().get("oms")) clearBackendMode();
    cookieHelper().set("oms", oms, getDuration())
    omsRef.value = oms
  }

  const updateUserId = (userId: any) => {
    cookieHelper().set("userId", userId, getDuration())
  }

  const clearAuth = () => {
    appVersionLookup = undefined;
    clearBackendMode();
    cookieHelper().remove("token");
    cookieHelper().remove("expirationTime");
    cookieHelper().remove("maarg");
    cookieHelper().remove("userId");
    updateToken("", "")
    updateUserId("")
  }

  const isAuthenticated = computed(() => {
    let isTokenExpired = false;
    let isOmsVerified = false;
    let isUserVerified = false;

    if (!token.value || !expirationTime.value) return false;

    const expiry = Number(expirationTime.value);
    if(expiry) {
      const currTime = DateTime.now().toMillis();
      isTokenExpired = expiry < currTime;
    }

    const oms = cookieHelper().get("oms")
    const userId = cookieHelper().get("userId")

    if(oms && accxuiConfig.value.oms === oms) {
      isOmsVerified = true
    }

    if(userId && accxuiConfig.value.current?.userId === userId) {
      isUserVerified = true
    }

    return !isTokenExpired && (commonUtil.isAppEmbedded() || (isOmsVerified && isUserVerified))
  })

  const login = async (username?: string, password?: string, token?: string, expirationTime?: string) => {
    let omsToken = token
    let expiresAt = expirationTime
    try {
      if(!omsToken && username && password) {
        const loginBaseURL = isMoquiOmsRef.value ? commonUtil.getMaargURL() : commonUtil.getOmsURL(false)
        // No verified instance to sign in to, e.g. the entered OMS never answered checkLoginOptions.
        if(!loginBaseURL) {
          commonUtil.showToast(translate("Unable to reach the OMS. Check the OMS name and try again."));
          return Promise.reject(new Error("OMS is not verified"));
        }
        const resp = await api({
          url: isMoquiOmsRef.value ? "admin/login" : "login",
          method: "post",
          data: isMoquiOmsRef.value ? {
            "username": username,
            "password": password
          } : {
            "USERNAME": username,
            "PASSWORD": password
          },
          baseURL: loginBaseURL
        });

        if(commonUtil.hasError(resp)) {
          const serverError = commonUtil.getErrorMessage(resp);
          logger.error("Failed to login", serverError);
          commonUtil.showToast(`${translate("Failed to login.")} ${serverError}`);
          updateUserId("")
          updateToken("", "")

          return Promise.reject(new Error(serverError));
        }

        omsToken = resp.data.token
        expiresAt = resp.data.expirationTime
      }

      updateToken(omsToken, expiresAt)

      if(accxuiConfig.value.postLogin) {
        await accxuiConfig.value.postLogin();
      }
    } catch (err: any) {
      if(err?.message?.includes("INVALID_APP_CONTEXT")) {
        return;
      }

      updateToken("", "")
      accxuiConfig.value.current = {}

      // Moqui login returns a non-2xx status (e.g. bad credentials), so axios rejects
      // before `hasError()` can inspect the body - surface that message here instead.
      const serverError = commonUtil.getErrorMessage(err);
      logger.error("Failed to login", serverError);
      commonUtil.showToast(`${translate("Failed to login.")} ${serverError}`);

      return Promise.reject(new Error(serverError));
    }
  }

  const logout = async (payload?: any) => {
    // Late requests after logout must not restart teardown or report a second expiry.
    // Keep handling invalidation when this tab or an embedded app still has a token.
    if (payload?.isUserUnauthorised && explicitlyLoggedOut && !token.value && !commonUtil.getToken()) return;

    let redirectionUrl = "";

    if(!payload?.isUserUnauthorised) {
      explicitlyLoggedOut = true;
      emitter.emit("presentLoader", {
        message: "Logging out",
        backdropDismiss: false,
      });
      
      if(accxuiConfig.value.preLogout) {
        try {
          await accxuiConfig.value.preLogout();
        } catch (err) {
          logger.error("Error running preLogout hook", err);
        }
      }

      try {
        const payload = isMoquiOmsRef.value ? {
          url: "admin/logout",
          method: "POST",
          baseURL: commonUtil.getMaargURL()
        } : {
          url: "logout",
          method: "GET",
          baseURL: commonUtil.getOmsURL(false)
        }

        let resp = await api(payload) as any;
        // OFBiz prefixes its JSON with "//", so axios leaves it as text; Maarg's arrives parsed.
        resp = typeof resp.data === "string" ? JSON.parse(resp.data.startsWith("//") ? resp.data.replace("//", "") : resp.data) : resp.data;

        if(resp?.logoutAuthType == "SAML2SSO") {
          redirectionUrl = resp.logoutUrl;
        }
      } catch (err) {
        logger.error("Error logging out", err);
      }
    }

    if(!payload?.invalidAppContext && !commonUtil.isAppEmbedded()) {
      updateToken("", "")
      updateUserId("")
    } else {
      commonUtil.showToast(translate("Session expired. Refreshing..."))
    }

    // appVersion is deployment config (which build this deployment is pinned to), not session state,
    // and has no cookie to fall back on — postLogout()'s store reset clears it. Capture it before the
    // reset and restore it after, so the router guard and fetchAppVersion keep agreeing across a logout
    // instead of ping-ponging /login <-> /vX.Y.Z/login. Re-resolved on the next login regardless.
    const appVersion = accxuiConfig.value.appVersion

    if(accxuiConfig.value.postLogout) {
      try {
        await accxuiConfig.value.postLogout();
      } catch (err) {
        logger.error("Error running postLogout hook", err);
      }
    }

    // Shared composables in common hold module-level tenant data too; sweep them after the app's own hook.
    clearSessionScopedState()

    // Reset oms in app's state, as we are clearing app's state on logout, but do not clear oms cookie
    // this causes an issue on relogin to the same instance without moving to the oms page
    accxuiConfig.value.oms = cookieHelper().get("oms") as string
    accxuiConfig.value.appVersion = appVersion
    if (typeof localStorage !== "undefined" && localStorage?.removeItem) {
      localStorage.removeItem("requestedPagePath")
    }

    if (commonUtil.isAppEmbedded()) {
      const embeddedAppStore = useEmbeddedAppStore();
      redirectionUrl = window.location.origin + '/shopify-login?shop=' + embeddedAppStore.shop + '&host=' + embeddedAppStore.host + '&embedded=1';
      embeddedAppStore.$reset();
    }

    if (redirectionUrl) {
      window.location.href = redirectionUrl;
    } else if (accxuiConfig.value.router?.replace) {
      accxuiConfig.value.router.replace("/login");
    }
    emitter.emit("dismissLoader");
  }

  // Resolves true only when the entered OMS answered checkLoginOptions. The maarg cookie is
  // cleared first: it belongs to whichever OMS was verified last, and keeping it after a
  // failed check would send the next login to that other instance.
  const fetchLoginOptions = async () => {
    clearBackendMode();
    loginOption.value = {}
    cookieHelper().remove("maarg")
    try {
      let resp;
      let isMoquiOms = commonUtil.isMoqui();

      if(isMoquiOms) {
        // App is built strictly for Moqui — no OFBiz endpoint to try first.
        resp = await api({
          url: "admin/checkLoginOptions",
          method: "GET",
          baseURL: commonUtil.getOmsURL(true)
        });
      } else {
        try {
          // Try the entered OMS as an OFBiz instance first (default when VITE_OMS_TYPE is unset).
          resp = await api({
            url: "checkLoginOptions",
            method: "GET",
            baseURL: commonUtil.getOmsURL(false)
          });
          if(commonUtil.hasError(resp)) throw new Error(resp.data._ERROR_MESSAGE_);
        } catch (ofbizError) {
          //If OFBiz checkLoginOptions faild considering that this is the Moqui only setup and making call to moqui checkLoginOptions
          isMoquiOms = true;
          resp = await api({
            url: "admin/checkLoginOptions",
            method: "GET",
            baseURL: commonUtil.getOmsURL(true)
          });
        }
      }

      if(!commonUtil.hasError(resp)) {
        isMoquiOmsRef.value = isMoquiOms;
        try {
          localStorage.setItem(backendStorageKey, JSON.stringify({
            oms: cookieHelper().get("oms"), isMoqui: isMoquiOms
          }));
        } catch { /* A storage restriction must not prevent login. */ }
        loginOption.value = resp.data
        if (resp.data.maargInstanceUrl) {
          // OFBiz deployment: OFBiz tells the PWA where its Moqui instance is
          cookieHelper().set("maarg", resp.data.maargInstanceUrl, getDuration())
        } else if (isMoquiOms) {
          // Moqui-only deployment: the OMS IS the maarg.
          // Strip any /rest/s1/... path suffix so getMaargURL() can append /rest/s1/ itself.
          // e.g. "http://localhost:8080" → maarg="http://localhost:8080" → getMaargURL()="http://localhost:8080/rest/s1/"
          // e.g. "demo"                  → maarg="demo"                  → getMaargURL()="https://demo.hotwax.io/rest/s1/"
          const omsVal = (cookieHelper().get("oms") as string || "").trim()
          const maargVal = omsVal.startsWith('http')
            ? omsVal.replace(/\/rest\/s1.*$/, '').replace(/\/+$/, '')
            : omsVal
          cookieHelper().set("maarg", maargVal, getDuration())
        }
        return true
      }
    } catch (error) {
      logger.error(error)
    }
    return false
  };

  // Enforce the canonical URL for the resolved appVersion (accxuiConfig, so it's app-agnostic): redirect
  // when the current URL isn't canonical, preserving path/query/hash. Returns true when a redirect was
  // issued so a router guard can cancel the in-flight navigation. No-op while appVersion is undefined
  // (not resolved yet — acting would risk a premature/looping redirect) or already canonical. Shared by
  // the router guard (every navigation) and fetchAppVersion (right after it resolves the version).
  const checkAppVersionRedirect = () => {
    if(appVersionLookup?.context !== appVersionContext() || !appVersionLookup.complete) {
      if(isAuthenticated.value) { void fetchAppVersion(); }
      // Do not redirect using a stale persisted pin while its replacement is being fetched.

      return false;
    }
    if(!appVersionLookup.resolved) { return false; }
    const configuredVersion = accxuiConfig.value.appVersion;
    if(configuredVersion === undefined) return false;

    const canonicalPath = getCanonicalPath(configuredVersion, window.location.pathname);
    if(canonicalPath === null) return false;

    window.location.replace(`${canonicalPath}${window.location.search}${window.location.hash}`);
    return true;
  };

  const fetchAppVersion = () => {
    const context = appVersionContext();
    if(appVersionLookup?.context === context && !appVersionLookup.complete) {
      return appVersionLookup.promise!;
    }
    const lookup: NonNullable<typeof appVersionLookup> = { context, complete: false };
    appVersionLookup = lookup;
    lookup.promise = (async () => {
      try {
        const { appId, environmentTypeId } = JSON.parse(import.meta.env.VITE_APP_VERSION_CONFIG);
        const resp = await api({
          url: `admin/apps/${appId}/appVersions`, method: "GET", timeout: 5000,
          params: { appId, environmentTypeId }
        });
        // A logout or instance/session change must invalidate a late response.
        if(appVersionLookup !== lookup || appVersionContext() !== context) { return; }
        const rows = Array.isArray(resp.data) ? resp.data : resp.data?.docs;
        if(commonUtil.hasError(resp) || !Array.isArray(rows) || rows.length > 1 ||
          rows.some(row => !row || typeof row !== "object" || Array.isArray(row) || row.appId !== appId ||
            row.environmentTypeId !== environmentTypeId)) {
          throw new Error("Invalid app version response");
        }
        // Default may be no deployment row, or a retained audit row with its pin cleared.
        // Moqui omits the nullable currentVersion field after Company saves null/empty.
        const configuredVersion = rows[0]?.currentVersion ?? "";
        if(typeof configuredVersion !== "string" || (configuredVersion &&
          getVersionedPathInfo(`/${configuredVersion}`).version !== configuredVersion)) {
          throw new Error("Invalid configured app version");
        }
        accxuiConfig.value.appVersion = configuredVersion;
        lookup.complete = true;
        lookup.resolved = true;
        checkAppVersionRedirect();
      } catch (error) {
        // Failed lookup is not Default. Preserve the last choice and the current page.
        logger.error(error);
      } finally {
        lookup.complete = true;
      }
    })();

    return lookup.promise;
  };

  return {
    loginOption,
    fetchLoginOptions,
    fetchAppVersion,
    checkAppVersionRedirect,
    login,
    logout,
    clearAuth,
    updateToken,
    updateOMS,
    updateUserId,
    isAuthenticated
  }
}
