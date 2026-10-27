import axios from 'axios';
import { StatusCodes } from 'http-status-codes';
import { setupCache } from 'axios-cache-adapter'
import qs from "qs"
import { commonUtil } from '../utils/commonUtil';
import { useAuth } from '../composables/useAuth';
import { translate } from './i18n';
import { parseRetryAfter } from './workerRemoteApi';
import { claimRetryNotice, isServiceUnavailableError, markServiceAvailable, markServiceUnavailable } from './serviceAvailability';

// The following are the endpoints needs to bypass the auth check and when this calls are made we will assume
// that we are always relogin with the new credentials present in cookies.
const noAuthEndpoints = ["login", "logout", "checkLoginOptions", "user/profile", "user/permissions", "getPermissions", "app-bridge/login", "appVersions"]
const isAnonymousEndpoint = (url = "") => noAuthEndpoints.some((endpoint: string) => url.includes(endpoint));

/** Retries of a request the server could not answer (a 5xx, 408, 429 or no response). */
export const MAX_RETRIES = 3;
const BASE_RETRY_DELAY_MS = 1000;
const MAX_RETRY_DELAY_MS = 30000;
/** Only these are retried by default: repeating a write could apply it twice. `retry: true` opts a safe one in. */
const IDEMPOTENT_METHODS = ["get", "head", "options"];
/** Before a 401 logs out, the session is confirmed once; every 401 in the burst shares that check. */
const SESSION_CHECK_DELAY_MS = 500;
const SESSION_CHECK_REUSE_MS = 2000;

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Exponential backoff with jitter (1 s, 2 s, 4 s …, capped); a longer `Retry-After` wins, up to the cap. */
export const retryDelayMs = (attempt: number, retryAfterMs?: number, random = Math.random) => {
  const exponential = Math.min(MAX_RETRY_DELAY_MS, BASE_RETRY_DELAY_MS * 2 ** Math.max(0, attempt - 1));
  const jittered = exponential / 2 + random() * (exponential / 2);

  return Math.max(jittered, Math.min(retryAfterMs ?? 0, MAX_RETRY_DELAY_MS));
}

const requestInterceptor = async (config: any) => {
  const token = commonUtil.getToken();

  // When the same app is opened in multiple tabs and logout from one tab, then another tab still uses the old
  // session, to handle this scenario we have added check to always validate authentication before api calls
  // so if the current apps session becomes invalid, due to external change to cookies/state, then the app updates
  // the session automatically.
  // Bypass the check for endpoints that don't require authentication (like login, logout, profile),
  // as these are often called during the authentication flow itself or to refresh local state.
  if (!useAuth().isAuthenticated.value && !isAnonymousEndpoint(config.url)) {
    await useAuth().logout({ isUserUnauthorised: true, invalidAppContext: true })
    useAuth().clearAuth()
    return Promise.reject(new Error("INVALID_APP_CONTEXT"));
  }

  if (token) {
    config.headers["Authorization"] = "Bearer " + token;
    config.headers['Content-Type'] = 'application/json';
  }
  return config;
}

const responseSuccessInterceptor = (response: any) => {
  // Any status code that lie within the range of 2xx cause this function to trigger
  markServiceAvailable();
  return response;
}

/**
 * Retry a request the server could not answer, with backoff. Only idempotent requests (or ones that
 * opt in with `retry: true`), at most MAX_RETRIES times; anything else rejects with the original error.
 */
const retryRequest = async (error: any) => {
  const config = error.config;
  const attempt = config.__retryCount ?? 0;
  const retryable = config.retry === true || (config.retry !== false && IDEMPOTENT_METHODS.includes(String(config.method || "get").toLowerCase()));
  if (!retryable || attempt >= MAX_RETRIES) return Promise.reject(error);

  config.__retryCount = attempt + 1;
  if (claimRetryNotice()) commonUtil.showToast(translate("Service temporarily unavailable. Retrying..."));
  await wait(retryDelayMs(attempt + 1, parseRetryAfter(error.response?.headers?.["retry-after"])));
  // The user may have signed out meanwhile; retrying would then fail the session check and log out again.
  if (!useAuth().isAuthenticated.value && !isAnonymousEndpoint(config.url)) return Promise.reject(error);

  return axios(config);
}

let sessionCheck: Promise<"valid" | "invalid" | "unavailable"> | null = null;

/**
 * Whether the current token is really invalid. A backend that cannot reach its database may answer
 * 401 for a valid token (Maarg's "Error finding UserAccount"), so one 401 is not proof the session
 * ended: ask once more with a lightweight profile call, and log out only if that is a 401 too.
 */
const confirmSession = (token: string) => {
  if (!sessionCheck) {
    sessionCheck = (async () => {
      await wait(SESSION_CHECK_DELAY_MS);
      try {
        // A bare instance: this check must not pass through these interceptors itself.
        await axios.create().request({
          url: "admin/user/profile",
          method: "get",
          baseURL: commonUtil.getMaargURL(),
          headers: { Authorization: "Bearer " + token }
        });
        return "valid" as const;
      } catch (err: any) {
        return isServiceUnavailableError(err) ? "unavailable" as const : "invalid" as const;
      }
    })();
    const check = sessionCheck;
    check.finally(() => setTimeout(() => {
      if (sessionCheck === check) sessionCheck = null;
    }, SESSION_CHECK_REUSE_MS));
  }

  return sessionCheck;
}

const responseErrorInterceptor = async (error: any) => {
  // A request the interceptor rejected (INVALID_APP_CONTEXT) or a cancelled one: nothing was sent.
  if (!error?.config) return Promise.reject(error);

  // A server fault or no response is an outage, never a reason to sign the user out: retry instead.
  if (isServiceUnavailableError(error)) {
    markServiceUnavailable();
    return retryRequest(error);
  }
  if (error.response) markServiceAvailable();

  if (error.response?.status == StatusCodes.UNAUTHORIZED) {
    const token = commonUtil.getToken();
    // Login and the other anonymous endpoints answer 401 for bad credentials: no session to confirm.
    const outcome = isAnonymousEndpoint(error.config.url) || !token || !commonUtil.getMaargURL()
      ? "invalid"
      : await confirmSession(token);
    if (outcome === "invalid") {
      useAuth().logout({ isUserUnauthorised: true });
    } else if (outcome === "unavailable") {
      markServiceUnavailable();
      return retryRequest(error);
    } else if (!error.config.__retriedAfterSessionCheck) {
      // The session is fine, so the 401 was the server's fault: try the request once more.
      error.config.__retriedAfterSessionCheck = true;
      return retryRequest(error);
    }
  }
  // Any status codes that falls outside the range of 2xx cause this function to trigger
  return Promise.reject(error);
}

// `paramsSerializer` is an optional function in charge of serializing `params`
// (e.g. https://www.npmjs.com/package/qs, http://api.jquery.com/jquery.param/)
//   paramsSerializer: function (params) {
//     return Qs.stringify(params, {arrayFormat: 'brackets'})
//   },
// This implemmentation is done to ensure array and object is passed correctly in OMS 1.0
const paramsSerializer = (p: any) => {
  // When objects are stringified, by default they use bracket notation:
  // qs.stringify({ a: { b: { c: 'd', e: 'f' } } });
  // 'a[b][c]=d&a[b][e]=f'
  //We may override this to use dot notation by setting the allowDots option to true:
  // qs.stringify({ a: { b: { c: 'd', e: 'f' } } }, { allowDots: true });
  // 'a.b.c=d&a.b.e=f'
  // OMS 1.0 supports objects passed as strings
  const params = Object.keys(p).reduce((params: any, key: string) => {
    let value = p[key];
    if (typeof value === 'object' && !Array.isArray(value) && value !== null) {
      value = JSON.stringify(value)
    }
    params[key] = value;
    return params;
  }, {})
  // arrayFormat option is used to specify the format of the output array:
  //qs.stringify({ a: ['b', 'c'] }, { arrayFormat: 'indices' })
  // 'a[0]=b&a[1]=c'
  //qs.stringify({ a: ['b', 'c'] }, { arrayFormat: 'brackets' })
  // 'a[]=b&a[]=c'
  //qs.stringify({ a: ['b', 'c'] }, { arrayFormat: 'repeat' })
  // 'a=b&a=c'
  //qs.stringify({ a: ['b', 'c'] }, { arrayFormat: 'comma' })
  // 'a=b,c'
  // Currently OMS 1.0 supports values as repeat
  return qs.stringify(params, { arrayFormat: 'repeat' });
}

axios.interceptors.request.use(requestInterceptor);
axios.interceptors.response.use(responseSuccessInterceptor, responseErrorInterceptor);

const maxAge = import.meta.env.VITE_CACHE_MAX_AGE
  ? parseInt(import.meta.env.VITE_CACHE_MAX_AGE)
  : 0;
const axiosCache = setupCache({
  maxAge: maxAge * 1000
})

/**
 * Generic method to call APIs
 *
 * @param {string}  url - API Url
 * @param {string=} method - 'GET', 'PUT', 'POST', 'DELETE , and 'PATCH'
 * @param {any} [data] - Optional: `data` is the data to be sent as the request body. Only applicable for request methods 'PUT', 'POST', 'DELETE , and 'PATCH'
 * When no `transformRequest` is set, must be of one of the following types:
 * - string, plain object, ArrayBuffer, ArrayBufferView, URLSearchParams
 * - Browser only: FormData, File, Blob
 * - Node only: Stream, Buffer
 * @param {any} [params] - Optional: `params` are the URL parameters to be sent with the request. Must be a plain object or a URLSearchParams object
 * @param {boolean} [cache] - Optional: Apply caching to it
 * @param {boolean} [retry] - Optional: retry on a server or network error. Default: GET / HEAD / OPTIONS only
 * @return {Promise} Response from API as returned by Axios
 */
const api = async (customConfig: any) => {
  // Prepare configuration
  const config: any = {
    url: customConfig.url,
    method: customConfig.method,
    data: customConfig.data,
    params: customConfig.params,
    paramsSerializer
  }

  // Honor the custom headers passed in the api call
  if(customConfig.headers) config["headers"] = { ...config["headers"], ...customConfig["headers"] }

  // if passing responseType in payload then only adding it as responseType
  if (customConfig.responseType) config['responseType'] = customConfig.responseType

  config.baseURL = customConfig.baseURL ? customConfig.baseURL : commonUtil.getMaargURL();

  if (customConfig.cache) config.adapter = axiosCache.adapter;

  // `retry: true` lets a write that is safe to repeat be retried on an outage; `retry: false` turns it off for a read.
  if (customConfig.retry !== undefined) config.retry = customConfig.retry;

  return axios(config);
}

/**
 * Client method to directly pass configuration to axios
 *
 * @param {any}  config - API configuration
 * @return {Promise} Response from API as returned by Axios
 */
const client = (config: any) => {
  return axios.create().request({ paramsSerializer, ...config })
}

export { api as default, client, axios };
