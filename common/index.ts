import imagePreview from './directives/imagePreview'
import DxpShopifyImg from "./components/DxpShopifyImg.vue"
import emitter from './core/emitter'
import { commonUtil } from './utils/commonUtil'
import { useSolrSearch } from './composables/useSolrSearch'
import logger from './core/logger'
import { cookieHelper } from './helpers/cookieHelper'
import { moduleFederationUtil } from './utils/moduleFederationUtil'

import api, { client, axios, initialise, getConfig, resetConfig } from './core/remoteApi'

import { createDxpI18n, i18n, translate } from './core/i18n'

import { firebaseMessaging } from './core/firebaseMessaging'
import { useNotificationStore } from './store/notification'
import ShopifyService from './core/ShopifyService'

// ✅ These are pure types (erased during build)
export { api, client, axios, initialise, getConfig, resetConfig }

export {
  commonUtil,
  cookieHelper,
  createDxpI18n,
  DxpShopifyImg,
  emitter,
  firebaseMessaging,
  i18n,
  imagePreview,
  logger,
  moduleFederationUtil,
  useSolrSearch,
  ShopifyService,
  translate,
  useNotificationStore
}
