import { defineStore } from 'pinia';
import 'pinia-plugin-persistedstate';

interface EmbeddedAppState {
  token: {
    value: string;
    expiration: string | number | undefined;
  };
  oms: string;
  maarg: string;
  apiKey: string;
  shop: string;
  host: string;
  shopifyAppBridge: any;
  posContext: {
    locationId: any;
    firstName: string;
    lastName: string;
  };
}

export const useEmbeddedAppStore = defineStore('embeddedApp', {
  state: (): EmbeddedAppState => ({
    token: {
      value: '',
      expiration: undefined
    },
    oms: '',
    maarg: '',
    apiKey: '',
    shop: '',
    host: '',
    shopifyAppBridge: null,
    posContext: {
      locationId: undefined,
      firstName: "",
      lastName: ""
    }
  }),
  getters: {
    getToken: (state: EmbeddedAppState) => state.token.value,
    getTokenExpiration: (state: EmbeddedAppState) => state.token.expiration,
    getOms: (state: EmbeddedAppState) => state.oms,
    getMaarg: (state: EmbeddedAppState) => state.maarg,
    getApiKey: (state: EmbeddedAppState) => state.apiKey,
    getShop: (state: EmbeddedAppState) => state.shop,
    getHost: (state: EmbeddedAppState) => state.host,
    getShopifyAppBridge: (state: EmbeddedAppState) => state.shopifyAppBridge,
    getPosContext: (state: EmbeddedAppState) => state.posContext,
    getPosLocationId: (state: EmbeddedAppState) => state.posContext.locationId,
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