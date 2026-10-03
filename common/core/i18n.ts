import { watchEffect } from "vue"
import { createI18n } from "vue-i18n"
import { cookieHelper } from "../helpers/cookieHelper"

let i18n: any

// The language a user picks is kept in this cookie; in production it is shared across HotWax apps.
const LOCALE_COOKIE = "locale"
const ONE_YEAR = 60 * 60 * 24 * 365

/** The language the app is showing, such as "en-US" or "es-ES". */
export const currentLocale = (): string | undefined => {
  const locale = i18n?.global?.locale

  return (typeof locale === "string" ? locale : locale?.value) || undefined
}

const formatCount = (count: number) => {
  try {
    return new Intl.NumberFormat(currentLocale()).format(count)
  } catch {
    // An app can name a locale Intl does not know; show the count in the default format rather than fail.
    return new Intl.NumberFormat().format(count)
  }
}

/**
 * Translates a key. A numeric `count` picks the plural form and is shown in the current
 * language, so "{count} orders" reads "1,204 orders" in English and "12.000 pedidos" in Spanish.
 */
export const translate = (key: string, ...args: any[]) => {
  if(!i18n?.global?.t) {return key}

  const [named, options] = args
  if(named && typeof named === "object" && !Array.isArray(named) && typeof named.count === "number" && Number.isFinite(named.count)) {
    const display = { ...named, count: formatCount(named.count) }

    // t(key, named, plural) chooses the form from the number while showing the formatted count.
    return options && typeof options === "object"
      ? i18n.global.t(key, display, { ...options, plural: named.count })
      : i18n.global.t(key, display, named.count)
  }

  return i18n.global.t(key, ...args)
}

function findBestLocale(supportedLocales: string[]): string | null {
  if (typeof navigator === "undefined" || !navigator.languages) return null;
  for (const locale of navigator.languages) {
    const exactMatch = supportedLocales.find(s => s.toLowerCase() === locale.toLowerCase());
    if (exactMatch) return exactMatch;
  }
  return null;
}

/** Shows the app in this language and keeps it for the next visit. */
export function setLocale(locale: string) {
  if(!i18n) {return}
  i18n.global.locale.value = locale
  cookieHelper().set(LOCALE_COOKIE, locale, ONE_YEAR)
}

// Factory function to initialize with app's locales
export function createDxpI18n(localeMessages: Record<string, any>) {
  const supportedLocales = Object.keys(localeMessages);
  const savedLocale = typeof document === "undefined" ? null : cookieHelper().get(LOCALE_COOKIE);
  const navigatorLocale = findBestLocale(supportedLocales);
  const defaultFallback = import.meta.env.VITE_I18N_FALLBACK_LOCALE || 'en-US';

  const selectedLocale = (savedLocale && supportedLocales.includes(savedLocale) ? savedLocale : null) || navigatorLocale || defaultFallback;

  i18n = createI18n({
    legacy: false,
    locale: selectedLocale,
    fallbackLocale: defaultFallback,
    messages: localeMessages
  })

  // Screen readers, spellcheck and hyphenation read <html lang>, so it follows the app's language.
  if(typeof document !== "undefined") {
    watchEffect(() => { document.documentElement.lang = i18n.global.locale.value })
  }

  return i18n
}

export { i18n }
