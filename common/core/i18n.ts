import { createI18n } from "vue-i18n"

let i18n: any
let translate: any

function findBestLocale(supportedLocales: string[]): string | null {
  for (const locale of navigator.languages) {
    const normLocale = locale.toLowerCase();
    const exactMatch = supportedLocales.find(s => s.toLowerCase() === normLocale);
    if (exactMatch) return exactMatch;

    const baseLang = normLocale.split(‘-’)[0];
    const prefixMatch = supportedLocales.find(s => s.split(‘-’)[0].toLowerCase() === baseLang);
    if (prefixMatch) return prefixMatch;
  }
  return null;
}

// Factory function to initialize with app’s locales
export function createDxpI18n(localeMessages: Record<string, any>) {
  const supportedLocales = Object.keys(localeMessages);
  const navigatorLocale = findBestLocale(supportedLocales);
  const defaultFallback = import.meta.env.VITE_I18N_FALLBACK_LOCALE || ‘en-US’;

  const selectedLocale = navigatorLocale || defaultFallback;

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
