import { createI18n } from "vue-i18n"

let i18n: any

export const translate = (key: string, ...args: any[]) => {
  const params = args[0];
  const message = i18n?.global?.t ? i18n.global.t(key, ...args) : key;

  // vue-i18n already interpolates keys it knows. Only fill placeholders ourselves when the key
  // is missing (message === key), so brace tokens inside parameter values stay literal.
  if (message === key && params && typeof params === "object" && typeof key === "string" && key.includes("{")) {
    return key.replace(/\{(\w+)\}/g, (_, k) => (params[k] !== undefined ? String(params[k]) : `{${k}}`));
  }
  return message;
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

