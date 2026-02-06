import { useFormValidator } from './composables/useFormValidation'
import { useFieldValidator } from './composables/useFieldValidation'

import imagePreview from './directives/imagePreview'

import { getTelecomCountryCode, hasError, isError, goToOms, hasPermission } from './utils/commonUtil'
import api, { client, axios, initialise, getConfig, updateToken, updateInstanceUrl, resetConfig } from './core/remoteApi'

import { createDxpI18n, i18n, translate } from './core/i18n'

// ✅ These are pure types (erased during build)
export { api, client, axios, initialise, getConfig, updateToken, updateInstanceUrl, resetConfig }

export {
  createDxpI18n,
  getTelecomCountryCode,
  goToOms,
  hasError,
  hasPermission,
  i18n,
  imagePreview,
  isError,
  translate,
  useFieldValidator,
  useFormValidator
}
