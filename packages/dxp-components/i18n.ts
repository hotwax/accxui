import { createI18n } from "vue-i18n"

let i18n: any
let translate: any

// Factory function to initialize with app’s locales
export function createDxpI18n(localeMessages: Record<string, any>) {
  i18n = createI18n({
    legacy: false,
    locale: import.meta.env.VITE_VUE_APP_I18N_LOCALE || 'en-US',
    fallbackLocale: import.meta.env.VITE_VUE_APP_I18N_FALLBACK_LOCALE || 'en-US',
    messages: localeMessages
  })

  translate = i18n.global.t
  return i18n
}

export { i18n, translate }
