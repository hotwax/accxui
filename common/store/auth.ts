import { defineStore } from "pinia";
import { DateTime } from 'luxon'
const SYSTEM_TYPE = import.meta.env.VITE_SYSTEM_TYPE || "OFBIZ";

export const useAuthStore = defineStore('userAuth', {
  state: () => {
    return {
      token: {
        value: '',
        expiration: undefined
      },
      oms: '',
      maarg: '',
      isEmbedded: false,
      shop: undefined,
      host: undefined,
    }
  },
  getters: {
    getToken: (state) => state.token,
    getOms: (state) => state.oms,
    getBaseUrl: (state) => {
      if (SYSTEM_TYPE === "MOQUI") {
        const baseURL = state.maarg
        if (baseURL) return baseURL.startsWith('http') ? baseURL.includes('/rest/s1') ? baseURL : `${baseURL}/rest/s1/` : `https://${baseURL}.hotwax.io/rest/s1/`;
      } else {
        const baseURL = state.oms
        if (baseURL) return baseURL.startsWith('http') ? baseURL.includes('/api') ? baseURL : `${baseURL}/api/` : `https://${baseURL}.hotwax.io/api/`;
      }
      return "";
    },
    isAuthenticated: (state) => {
      let isTokenExpired = false
      if (state.token.expiration) {
        const currTime = DateTime.now().toMillis()
        isTokenExpired = state.token.expiration < currTime
      }
      return state.token.value && !isTokenExpired
    }
  },
  persist: true
})
