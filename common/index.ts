import imagePreview from './directives/imagePreview'
import DxpShopifyImg from "./components/DxpShopifyImg.vue"
import Login from "./components/Login.vue"
import emitter from './core/emitter'
import { commonUtil } from './utils/commonUtil'
import { useSolrSearch } from './composables/useSolrSearch'
import { useShopify } from './composables/useShopify'
import logger from './core/logger'
import { cookieHelper } from './helpers/cookieHelper'
import { moduleFederationUtil } from './utils/moduleFederationUtil'

import api, { client, axios, initialise, getConfig, resetConfig } from './core/remoteApi'

import { createDxpI18n, i18n, translate } from './core/i18n'

import { firebaseMessaging } from './core/firebaseMessaging'
import { useNotificationStore } from './store/notification'
import { useEmbeddedAppStore } from './store/embeddedApp'
import { initialiseConfig } from './core/configRegistry'
import { useAuth } from './composables/auth'

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
  initialiseConfig,
  logger,
  Login,
  moduleFederationUtil,
  useSolrSearch,
  useShopify,
  translate,
  useNotificationStore,
  useEmbeddedAppStore,
  useAuth
}
