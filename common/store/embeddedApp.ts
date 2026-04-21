import { defineStore } from 'pinia';
import 'pinia-plugin-persistedstate'

export const useEmbeddedAppStore = defineStore('embeddedApp', {

  state: () => ({
    token: {
      value: '',
      expiration: undefined as string | number | undefined
    },
    oms: '',
    maarg: '',
    apiKey: '',
    shop: '',
    host: '',
    shopifyAppBridge: null as any,
    posContext: {
      locationId: undefined,
      firstName: "",
      lastName: ""
    }
  }),
  getters: {
    getToken: (state) => state.token.value,
    getTokenExpiration: (state) => state.token.expiration,
    getOms: (state) => state.oms,
    getMaarg: (state) => state.maarg,
    getApiKey: (state) => state.apiKey,
    getShop: (state) => state.shop,
    getHost: (state) => state.host,
    getShopifyAppBridge: (state) => state.shopifyAppBridge,
    getPosContext: (state) => state.posContext,
    getPosLocationId: (state) => state.posContext.locationId,
  },
  actions: {
    setToken(token: string) {
      this.token.value = token;
    },
    setOms(oms: string) {
      this.oms = oms;
    },
    setMaarg(maarg: string) {
      this.maarg = maarg;
    },
    setApiKey(apiKey: string) {
      this.apiKey = apiKey;
    },
    setShop(shop: string) {
      this.shop = shop;
    },
    setHost(host: string) {
      this.host = host;
    },
    setShopifyAppBridge(shopifyAppBridge: any) {
      this.shopifyAppBridge = shopifyAppBridge;
    },
    setPosContext(posContext: any) {
      this.posContext = posContext;
    },
    setTokenExpiration(expiration: string | number | undefined) {
      this.token.expiration = expiration;
    }
  },
  persist: true
});