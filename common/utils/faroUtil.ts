import type { Faro, LogLevel } from "@grafana/faro-web-sdk";
import type { LogEvent, LoggerHook, LogLevel as VueLogLevel } from "vue-logger-plugin";
import { accxuiConfig } from "../core/configRegistry";
import { commonUtil } from "./commonUtil";

let starting: Promise<void> | null = null;
let faroApi: Faro | null = null;
let faroLogLevel: Record<VueLogLevel, LogLevel> | null = null;
// Set once at init and never read for its value, only called: the user state it returns is read
// fresh on every capture, so there is nothing here to reset when the session changes.
let appContext: (() => Record<string, any>) | undefined;

export interface FaroOptions {
  /** Collector endpoint. Defaults to VITE_FARO_COLLECTOR_URL; without one Faro stays off. */
  collectorUrl?: string;
  /** Value for Faro's `app.name`. Defaults to the appId in VITE_APP_VERSION_CONFIG. */
  appName?: string;
  /**
   * Extra context the app wants on every signal, merged into `user.attributes`. Called on each
   * capture, so return the current values rather than a snapshot taken at startup. Use it for
   * state the framework cannot see — Company's Maarg instance name and purpose, for one.
   */
  getContext?: () => Record<string, any>;
}

const parseJson = (value: any, fallback: any = {}) => {
  try {
    return value ? JSON.parse(value) : fallback;
  } catch {
    return fallback;
  }
}

/**
 * Query params removed from any URL before it is sent. A denylist, so params that carry real
 * debugging value — orderId, facilityId, a filter — survive untouched.
 */
const SENSITIVE_PARAMS = new Set<string>([
  "api_key", "token", "jwttoken", "shop", "code", "hmac",
  "timestamp", "client_id", "state", "scope", "redirect_uri"
]);

/**
 * The variants nobody remembers to list: id_token, access_token, refresh_token, clientSecret,
 * apiKey. Matched on the param name, so a value that merely contains the word is left alone.
 */
const SENSITIVE_PARAM_PATTERN = /token|secret|password|signature|hmac|api[-_]?key/i;

/** A JWT anywhere in free text — a token that reached a message or an attribute rather than a URL. */
const JWT_PATTERN = /eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g;

/** The part of a Faro transport item this hook touches, typed locally so the SDK stays a lazy import. */
type ScrubbableItem = {
  meta?: { page?: { url?: string } } & Record<string, any>;
  payload?: Record<string, any>;
}

const isSensitiveParam = (name: string): boolean =>
  SENSITIVE_PARAMS.has(name.toLowerCase()) || SENSITIVE_PARAM_PATTERN.test(name);

/** The param name of a raw "name=value" pair, decoded where it can be. */
const paramName = (pair: string): string => {
  const name = pair.split("=")[0];

  try {
    return decodeURIComponent(name);
  } catch {
    return name;
  }
}

/**
 * Drops the sensitive pairs from a raw query or fragment string. Surviving pairs are passed
 * through byte for byte rather than re-encoded, so nothing changes except what was removed.
 */
const filterParams = (raw: string): { value: string, removed: boolean } => {
  let removed = false;

  const kept = raw.split("&").filter((pair) => {
    if(!pair) {
      return false;
    }
    if(isSensitiveParam(paramName(pair))) {
      removed = true;

      return false;
    }

    return true;
  })

  return { value: kept.join("&"), removed };
}

/**
 * Removes the named params from a URL's query string, and from its fragment when that carries
 * params too — implicit OAuth flows deliver access_token there.
 *
 * Works on every URL shape: absolute, root-relative, "./orders?code=1", a bare "orders?hmac=x",
 * and a query-only "?token=abc". Nothing is parsed as a URL, so no origin is invented and no
 * path is normalised — the part before the "?" is copied through untouched and only the params
 * are rewritten. If no sensitive param is present the original string is returned as it came in.
 */
const sanitiseUrl = (raw: string): string => {
  const queryAt = raw.indexOf("?");
  const hashAt = raw.indexOf("#");

  if(queryAt === -1 && hashAt === -1) {
    return raw;
  }

  // Prose, not a URL. A real URL carries no raw whitespace, and "Request failed? check the
  // proxy" would otherwise be treated as a path plus a query.
  if(/\s/.test(raw)) {
    return raw;
  }

  const splitAt = queryAt === -1 ? hashAt : (hashAt === -1 ? queryAt : Math.min(queryAt, hashAt));
  const prefix = raw.slice(0, splitAt);
  const hasQuery = queryAt !== -1 && (hashAt === -1 || queryAt < hashAt);

  const query = hasQuery ? raw.slice(queryAt + 1, hashAt === -1 ? undefined : hashAt) : "";
  const fragment = hashAt === -1 ? "" : raw.slice(hashAt + 1);

  const filteredQuery = hasQuery ? filterParams(query) : { value: "", removed: false };
  // A fragment without "=" is a route, not a param list. Leave it alone.
  const filteredFragment = fragment.includes("=") ? filterParams(fragment) : { value: fragment, removed: false };

  if(!filteredQuery.removed && !filteredFragment.removed) {
    return raw;
  }

  return prefix
    + (filteredQuery.value ? "?" + filteredQuery.value : "")
    + (filteredFragment.value ? "#" + filteredFragment.value : "");
}

const redactSecrets = (text: string): string => text.replace(JWT_PATTERN, "[redacted-jwt]");

/**
 * The only hook every signal passes through, including the ones the SDK raises on its own.
 * RedactSensitiveDataHook runs in the logger's beforeHooks, so it covers faroLoggerHook and
 * nothing else: an unhandled rejection or a navigation event is scrubbed here or not at all.
 *
 * page.url is replaced rather than mutated because Faro merges metas shallowly per top-level
 * key, so the nested page object can be shared with the live meta rather than owned by this item.
 */
const scrubSecrets = (item: ScrubbableItem): ScrubbableItem => {
  try {
    const url = item?.meta?.page?.url;
    if(url) {
      item.meta = { ...item.meta, page: { ...item.meta!.page, url: sanitiseUrl(url) } };
    }

    const payload = item?.payload;
    if(payload) {
      if(typeof payload.message === "string") {payload.message = redactSecrets(payload.message);}
      if(typeof payload.value === "string") {payload.value = redactSecrets(payload.value);}

      // Event attributes carry URLs of their own — faro.navigation is the one that matters here.
      const attributes = payload.attributes;
      if(attributes) {
        Object.keys(attributes).forEach((key) => {
          const value = attributes[key];
          if(typeof value === "string") {
            // Both passes, unconditionally: sanitiseUrl returns anything that is not an
            // absolute or root-relative URL untouched, so there is nothing to detect first.
            attributes[key] = redactSecrets(sanitiseUrl(value));
          }
        })
      }
    }
  } catch {
    // Scrubbing runs inside the calling code path. A throw here would take that path down,
    // and a signal that cannot be scrubbed is still better sent than crashing the app.
  }

  return item;
}

/**
 * Ambient context attached to every signal Faro sends — logs, exceptions and events alike.
 *
 * Registered with faro.metas.add() as a *getter*, which Faro re-evaluates on every capture.
 * That is what makes it correct across login, logout and OMS instance switches without
 * anything having to remember to re-set it.
 *
 * The user state comes from `accxuiConfig` — the context the app passes to initialiseConfig —
 * so the framework never reaches into an app store. `current` is {} before login and is reset
 * to {} on logout, which is why every field is checked rather than assumed.
 *
 * Faro's Meta shape has a fixed set of top-level keys, so arbitrary values go in one of its
 * string attribute bags. Everything here lives under `user.attributes`: nothing else in the
 * app writes that key, whereas `session.attributes` is owned by the session manager and
 * `page` by the page meta, and metas are merged shallowly per top-level key — so sharing
 * one of those would mean silently overwriting what the SDK put there.
 *
 * Every lookup is guarded. This runs during initializeFaro (the session_start event fires
 * before the app has called initialiseConfig) and again after logout, so "not available yet"
 * is a normal state, not an error, and a throw here would take the calling code path down.
 */
const appContextMeta = () => {
  const user: Record<string, any> = {};
  const attributes: Record<string, string> = {};

  try {
    const profile = accxuiConfig.value.current ?? {};
    if(profile.userId) {
      user.id = String(profile.userId);
    }
    if(profile.userLoginId) {
      user.username = String(profile.userLoginId);
    }
    if(profile.userFullName) {
      user.fullName = String(profile.userFullName);
    }

    if(accxuiConfig.value.oms) {
      attributes.oms = String(accxuiConfig.value.oms);
    }
  } catch {
    // initialiseConfig has not run yet, or the session was torn down.
  }

  try {
    // The raw instance identifier ("demo", or a full URL) rather than the derived REST
    // base, so the value matches what an operator would recognise and type.
    const instance = commonUtil.getMaargBaseURL();
    if(instance) {
      attributes.maargInstance = String(instance);
    }
  } catch {
    // No Maarg instance selected yet.
  }

  try {
    const extra = appContext ? appContext() : {};
    Object.keys(extra).forEach((key) => {
      const value = extra[key];
      if(value !== undefined && value !== null && value !== "") {
        attributes[key] = String(value);
      }
    })
  } catch {
    // The app's getter depends on state that is not ready, which is its business, not ours.
  }

  if(Object.keys(attributes).length) {user.attributes = attributes;}

  return { user };
}

const start = async (collectorUrl: string, options: FaroOptions) => {
  const sdk = await import("@grafana/faro-web-sdk");
  const { LogLevel, getWebInstrumentations, initializeFaro } = sdk;

  // vue-logger-plugin and Faro happen to share the same level strings, but map them
  // explicitly so a change on either side surfaces as a type error rather than silently
  // mislabelling every log line.
  faroLogLevel = {
    debug: LogLevel.DEBUG,
    info: LogLevel.INFO,
    warn: LogLevel.WARN,
    error: LogLevel.ERROR,
    log: LogLevel.LOG
  }

  const versionConfig = parseJson(import.meta.env.VITE_APP_VERSION_CONFIG);
  const versionInfo = parseJson(import.meta.env.VITE_APP_VERSION_INFO);

  const instance = initializeFaro({
    url: collectorUrl,
    apiKey: import.meta.env.VITE_FARO_API_KEY,
    app: {
      name: options.appName || versionConfig.appId,
      version: versionInfo.version,
      environment: versionConfig.environmentTypeId,
      gitHash: versionInfo.revision
    },
    instrumentations: [
      // captureConsole stays off deliberately. vue-logger-plugin already writes every
      // log to the console, so capturing it here would duplicate each line, and it
      // would also pick up raw console.* calls that never went through
      // RedactSensitiveDataHook — which is what keeps bearer tokens out of the payload.
      // Navigation and resource timing is roughly one event per resource loaded — the
      // highest-volume signal Faro emits, and not what these logs are for.
      ...getWebInstrumentations({ captureConsole: false, enablePerformanceInstrumentation: false })
    ],

    beforeSend: scrubSecrets
  }) ?? sdk.faro;

  instance.metas.add(appContextMeta);

  faroApi = instance;
}

/**
 * Starts Faro so app logs, unhandled errors and promise rejections reach the collector.
 * No-op when no collector URL is configured, which is how an environment opts out.
 *
 * Loading the SDK is asynchronous and callers do not await it: lines logged in the moment before
 * it resolves are not sent, which is why the on-device store — which is synchronous and always on
 * — stays the record of what happened at startup.
 */
const initialiseFaro = (options: FaroOptions = {}) => {
  if(starting) {
    return starting;
  }

  const collectorUrl = options.collectorUrl || import.meta.env.VITE_FARO_COLLECTOR_URL;
  if(!collectorUrl) {
    return Promise.resolve();
  }

  appContext = options.getContext;

  starting = start(collectorUrl, options).catch(() => {
    // A collector that cannot be reached, or an SDK chunk that fails to load, must not stop the
    // app from starting. Nothing is logged here: that would be a log about logging.
  });

  return starting;
}

/**
 * Forwards logger output to Faro. Registered as an *after* hook so the arguments it
 * receives have already passed through the logger's beforeHooks — RedactSensitiveDataHook
 * included — meaning nothing unredacted is shipped off the device.
 */
const faroLoggerHook: LoggerHook = {
  run(event: LogEvent) {
    if(!faroApi || !faroLogLevel) {
      return;
    }

    const caller = event.caller;

    try {
      faroApi.api.pushLog(event.argumentArray, {
        level: faroLogLevel[event.level] ?? faroLogLevel.log,
        context: caller ? {
          fileName: String(caller.fileName ?? ""),
          functionName: String(caller.functionName ?? ""),
          lineNumber: String(caller.lineNumber ?? "")
        } : undefined
      });
    } catch {
      // Never let telemetry break the calling code path, and never log here — that
      // would re-enter this hook.
    }
  }
}

export const faroUtil = {
  initialiseFaro,
  faroLoggerHook
}
