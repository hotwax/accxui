import { createI18n } from "vue-i18n"

let i18n: any

export const translate = (key: string, ...args: any[]) => {
  if (i18n?.global?.t) {
    return i18n.global.t(key, ...args);
  }
  return key;
};

function findBestLocale(supportedLocales: string[]): string | null {
  if (typeof navigator === "undefined" || !navigator.languages) return null;
  for (const locale of navigator.languages) {
    const exactMatch = supportedLocales.find(s => s.toLowerCase() === locale.toLowerCase());
    if (exactMatch) return exactMatch;
  }
  return null;
}

// Factory function to initialize with app's locales
export function createDxpI18n(localeMessages: Record<string, any>) {
  const supportedLocales = Object.keys(localeMessages);
  const navigatorLocale = findBestLocale(supportedLocales);
  const defaultFallback = import.meta.env.VITE_I18N_FALLBACK_LOCALE || 'en-US';

  const selectedLocale = navigatorLocale || defaultFallback;

  i18n = createI18n({
    legacy: false,
    locale: selectedLocale,
    fallbackLocale: defaultFallback,
    messages: localeMessages
  })

  return i18n
}

export { i18n }

