import { api, commonUtil, cookieHelper, logger, translate, useEmbeddedAppStore } from "..";
import { DateTime } from "luxon";
import { computed, ref } from "vue";
import emitter from "../core/emitter";
import { accxuiConfig } from "../core/configRegistry";

interface LoginOption {
  loginAuthType?: string,
  maargInstanceUrl?: string,
  loginAuthUrl?: string
}

const loginOption = ref<LoginOption>({})
export const omsRef = ref("")
const token = ref(cookieHelper().get("token") || "")
const expirationTime = ref(cookieHelper().get("expirationTime") || "")

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
    updateOMS("")
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
        const resp = await api({
          url: commonUtil.isMoqui() ? "admin/login" : "login",
          method: "post",
          data: commonUtil.isMoqui() ? {
            "username": username,
            "password": password
          } : {
            "USERNAME": username,
            "PASSWORD": password
          },
          baseURL: commonUtil.isMoqui() ? commonUtil.getMaargURL() : commonUtil.getOmsURL()
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
      accxuiConfig.value.oms = "",
      accxuiConfig.value.current = {}

      commonUtil.showToast(translate("Something went wrong while login. Please contact administrator."));
      logger.error("error: ", err.toString());

      return Promise.reject(err instanceof Object ? err : new Error(err));
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
        const payload = commonUtil.isMoqui() ? {
          url: "admin/logout",
          method: "POST",
          baseURL: commonUtil.getMaargURL()
        } : {
          url: "logout",
          method: "GET",
          baseURL: commonUtil.getOmsURL()
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

    if(accxuiConfig.value.postLogout) {
      try {
        await accxuiConfig.value.postLogout();
      } catch (err) {
        logger.error("Error running postLogout hook", err);
      }
    }

    localStorage.removeItem("requestedPagePath")

    if (commonUtil.isAppEmbedded()) {
      const embeddedAppStore = useEmbeddedAppStore();
      redirectionUrl = window.location.origin + '/shopify-login?shop=' + embeddedAppStore.shop + '&host=' + embeddedAppStore.host + '&embedded=1';
      embeddedAppStore.$reset();
    }

    if(redirectionUrl) {
      window.location.href = redirectionUrl
    } else {
      accxuiConfig.value.router.replace("/login");
    }
    emitter.emit("dismissLoader");
  }

  const fetchLoginOptions = async () => {
    loginOption.value = {}
    try {
      const resp = await api({
        url: commonUtil.isMoqui() ? "admin/checkLoginOptions" : "checkLoginOptions",
        method: "GET",
        baseURL: commonUtil.isMoqui() ? commonUtil.getMaargURL() : commonUtil.getOmsURL()
      });
      if(!commonUtil.hasError(resp)) {
        loginOption.value = resp.data
        if (resp.data.maargInstanceUrl) {
          // OFBiz deployment: OFBiz tells the PWA where its Moqui instance is
          cookieHelper().set("maarg", resp.data.maargInstanceUrl, getDuration())
        } else if (commonUtil.isMoqui()) {
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

  return {
    loginOption,
    fetchLoginOptions,
    login,
    logout,
    clearAuth,
    updateToken,
    updateOMS,
    updateUserId,
    isAuthenticated
  }
}
