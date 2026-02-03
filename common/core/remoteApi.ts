import axios from 'axios';
import { StatusCodes } from 'http-status-codes';
import { setupCache } from 'axios-cache-adapter'
import qs from "qs"
import { useAuthStore } from '../store/auth';
const SYSTEM_TYPE = import.meta.env.VITE_SYSTEM_TYPE || "OFBIZ";

const requestInterceptor = async (config: any) => {
  if (useAuthStore().token.value) {
    config.headers["Authorization"] =  "Bearer " + useAuthStore().token.value;
    config.headers['Content-Type'] = 'application/json';
  }
  return config;
}

const responseSuccessInterceptor = (response: any) => {
  // Any status code that lie within the range of 2xx cause this function to trigger
  return response;
}

const responseErrorInterceptor = (error: any) => {
  // As we have yet added support for logout on unauthorization hence emitting unauth event only in case of ofbiz app
  if (error.response && SYSTEM_TYPE === "OFBIZ") {
      // TODO Handle case for failed queue request
      const { status } = error.response;
      if (status == StatusCodes.UNAUTHORIZED) {
        //TODO: Need to call apps logout here
      }
  }
  // Any status codes that falls outside the range of 2xx cause this function to trigger
  // Do something with response error
  return Promise.reject(error);
}

const responseClientErrorInterceptor = (error: any) => {
  // As we have yet added support for logout on unauthorization hence emitting unauth event only in case of ofbiz app
  if (error.response && SYSTEM_TYPE === "MOQUI") {
      // TODO Handle case for failed queue request
      const { status } = error.response;
      if (status == StatusCodes.UNAUTHORIZED) {
        //TODO: Need to call apps logout here
      }
  }
  // Any status codes that falls outside the range of 2xx cause this function to trigger
  // Do something with response error
  return Promise.reject(error);
}

const interceptor = {
  request: requestInterceptor,
  response: {
    success: responseSuccessInterceptor,
    error: responseErrorInterceptor
  }
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
      if ( typeof value === 'object' && !Array.isArray(value) && value !== null) {
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
  return qs.stringify(params, {arrayFormat: 'repeat'});
}

axios.interceptors.request.use(interceptor.request);

axios.interceptors.response.use(interceptor.response.success, interceptor.response.error);

const maxAge = import.meta.env.VITE_VUE_APP_CACHE_MAX_AGE
  ? parseInt(import.meta.env.VITE_VUE_APP_CACHE_MAX_AGE)
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
 *  @param {boolean} [queue] - Optional: Apply offline queueing to it
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

    // if passing responseType in payload then only adding it as responseType
    if (customConfig.responseType) config['responseType'] = customConfig.responseType

    config.baseURL = useAuthStore().getBaseUrl;
    if (customConfig.cache) config.adapter = axiosCache.adapter;

    if (customConfig.queue) {
        if (!config.headers) config.headers = { ...axios.defaults.headers.common, ...config.headers };

        if (config.events.queueTask) {
          config.events.queueTask ({
            callbackEvent: customConfig.callbackEvent,
            payload: config
          })
        }
    } else {
        return axios(config);
    }
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

/**
 * Client method to directly pass configuration to axios
 * This method uses the response interceptors to handle the responses correctly
 *
 * @param {any}  config - API configuration
 * @return {Promise} Response from API as returned by Axios
 */
const apiClient = (config: any) => {
  const axiosClient = axios.create()
  axiosClient.interceptors.response.use(interceptor.response.success, responseClientErrorInterceptor);
  return axiosClient.request({ paramsSerializer, ...config })
}

export { api as default, apiClient, client, axios };
