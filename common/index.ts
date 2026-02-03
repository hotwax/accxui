import { createPinia } from 'pinia'
import piniaPluginPersistedstate from 'pinia-plugin-persistedstate'
import { getTelecomCountryCode, hasError, isError } from './utils/commonUtil'

import { useAuthStore } from './store/auth'
import { useUserStore } from './store/user'
import { useFirebaseNotificationStore } from './store/firebaseNotification'
import { useProductIdentificationStore } from './store/productIdentification'
import { userApi } from './api/userApi'

import { useFormValidator } from './composables/useFormValidation'
import { useFieldValidator } from './composables/useFieldValidation'

import imagePreview from './directives/imagePreview'

import { goToOms, getProductIdentificationValue, getAppLoginUrl } from './utils/commonUtil'
import { initialiseFirebaseApp } from './utils/firebaseUtil'
import { hasPermission } from './utils/commonUtil'
import api, { apiClient, client, axios } from './core/remoteApi'

// --- Optional helpers for host apps ---
const createDxpPinia = () => {
  const pinia = createPinia()
  pinia.use(piniaPluginPersistedstate)
  return pinia
}

const updateToken = (token: string, expiration?: number) => {
  const authStore = useAuthStore()
  authStore.token = {
    value: token,
    expiration: expiration ?? authStore.token.expiration
  }
}

const updateInstanceUrl = (oms: string) => {
  const authStore = useAuthStore()
  authStore.oms = oms
}

const logout = () => userApi.logout()

import { createDxpI18n, i18n, translate } from './core/i18n'

export { OPERATOR, STATUSCOLOR, events } from './api/types'

// ✅ These are pure types (erased during build)
export type { Product, Response, Stock, Order, OrderItem, OrderPart, User } from './api/types'
export * from './api/gitBookApi'
export * from './api/notificationApi'
export * from './api/orderApi'
export * from './api/productApi'
export * from './api/stockApi'
export * from './api/userApi'
export { api, apiClient, client, axios }

export { default as DxpAppVersionInfo } from './components/DxpAppVersionInfo.vue';
export { default as DxpFacilitySwitcher } from './components/DxpFacilitySwitcher.vue'
export { default as DxpGitBookSearch } from './components/DxpGitBookSearch.vue';
export { default as DxpImage } from './components/DxpImage.vue';
export { default as DxpLanguageSwitcher } from './components/DxpLanguageSwitcher.vue';
export { default as DxpLogin } from './components/DxpLogin.vue';
export { default as DxpMenuFooterNavigation } from './components/DxpMenuFooterNavigation.vue';
export { default as DxpOmsInstanceNavigator } from './components/DxpOmsInstanceNavigator.vue'
export { default as DxpPagination } from './components/DxpPagination.vue'
export { default as DxpProductIdentifier } from "./components/DxpProductIdentifier.vue";
export { default as DxpProductStoreSelector } from "./components/DxpProductStoreSelector.vue"
export { default as DxpShopifyImg } from './components/DxpShopifyImg.vue';
export { default as DxpUserProfile } from './components/DxpUserProfile.vue'
export { default as DxpTimeZoneSwitcher } from './components/DxpTimeZoneSwitcher.vue'


export {
  // --- Stores ---
  useAuthStore,
  useUserStore,
  useFirebaseNotificationStore,
  useProductIdentificationStore,

  // --- Composables ---
  useFormValidator,
  useFieldValidator,

  // --- Directives ---
  imagePreview,

  // --- Utils ---
  goToOms,
  getProductIdentificationValue,
  getAppLoginUrl,
  initialiseFirebaseApp,
  hasPermission,

  // --- Setup Helpers ---
  createDxpPinia,
  createDxpI18n, 
  i18n, 
  translate,
  updateToken,
  updateInstanceUrl,
  logout,

  getTelecomCountryCode,
  hasError,
  isError
}
