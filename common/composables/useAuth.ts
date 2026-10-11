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
// Request ownership stays in memory. Never include this object in diagnostics.
export interface AuthSession {
  token: string;
  expirationTime: string;
  oms: string;
  maarg: string;
  userId: string;
}

/* eslint-disable no-restricted-syntax -- These are pure request ownership helpers, not Vue composables. */
export function readAuthSession(): AuthSession {
  return {
    token: commonUtil.getToken() || "",
    expirationTime: String(commonUtil.getTokenExpiration() || ""),
    oms: commonUtil.getOmsURL(false) || "",
    maarg: commonUtil.getMaargURL() || "",
    userId: cookieHelper().get("userId") || ""
  };
}

export function isCurrentAuthSession(session: AuthSession) {
  const current = readAuthSession();

  return (Object.keys(session) as (keyof AuthSession)[]).every(key => session[key] === current[key]);
}

let requestSession: AuthSession | undefined;
let sessionVersion = 0;
export function getAuthSessionVersion() {
  const current = readAuthSession();
  // Initial profile hydration fills userId while parallel permission requests are in flight.
  // That is still the same token/backend session, not a new login.
  const fillsUserId = requestSession && !requestSession.userId && current.userId &&
    requestSession.token === current.token && requestSession.expirationTime === current.expirationTime &&
    requestSession.oms === current.oms && requestSession.maarg === current.maarg;
  if(!requestSession || (!isCurrentAuthSession(requestSession) && !fillsUserId)) {
    sessionVersion++;
  }
  requestSession = current;

  return sessionVersion;
}

export function hasValidSessionToken(session = readAuthSession()) {
  return Boolean(session.token && Number.isFinite(Number(session.expirationTime)) && Number(session.expirationTime) > Date.now());
}

export function isSessionBackend(config: { url?: string; baseURL?: string }) {
  try {
    const target = new URL(config.url || "", config.baseURL || window.location.origin);

    return [commonUtil.getOmsURL(false), commonUtil.getOmsURL(true), commonUtil.getMaargURL()]
      .filter(Boolean).some(base => target.origin === new URL(base).origin);
  } catch {
    return false;
  }
}
/* eslint-enable no-restricted-syntax */

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
let observedSession: AuthSession;
let checkingSession = false;

const syncAuthRefs = () => {
  const session = readAuthSession();
  token.value = session.token;
  expirationTime.value = session.expirationTime;

  return session;
};

// Cookies span localhost ports and hosted subdomains; BroadcastChannel does not.
// Observe removal/context changes even in an idle tab, without rewriting shared cookies.
const checkSharedSession = async () => {
  if(checkingSession || !observedSession || commonUtil.isAppEmbedded()) {return;}
  if(isCurrentAuthSession(observedSession)) {return;}
  const previouslyAuthenticated = Boolean(observedSession.token);
  observedSession = syncAuthRefs();
  if(previouslyAuthenticated && (!hasValidSessionToken(observedSession) || !useAuth().isAuthenticated.value)) {
    checkingSession = true;
    try {
      await useAuth().logout({ isUserUnauthorised: true, invalidAppContext: true });
    } finally {
      checkingSession = false;
    }
  }
};

if(typeof window !== "undefined") {
  const interval = window.setInterval(() => { void checkSharedSession(); }, 1000);
  window.addEventListener("focus", checkSharedSession);
  window.addEventListener("pageshow", checkSharedSession);
  if(import.meta.hot) {
    import.meta.hot.dispose(() => {
      window.clearInterval(interval);
      window.removeEventListener("focus", checkSharedSession);
      window.removeEventListener("pageshow", checkSharedSession);
    });
  }
}

export function useAuth() {
  const session = syncAuthRefs();
  observedSession ||= session;
  const getDuration = (expirationTime?: any) => {
    const expiry = (expirationTime !== undefined && expirationTime !== null) ? expirationTime : commonUtil.getTokenExpiration();
    return expiry ? Math.floor(DateTime.fromMillis(Number(expiry)).diffNow().as('seconds')) : undefined;
  }


  const updateToken = (newToken: any, newExpirationTime: any) => {
    const duration = getDuration(newExpirationTime);
    cookieHelper().set("token", newToken, duration)
    cookieHelper().set("expirationTime", newExpirationTime, duration)
    cookieHelper().set("oms", cookieHelper().get("oms")!, duration)
    cookieHelper().set("maarg", cookieHelper().get("maarg")!, duration)
    token.value = newToken
    expirationTime.value = newExpirationTime
    observedSession = readAuthSession();
  }

  const updateOMS = (oms: any) => {
    cookieHelper().set("oms", oms, getDuration())
    omsRef.value = oms
    observedSession = readAuthSession();
  }

  const updateUserId = (userId: any) => {
    cookieHelper().set("userId", userId, getDuration())
    observedSession = readAuthSession();
  }

  const clearAuth = () => {
    cookieHelper().remove("token");
    cookieHelper().remove("expirationTime");
    cookieHelper().remove("maarg");
    cookieHelper().remove("userId");
    token.value = "";
    expirationTime.value = "";
    observedSession = readAuthSession();
  }

  const isAuthenticated = computed(() => {
    let isTokenExpired = false;
    let isOmsVerified = false;
    let isUserVerified = false;

    if(!token.value || !expirationTime.value || !hasValidSessionToken()) {return false;}

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
    const previousSession = readAuthSession();
    let loginSession: AuthSession | undefined;
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
          return Promise.reject(new Error(resp.data._ERROR_MESSAGE_));
        }

        omsToken = resp.data.token
        expiresAt = resp.data.expirationTime
      }

      if(!isCurrentAuthSession(previousSession)) {throw new Error("STALE_AUTH_REQUEST");}
      updateToken(omsToken, expiresAt)
      loginSession = readAuthSession();

      if(accxuiConfig.value.postLogin) {
        await accxuiConfig.value.postLogin();
      }
    } catch (err: any) {
      if(err?.message?.includes("INVALID_APP_CONTEXT") || err?.message?.includes("STALE_AUTH_REQUEST")) {
        return Promise.reject(err);
      }

      // Profile/permission/setup errors are not evidence that the shared token is invalid.
      // Keep the app on Login for a retry, while preserving other apps' valid session.
      const currentSession = readAuthSession();
      if(loginSession && loginSession.token === currentSession.token &&
          loginSession.expirationTime === currentSession.expirationTime &&
          loginSession.oms === currentSession.oms && loginSession.maarg === currentSession.maarg) {
        accxuiConfig.value.current = {}
      }

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
    const expectedSession = payload?.expectedSession || readAuthSession();
    if(!isCurrentAuthSession(expectedSession)) {return;}

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

      if(!isCurrentAuthSession(expectedSession)) {
        emitter.emit("dismissLoader");

        return;
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

    if(!isCurrentAuthSession(expectedSession)) {
      emitter.emit("dismissLoader");

      return;
    }
    if(!payload?.invalidAppContext && !commonUtil.isAppEmbedded()) {
      clearAuth()
    } else {
      commonUtil.showToast(translate("Session expired. Refreshing..."))
    }

    // appVersion is deployment config (which build this deployment is pinned to), not session state,
    // and has no cookie to fall back on — postLogout()'s store reset clears it. Capture it before the
    // reset and restore it after, so the router guard and fetchAppVersion keep agreeing across a logout
    // instead of ping-ponging /login <-> /vX.Y.Z/login. Re-resolved on the next login regardless.
    const appVersion = accxuiConfig.value.appVersion
    const resetSession = readAuthSession();

    if(accxuiConfig.value.postLogout) {
      try {
        await accxuiConfig.value.postLogout();
      } catch (err) {
        logger.error("Error running postLogout hook", err);
      }
    }

    // A newer login may finish while an app's asynchronous cache cleanup is running.
    if(!isCurrentAuthSession(resetSession)) {
      emitter.emit("dismissLoader");

      return;
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
    const configuredVersion = accxuiConfig.value.appVersion;
    if(configuredVersion === undefined) return false;

    const canonicalPath = getCanonicalPath(configuredVersion, window.location.pathname);
    if(canonicalPath === null) return false;

    window.location.replace(`${canonicalPath}${window.location.search}${window.location.hash}`);
    return true;
  };

  const fetchAppVersion = async () => {
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
        }
      });

      const appVersions = Array.isArray(resp.data) ? resp.data : resp.data?.docs;
      const configuredVersion = appVersions?.[0]?.currentVersion;

      // Persist the OMS's answer, then move the Login page onto that version's canonical URL.
      accxuiConfig.value.appVersion = configuredVersion || "";
      checkAppVersionRedirect();
    } catch (error) {
      // The call failed outright (endpoint unreachable/absent, or the config JSON was unparseable).
      // Resolve to "" so the app runs unversioned at root instead of staying unresolved.
      accxuiConfig.value.appVersion = "";
      checkAppVersionRedirect();
      logger.error(error);
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
