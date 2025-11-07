import api, { apiClient, client, getConfig, init, initialise, resetConfig, updateToken, updateInstanceUrl } from './api'
import { getTelecomCountryCode, hasError, isError } from './util'
import {
  askQuery,
  getAvailableTimeZones,
  getGitBookPage,
  getNotificationEnumIds,
  getNotificationUserPrefTypeIds,
  getUserFacilities,
  fetchGoodIdentificationTypes,
  fetchProducts,
  fetchProductsGroupedBy,
  fetchProductsGroupedByParent,
  fetchProductsStock,
  fetchProductsStockAtFacility,
  getEComStoresByFacility,
  getEComStores,
  getOrderDetails,
  getProductIdentificationPref,
  getProfile,
  logout,
  removeClientRegistrationToken,
  searchQuery,
  setProductIdentificationPref,
  storeClientRegistrationToken,
  subscribeTopic,
  unsubscribeTopic,
  updateOrderStatus,
  getUserPreference,
  setUserPreference,
  setUserLocale,
  setUserTimeZone,
  loginShopifyAppUser
} from './modules'

// ✅ Runtime exports
export {
  api,
  apiClient,
  askQuery,
  client,
  getOrderDetails,
  updateOrderStatus,
  fetchGoodIdentificationTypes,
  fetchProducts,
  fetchProductsGroupedBy,
  fetchProductsGroupedByParent,
  getAvailableTimeZones,
  getEComStoresByFacility,
  getEComStores,
  getGitBookPage,
  getNotificationEnumIds,
  getNotificationUserPrefTypeIds,
  getConfig,
  getTelecomCountryCode,
  logout,
  hasError,
  init,
  initialise,
  isError,
  resetConfig,
  updateToken,
  updateInstanceUrl,
  fetchProductsStock,
  fetchProductsStockAtFacility,
  getProductIdentificationPref,
  getProfile,
  setProductIdentificationPref,
  getUserFacilities,
  removeClientRegistrationToken,
  searchQuery,
  storeClientRegistrationToken,
  subscribeTopic,
  unsubscribeTopic,
  getUserPreference,
  setUserPreference,
  setUserLocale,
  setUserTimeZone,
  loginShopifyAppUser,
}

// ✅ These are runtime values (not erased)
export {
  OPERATOR,
  STATUSCOLOR,
  events
} from './types'

// ✅ These are pure types (erased during build)
export type {
  Product,
  Response,
  Stock,
  Order,
  OrderItem,
  OrderPart,
  User
} from './types'
