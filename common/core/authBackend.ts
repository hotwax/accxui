import { cookieHelper } from "../helpers/cookieHelper";
import { useEmbeddedAppStore } from "../store/embeddedApp";

export type AuthBackend = "ofbiz" | "moqui";

const LOCAL_HOST_PATTERN = /^(localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\])(?::\d+)?(?:\/.*)?$/;

const trimTrailingSlashes = (value: string) => value.replace(/\/+$/, "");

const withProtocolForLocal = (value: string) => {
  if (/^https?:\/\//i.test(value)) return value;
  return LOCAL_HOST_PATTERN.test(value) ? `http://${value}` : value;
};

export const getAuthBackend = (): AuthBackend => {
  const backend = (import.meta.env.VITE_AUTH_BACKEND || "").trim().toLowerCase();
  return backend === "moqui" || backend === "local-moqui" ? "moqui" : "ofbiz";
};

export const isMoquiAuthBackend = () => getAuthBackend() === "moqui";

export const expandMoquiURL = (value?: string | null) => {
  if (!value) return "";

  const normalized = withProtocolForLocal(value.trim());
  if (!normalized) return "";

  if (!/^https?:\/\//i.test(normalized)) {
    return `https://${trimTrailingSlashes(normalized)}.hotwax.io/rest/s1/`;
  }

  const withoutTrailingSlash = trimTrailingSlashes(normalized);
  const restIndex = withoutTrailingSlash.indexOf("/rest/s1");
  if (restIndex >= 0) {
    return `${withoutTrailingSlash.slice(0, restIndex)}/rest/s1/`;
  }

  const apiIndex = withoutTrailingSlash.indexOf("/api");
  if (apiIndex >= 0) {
    return `${withoutTrailingSlash.slice(0, apiIndex)}/rest/s1/`;
  }

  return `${withoutTrailingSlash}/rest/s1/`;
};

export const getConfiguredMoquiBaseURL = () => {
  return expandMoquiURL(import.meta.env.VITE_MOQUI_BASE_URL);
};

export const getMoquiBaseURL = () => {
  const configuredMoquiBaseURL = getConfiguredMoquiBaseURL();
  if (configuredMoquiBaseURL) return configuredMoquiBaseURL;

  let maarg = cookieHelper().get("maarg");
  let oms = cookieHelper().get("oms");

  try {
    const embeddedAppStore = useEmbeddedAppStore();
    maarg = embeddedAppStore.getMaarg || maarg;
    oms = embeddedAppStore.getOms || oms;
  } catch {
    // Pinia may not be active during early app bootstrap or isolated unit tests.
  }

  return expandMoquiURL(maarg) || expandMoquiURL(oms);
};
