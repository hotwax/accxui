import imagePreview from './directives/imagePreview'
import DxpShopifyImg from "./components/DxpShopifyImg.vue"
import emitter from './core/emitter'
import { commonUtil } from './utils/commonUtil'

import api, { client, axios, initialise, getConfig, resetConfig } from './core/remoteApi'

import { createDxpI18n, i18n, translate } from './core/i18n'

import { firebaseMessaging } from './core/firebaseMessaging'
import { useNotificationStore } from './store/notification'

// ✅ These are pure types (erased during build)
export { api, client, axios, initialise, getConfig, resetConfig }

export {
  createDxpI18n,
  i18n,
  imagePreview,
  translate,
  DxpShopifyImg,
  emitter,
  commonUtil,
  firebaseMessaging,
  useNotificationStore
}
