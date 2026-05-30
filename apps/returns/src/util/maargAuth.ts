import { cookieHelper, useEmbeddedAppStore } from "@common";

/**
 * Source the Maarg `api_key` (UserLoginKey) for this Moqui build, which authenticates ONLY via the
 * `api_key` header — Bearer JWT is not wired, so calls without this header get a 403. Order:
 * a login-captured key from the embedded-app store, then an `api_key` cookie, then the
 * demo-provisioned env key (VITE_RETURNS_API_KEY).
 *
 * Used by every Maarg call: the returns data adapter (omsAdapter) and the user-profile fetch.
 */
export function maargApiKey(): string {
  try {
    const fromStore = useEmbeddedAppStore().getApiKey;
    if (fromStore) return fromStore;
  } catch { /* pinia not active (e.g. unit context) — fall through */ }
  return cookieHelper().get("api_key") || (import.meta.env.VITE_RETURNS_API_KEY as string) || "";
}
