import { createPinia } from 'pinia'
import piniaPluginPersistedstate from 'pinia-plugin-persistedstate'
import { getTelecomCountryCode, hasError, isError } from './utils'

import {
  DxpAppVersionInfo,
  DxpFacilitySwitcher,
  DxpGitBookSearch,
  DxpImage,
  DxpLanguageSwitcher,
  DxpLogin,
  DxpMenuFooterNavigation,
  DxpOmsInstanceNavigator,
  DxpPagination,
  DxpProductIdentifier,
  DxpProductStoreSelector,
  DxpShopifyImg,
  DxpTimeZoneSwitcher,
  DxpUserProfile
} from './components'

import { useAuthStore } from './store/auth'
import { useUserStore } from './store/user'
import { useFirebaseNotificationStore } from './store/firebaseNotification'
import { useProductIdentificationStore } from './store/productIdentification'

import { useFormValidator } from './composables/useFormValidation'
import { useFieldValidator } from './composables/useFieldValidation'

import imagePreview from './directives/imagePreview'

import { goToOms, getProductIdentificationValue, getAppLoginUrl } from './utils'
import { initialiseFirebaseApp } from './utils/firebase'
import { hasPermission } from './utils'

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

export {
  // --- Stores ---
  useAuthStore,
  useUserStore,
  useFirebaseNotificationStore,
  useProductIdentificationStore,

  // --- Components ---
  DxpAppVersionInfo,
  DxpFacilitySwitcher,
  DxpGitBookSearch,
  DxpImage,
  DxpLanguageSwitcher,
  DxpLogin,
  DxpMenuFooterNavigation,
  DxpOmsInstanceNavigator,
  DxpPagination,
  DxpProductIdentifier,
  DxpProductStoreSelector,
  DxpShopifyImg,
  DxpTimeZoneSwitcher,
  DxpUserProfile,

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
