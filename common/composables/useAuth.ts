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
import { clearSessionScopedState } from "../core/sessionScope";
import { getCanonicalPath } from "../utils/appVersionUtil";

interface LoginOption {
  loginAuthType?: string,
  maargInstanceUrl?: string,
  loginAuthUrl?: string
}

const loginOption = ref<LoginOption>({})
export const omsRef = ref("")
// Which backend fetchLoginOptions() actually found the entered OMS to be — kept in sync so
// login() hits the matching URL instead of assuming the static VITE_OMS_TYPE build flag.
const isMoquiOmsRef = ref(commonUtil.isMoqui())
const token = ref(cookieHelper().get("token") || "")
const expirationTime = ref(cookieHelper().get("expirationTime") || "")

// Loop protection for version redirects, scoped to the tab: sessionStorage survives the reload a redirect
// causes, which is exactly the span we need to reason across, and a new tab starts clean. Access is
// guarded because embedded webviews can restrict storage — losing loop protection must never block the
// redirect itself.
const PENDING_VERSION_KEY = "appVersionRedirectPending"
const FAILED_VERSIONS_KEY = "appVersionRedirectFailed"

const readSession = (key: string) => {
  try {
    return sessionStorage.getItem(key)
  } catch (e) {
    return null
  }
}

const writeSession = (key: string, value: string) => {
  try {
    sessionStorage.setItem(key, value)
  } catch (e) {
    // Storage unavailable — proceed without loop protection rather than stranding the user.
  }
}

const clearSession = (key: string) => {
  try {
    sessionStorage.removeItem(key)
  } catch (e) {
    // As above.
  }
}

const getFailedVersions = () => (readSession(FAILED_VERSIONS_KEY) || "").split(",").filter(Boolean)

// A redirect issued during THIS page load. window.location.replace() doesn't stop the current task, and
// several callers can run before the navigation happens (Login.vue resolves the version from more than
// one path; the router guard fires on every navigation). They must be told a redirect is already in
// flight, not treated as a fresh attempt.
let versionRedirectIssued = false

// Settle the previous page load's attempt, once per load. If the version we redirected to isn't the
// version actually being served, the host isn't serving what the OMS named: record it so we stop
// targeting it, otherwise root and that version bounce off each other forever. A redirect that landed
// records nothing, so a later backend change — including a rollback to a version we already ran — still
// redirects normally.
let versionAttemptReconciled = false

const reconcileVersionAttempt = () => {
  if (versionAttemptReconciled) return
  versionAttemptReconciled = true

  const pending = readSession(PENDING_VERSION_KEY)
  if (pending === null) return
  clearSession(PENDING_VERSION_KEY)

  // Redirecting to root is the fallback and always lands, so only a named version can fail.
  if (!pending || pending === commonUtil.getBuildVersion()) return

  const failed = getFailedVersions()
  if (!failed.includes(pending)) writeSession(FAILED_VERSIONS_KEY, [...failed, pending].join(","))
  logger.error(`App version "${pending}" is not served by this host; falling back to the root build for this session.`)
}

// Pinia isn't active at module-import time (and never in a bare unit context), so resolve the store
// defensively — mirrors commonUtil's own guarded accessor.
const getEmbeddedAppStoreSafe = () => {
  try {
    return useEmbeddedAppStore()
  } catch (e) {
    return undefined
  }
}

export function useAuth() {
  const getDuration = (expirationTime?: any) => {
    const expiry = (expirationTime !== undefined && expirationTime !== null) ? expirationTime : commonUtil.getTokenExpiration();
    return expiry ? Math.floor(DateTime.fromMillis(Number(expiry)).diffNow().as('seconds')) : undefined;
  }


  const updateToken = (newToken: any, newExpirationTime: any) => {
    const duration = getDuration(newExpirationTime);
    cookieHelper().set("token", newToken, duration)
    cookieHelper().set("expirationTime", newExpirationTime, duration)
    token.value = newToken
    expirationTime.value = newExpirationTime
  }

  const updateOMS = (oms: any) => {
    cookieHelper().set("oms", oms, getDuration())
    omsRef.value = oms
  }

  const updateUserId = (userId: any) => {
    cookieHelper().set("userId", userId, getDuration())
  }

  const clearAuth = () => {
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

    // An embedded (Shopify) session keeps its credentials in the embedded-app store, not in cookies:
    // document.cookie is unreliable inside Shopify's cross-origin iframe, since SameSite=Lax cookies
    // aren't sent in a third-party context. So read the store first and fall back to the cookie-backed
    // refs for standalone sessions — those stay reactive because updateToken() writes them. Reading the
    // store's getters here (rather than commonUtil.getToken(), which resolves the cookie non-reactively)
    // is what keeps this computed invalidating on both paths.
    const embeddedAppStore = getEmbeddedAppStoreSafe();
    const currentToken = embeddedAppStore?.getToken || token.value;
    const currentExpiration = embeddedAppStore?.getTokenExpiration || expirationTime.value;

    if (!currentToken || !currentExpiration) return false;

    const expiry = Number(currentExpiration);
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
          baseURL: isMoquiOmsRef.value ? commonUtil.getMaargURL() : commonUtil.getOmsURL(false)
        });

        if(commonUtil.hasError(resp)) {
          commonUtil.showToast(translate("Sorry, your username or password is incorrect. Please try again."));
          logger.error("error", resp.data._ERROR_MESSAGE_);
          updateUserId("")
          updateToken("", "")

          return Promise.reject(new Error(resp.data._ERROR_MESSAGE_));
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
      const loginErrorMessage = err?.response?.data?.errors;
      commonUtil.showToast(loginErrorMessage ? translate(loginErrorMessage) : translate("Something went wrong while login. Please contact administrator."));
      logger.error("error: ", err.toString());

      return Promise.reject(loginErrorMessage ? new Error(loginErrorMessage) : (err instanceof Object ? err : new Error(err)));
    }
  }

  const logout = async (payload?: any) => {
    let redirectionUrl = "";

    if(!payload?.isUserUnauthorised) {
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
        resp = JSON.parse(resp.data.startsWith("//") ? resp.data.replace("//", "") : resp.data);

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
      // Build the entry URL before the reset, while shop/host are still in the store, and let the helper
      // keep the version segment of the path we're on.
      redirectionUrl = commonUtil.getEmbeddedAppEntryUrl();
      useEmbeddedAppStore().$reset();
    }

    if (redirectionUrl) {
      window.location.href = redirectionUrl;
    } else if (accxuiConfig.value.router?.replace) {
      accxuiConfig.value.router.replace("/login");
    }
    emitter.emit("dismissLoader");
  }

  const fetchLoginOptions = async () => {
    loginOption.value = {}
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

      isMoquiOmsRef.value = isMoquiOms

      if(!commonUtil.hasError(resp)) {
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
      }
    } catch (error) {
      logger.error(error)
    }
  };

  // Enforce the canonical URL for the resolved appVersion (accxuiConfig, so it's app-agnostic): redirect
  // when the current URL isn't canonical, preserving path/query/hash. Returns true when a redirect was
  // issued so a router guard can cancel the in-flight navigation. No-op while appVersion is undefined
  // (not resolved yet — acting would risk a premature/looping redirect) or already canonical. Shared by
  // the router guard (every navigation) and fetchAppVersion (right after it resolves the version).
  const checkAppVersionRedirect = () => {
    // A redirect is already in flight for this page load: report it as such so callers bail, rather than
    // letting a second caller treat it as a fresh attempt (and, by returning false, let an in-app
    // navigation proceed and supersede the pending page load).
    if(versionRedirectIssued) return true;

    const configuredVersion = accxuiConfig.value.appVersion;
    if(configuredVersion === undefined) return false;

    reconcileVersionAttempt();

    // Hosting's catch-all rewrite serves the root bootstrap for any version it doesn't have, so the URL
    // can claim a version this bundle isn't. Getting back onto a path this deployment can actually serve
    // takes priority over honouring the OMS's answer — otherwise the versioned path matches no route and
    // renders a blank outlet. The loop guard below then stops us being sent straight back.
    const undeployedVersion = commonUtil.getUndeployedVersion();
    // A version already proven unreachable this session is never targeted again — otherwise root and that
    // version bounce off each other forever, and there is no address bar to escape from in Shopify POS.
    const wantedVersion = getFailedVersions().includes(configuredVersion) ? "" : configuredVersion;
    const targetVersion = undeployedVersion ? "" : wantedVersion;

    const canonicalPath = getCanonicalPath(targetVersion, window.location.pathname);
    if(canonicalPath === null) return false;

    // Remember what we're about to try so the next load can tell whether it landed.
    writeSession(PENDING_VERSION_KEY, targetVersion);
    versionRedirectIssued = true;

    // A version switch is always a full page load, which destroys the live App Bridge instance. An
    // embedded session can only rebuild it by going through /shopify-login, so send it there (carrying
    // shop/host) instead of to the canonical path — landing anywhere else leaves it with no bridge.
    if(commonUtil.isAppEmbedded()) {
      window.location.replace(commonUtil.getEmbeddedAppEntryUrl(targetVersion));
      return true;
    }

    window.location.replace(`${canonicalPath}${window.location.search}${window.location.hash}`);
    return true;
  };

  // `baseURL` lets the caller name the backend to ask before the session knows its own — the embedded
  // flow resolves the version from the shop's Maarg instance ahead of login. Returns true when a redirect
  // was issued, so callers can stop instead of continuing into a page that is being torn down.
  const fetchAppVersion = async (baseURL?: string) => {
    try {
      // appId (endpoint path) and environmentTypeId come from the single multi-version config object
      // (VITE_APP_VERSION_CONFIG), so they match this deployment's app rather than being hardcoded.
      const { appId, environmentTypeId } = JSON.parse(import.meta.env.VITE_APP_VERSION_CONFIG);
      const resp = await api({
        url: `admin/apps/${appId}/appVersions`,
        method: "GET",
        params: {
          appId,
          environmentTypeId
        },
        ...(baseURL ? { baseURL } : {})
      });

      const appVersions = Array.isArray(resp.data) ? resp.data : resp.data?.docs;
      const configuredVersion = appVersions?.[0]?.currentVersion;

      // Persist the OMS's answer, then move the Login page onto that version's canonical URL.
      accxuiConfig.value.appVersion = configuredVersion || "";
      return checkAppVersionRedirect();
    } catch (error) {
      // The call failed outright (endpoint unreachable/absent, or the config JSON was unparseable). Don't
      // demote a session already running a version this deployment serves — a transient OMS outage must
      // not move every merchant onto the root build. Otherwise resolve to "" and run unversioned at root.
      const runningVersion = commonUtil.getBuildVersion();
      accxuiConfig.value.appVersion = runningVersion && !commonUtil.getUndeployedVersion() ? runningVersion : "";
      logger.error(error);
      return checkAppVersionRedirect();
    }
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
