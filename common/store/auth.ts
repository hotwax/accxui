import { defineStore } from "pinia";
import { DateTime } from 'luxon'

export const useAuthStore = defineStore('userAuth', {
  state: () => {
    return {
      token: {
        value: '',
        expiration: undefined
      },
      oms: '',
      isEmbedded: false,
      shop: undefined,
      host: undefined,
    }
  },
  getters: {
    getToken: (state) => state.token,
    getOms: (state) => state.oms,
    getBaseUrl: (state) => {
      let baseURL = state.oms
      if (baseURL) return baseURL.startsWith('http') ? baseURL.includes('/rest/s1') ? baseURL : `${baseURL}/rest/s1/` : `https://${baseURL}.hotwax.io/rest/s1/`;

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
