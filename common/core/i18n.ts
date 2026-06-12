import { createI18n } from "vue-i18n"
import { cookieHelper } from "../helpers/cookieHelper"

let i18n: any
let translate: any

function findBestLocale(supportedLocales: string[]): string | null {
  if (typeof navigator === 'undefined') return null;
  const rawLocales = navigator.languages && navigator.languages.length > 0
    ? navigator.languages
    : [navigator.language];
  const userLocales = rawLocales.filter((l): l is string => typeof l === 'string' && l.length > 0);
  for (const locale of userLocales) {
    const normLocale = locale.toLowerCase();
    const exactMatch = supportedLocales.find(s => s.toLowerCase() === normLocale);
    if (exactMatch) return exactMatch;

    const baseLang = normLocale.split('-')[0];
    const prefixMatch = supportedLocales.find(s => s.split('-')[0].toLowerCase() === baseLang);
    if (prefixMatch) return prefixMatch;
  }
  return null;
}

// Factory function to initialize with app’s locales
export function createDxpI18n(localeMessages: Record<string, any>) {
  const cookie = cookieHelper();
  const savedLocale = typeof document !== 'undefined' ? cookie.get('locale') : null;
  const envLocale = import.meta.env.VITE_I18N_LOCALE;
  const supportedLocales = Object.keys(localeMessages);
  const navigatorLocale = findBestLocale(supportedLocales);
  const defaultFallback = import.meta.env.VITE_I18N_FALLBACK_LOCALE || 'en-US';

  const selectedLocale = savedLocale || envLocale || navigatorLocale || defaultFallback;

  i18n = createI18n({
    legacy: false,
    locale: selectedLocale,
    fallbackLocale: defaultFallback,
    messages: localeMessages
  })

  translate = i18n.global.t
  return i18n
}

export { i18n, translate }
