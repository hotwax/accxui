import { createPinia } from 'pinia'
import piniaPluginPersistedstate from 'pinia-plugin-persistedstate'
import { getTelecomCountryCode, hasError, isError } from './utils/commonUtil'

import { useAuthStore } from './store/auth'
import { useUserStore } from './store/user'
import { useFirebaseNotificationStore } from './store/firebaseNotification'
import { useProductIdentificationStore } from './store/productIdentification'

import { useFormValidator } from './composables/useFormValidation'
import { useFieldValidator } from './composables/useFieldValidation'

import imagePreview from './directives/imagePreview'

import { goToOms, getProductIdentificationValue, getAppLoginUrl } from './utils/commonUtil'
import { initialiseFirebaseApp } from './utils/firebaseUtil'
import { hasPermission } from './utils/commonUtil'

import './service-worker'

// --- Optional helpers for host apps ---
const createDxpPinia = () => {
  const pinia = createPinia()
  pinia.use(piniaPluginPersistedstate)
  return pinia
}

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

export { default as DxpAppVersionInfo } from './DxpAppVersionInfo.vue';
export { default as DxpFacilitySwitcher } from './DxpFacilitySwitcher.vue'
export { default as DxpGitBookSearch } from './DxpGitBookSearch.vue';
export { default as DxpImage } from './DxpImage.vue';
export { default as DxpLanguageSwitcher } from './DxpLanguageSwitcher.vue';
export { default as DxpLogin } from './DxpLogin.vue';
export { default as DxpMenuFooterNavigation } from './DxpMenuFooterNavigation.vue';
export { default as DxpOmsInstanceNavigator } from './DxpOmsInstanceNavigator.vue'
export { default as DxpPagination } from './DxpPagination.vue'
export { default as DxpProductIdentifier } from "./DxpProductIdentifier.vue";
export { default as DxpProductStoreSelector } from "./DxpProductStoreSelector.vue"
export { default as DxpShopifyImg } from './DxpShopifyImg.vue';
export { default as DxpUserProfile } from './DxpUserProfile.vue'
export { default as DxpTimeZoneSwitcher } from './DxpTimeZoneSwitcher.vue'


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

  getTelecomCountryCode,
  hasError,
  isError
}
