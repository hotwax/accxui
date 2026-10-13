import { createI18n } from "vue-i18n"

let i18n: any

export const translate = (key: string, ...args: any[]) => {
  let message = key;
  if (i18n?.global?.t) {
    message = i18n.global.t(key, ...args);
  }
  if (args[0] && typeof args[0] === "object" && typeof message === "string" && message.includes("{")) {
    message = message.replace(/\{(\w+)\}/g, (_, k) => (args[0][k] !== undefined ? String(args[0][k]) : `{${k}}`));
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

