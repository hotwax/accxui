import imagePreview from './directives/imagePreview'
import DxpShopifyImg from "./components/DxpShopifyImg.vue"
import DxpOmsInstanceFooter from "./components/DxpOmsInstanceFooter.vue"
import DxpModal from "./components/DxpModal.vue"
import RadioFacetGroup from "./components/RadioFacetGroup.vue"
import StatCard from "./components/StatCard.vue"
import Sparkline from "./components/Sparkline.vue"
import Login from "./components/Login.vue"
import ShopifyLogin from "./components/ShopifyLogin.vue"
import ShopifyAppInstall from "./components/ShopifyAppInstall.vue"
import FastTravel from "./components/FastTravel.vue"
import { useFastTravel } from './composables/useFastTravel'
import { useModalFlow } from './composables/useModalFlow'
import { openModal } from './utils/modal'
import { getFastTravelApps, getFastTravelApp, buildAppUrl } from './utils/fastTravelRegistry'
import emitter from './core/emitter'
import { commonUtil } from './utils/commonUtil'
import { useSolrSearch } from './composables/useSolrSearch'
import { useProducts } from './composables/useProducts'
import { useShopify } from './composables/useShopify'
import logger from './core/logger'
import { cookieHelper } from './helpers/cookieHelper'
import { moduleFederationUtil } from './utils/moduleFederationUtil'

import api, { client, axios } from './core/remoteApi'

import { createDxpI18n, currentLocale, i18n, setLocale, translate } from './core/i18n'

import { firebaseMessaging } from './core/firebaseMessaging'
import { useNotificationStore } from './store/notification'
import { useEmbeddedAppStore } from './store/embeddedApp'
import { initialiseConfig } from './core/configRegistry'
import { onSessionCleared, clearSessionScopedState } from './core/sessionScope'
import { useAuth } from './composables/useAuth'

// ✅ These are pure types (erased during build)
export { api, client, axios }

export {
  commonUtil,
  cookieHelper,
  createDxpI18n,
  DxpModal,
  DxpOmsInstanceFooter,
  DxpShopifyImg,
  emitter,
  firebaseMessaging,
  currentLocale,
  i18n,
  imagePreview,
  initialiseConfig,
  onSessionCleared,
  clearSessionScopedState,
  logger,
  Login,
  RadioFacetGroup,
  Sparkline,
  StatCard,
  ShopifyLogin,
  ShopifyAppInstall,
  FastTravel,
  useFastTravel,
  useModalFlow,
  openModal,
  getFastTravelApps,
  getFastTravelApp,
  buildAppUrl,
  moduleFederationUtil,
  useSolrSearch,
  useProducts,
  useShopify,
  setLocale,
  translate,
  useNotificationStore,
  useEmbeddedAppStore,
  useAuth
}

export type { ModalAlert, ModalFlow, ModalFlowOptions } from './composables/useModalFlow';

export * from './db';
