import { defineStore } from "pinia";
import { i18n, translate, useAuthStore } from "../index";
import { DateTime } from "luxon";
import { showToast } from "../utils/commonUtil";
import { userApi } from '../index'

export const useUserStore = defineStore('user', {
  state: () => {
    return {
      oms: '',
      token: {
        value: '',
        expiration: undefined
      },
      permissions: [] as any,
      current: {} as any,
      instanceUrl: '',
      eComStores: [] as any,
      currentEComStore: {} as any,
      localeOptions: import.meta.env.VITE_VUE_APP_LOCALES ? JSON.parse(import.meta.env.VITE_VUE_APP_LOCALES) : { "en-US": "English" },
      locale: 'en-US',
      currentTimeZoneId: '',
      timeZones: [] as any,
      facilities: [],
      currentFacility: {} as any,
      pwaState: {
        updateExists: false,
        registration: null,
      },
      shopifyConfigs: [] as any,
      currentShopifyConfig: {} as any
    }
  },
  getters: {
    getLocale: (state) => state.locale,
    getLocaleOptions: (state) => state.localeOptions,
    getTimeZones: (state) => state.timeZones,
    getCurrentTimeZone: (state) => state.currentTimeZoneId,
    getFacilites: (state) => state.facilities,
    getCurrentFacility: (state) => state.currentFacility,
    getProductStores: (state) => state.eComStores,
    getCurrentEComStore: (state) => state.currentEComStore,
    getPwaState(state) {
        return state.pwaState;
    },
    getUserProfile (state) {
        return state.current
    },
    getShopifyConfigs(state) {
      return state.shopifyConfigs
    },
    getCurrentShopifyConfig(state) {
      return state.currentShopifyConfig
    }
  },
  actions: {
    setUserInstanceUrl (payload: any){
      this.instanceUrl = payload;
    },

    updatePwaState(payload: any) {
      this.pwaState.registration = payload.registration;
      this.pwaState.updateExists = payload.updateExists;
    },
    async setLocale(locale: string) {
      let newLocale, matchingLocale
      newLocale = this.locale
      // handling if locale is not coming from userProfile
      try {
        const userProfile = this.getUserProfile
        if (locale) {
          matchingLocale = Object.keys(this.localeOptions).find((option: string) => option === locale)
          // If exact locale is not found, try to match the first two characters i.e primary code
          matchingLocale = matchingLocale || Object.keys(this.localeOptions).find((option: string) => option.slice(0, 2) === locale.slice(0, 2))
          newLocale = matchingLocale || this.locale
          // update locale in state and globally
          await userApi.setUserLocale({ userId: userProfile.userId, newLocale })
        }
      } catch (error) {
        console.error(error)
      } finally {
        i18n.global.locale.value = newLocale
        this.locale = newLocale
      }
    },
    async setUserTimeZone(tzId: string) {
      // Do not make any api call if the user clicks the same timeZone again that is already selected
      if(this.currentTimeZoneId === tzId) {
        return;
      }

      try {
        const userProfile = this.getUserProfile

        await userApi.setUserTimeZone({ userId: userProfile.userId, tzId })
        this.currentTimeZoneId = tzId

        showToast(translate("Time zone updated successfully"));
        return Promise.resolve(tzId)
      } catch(err) {
        console.error('Error', err)
        return Promise.reject('')
      }
    },
    async getAvailableTimeZones() {
      // Do not fetch timeZones information, if already available
      if(this.timeZones.length) {
        return;
      }

      try {
        const resp = await userApi.getAvailableTimeZones()
        this.timeZones = resp.filter((timeZone: any) => DateTime.local().setZone(timeZone.id).isValid);
      } catch(err) {
        console.error('Error', err)
      }
    },
    updateTimeZone(tzId: string) {
      this.currentTimeZoneId = tzId
    },
    // Facility api calls - retrieve user facilities & get/set preferred facility
    async getUserFacilities(partyId: any, facilityGroupId: any, isAdminUser: boolean, payload = {}) {
      const authStore = useAuthStore();

      try {
        const response = await userApi.getUserFacilities(authStore.getToken.value, authStore.getBaseUrl, partyId, facilityGroupId, isAdminUser, payload);
        this.facilities = response;
      } catch (error) {
        console.error(error);
      }
      return this.facilities
    },
    async getFacilityPreference(userPrefTypeId: any, userId = "") {
      const authStore = useAuthStore();

      if (!this.facilities.length) {
        return;
      }
      let preferredFacility = this.facilities[0];
   
      try {
        let preferredFacilityId = await userApi.getUserPreference(authStore.getToken.value, authStore.getBaseUrl, userPrefTypeId, userId);
        if(preferredFacilityId) {
          const facility = this.facilities.find((facility: any) => facility.facilityId == preferredFacilityId);
          facility && (preferredFacility = facility)
        }
      } catch (error) {
        console.error(error);
      }
      this.currentFacility = preferredFacility;
    },
    async setFacilityPreference(payload: any) {
      const userProfile = this.getUserProfile

      try {
        await userApi.setUserPreference({
          userPrefTypeId: 'SELECTED_FACILITY',
          userPrefValue: payload.facilityId,
          userId: userProfile.userId
        }) 
      } catch (error) {
        console.error('error', error)
      }
      this.currentFacility = payload;
    },
    // ECom store api calls - fetch stores by facility & get/set user store preferences
    async getEComStoresByFacility(facilityId?: any) {
      const authStore = useAuthStore();
    
      try {
        const response = await userApi.getEComStoresByFacility(authStore.getToken.value, authStore.getBaseUrl, 100, facilityId);
        this.eComStores = response;
      } catch (error) {
        console.error(error);
      }
      return this.eComStores
    },
    async getEComStores() {
      const authStore = useAuthStore();
    
      try {
        const response = await userApi.getEComStores(authStore.getToken.value, authStore.getBaseUrl, 100);
        this.eComStores = response;
      } catch (error) {
        console.error(error);
      }
      return this.eComStores
    },
    async getEComStorePreference(userPrefTypeId: any, userId = "") {
      const authStore = useAuthStore();

      if(!this.eComStores.length) {
        return;
      }
      let preferredStore = this.eComStores[0];
      try {
        let preferredStoreId = await userApi.getUserPreference(authStore.getToken.value, authStore.getBaseUrl, userPrefTypeId, userId);

        if(preferredStoreId) {
          const store = this.eComStores.find((store: any) => store.productStoreId === preferredStoreId);
          store && (preferredStore = store)
        }
      } catch (error) {
        console.error(error);
      }
      this.currentEComStore = preferredStore;
    },
    async setEComStorePreference(payload: any) {
      const userProfile = this.getUserProfile

      try {
        await userApi.setUserPreference({
          userPrefTypeId: 'SELECTED_BRAND',
          userPrefValue: payload.productStoreId,
          userId: userProfile.userId
        }) 
      } catch (error) {
        console.error('error', error)
      }
      this.currentEComStore = payload;
    }
  },
  persist: true
})
