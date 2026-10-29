import { createLogger, StringifyObjectsHook } from 'vue-logger-plugin'
import { RedactSensitiveDataHook } from './logRedaction'
import { logStore } from './logStore'

// Apps ship logs to a backend by passing `afterHooks` through `app.use(logger, ...)`.
// afterHooks run after the beforeHooks below, so anything they receive is already
// redacted — see the RedactSensitiveDataHook note further down.
// Every app also keeps each line in IndexedDB on the device, for DxpLogsModal to show — see
// logStore.ts — and logs unhandled promise rejections and window errors so those are kept too.
// https://github.com/dev-tavern/vue-logger-plugin#sample-custom-hook---leveraging-axios-to-send-logs-to-server

// https://github.com/dev-tavern/vue-logger-plugin#levels
// Log levels (one of: debug, info, warn, error, log)
// log <-- error <-- warn <-- info <-- debug
// (from left to right: least inclusive to most inclusive)
// const level = (import.meta.env.VITE_DEFAULT_LOG_LEVEL ? import.meta.env.VITE_DEFAULT_LOG_LEVEL : "error") as any;

// Using StringifyObjectsHook as the objects are references and values may change during the code execution
// https://github.com/dev-tavern/vue-logger-plugin#built-in-hooks
// StringifyObjectsHook Applies JSON.stringify on all objects provided as arguments to a logging method.
// StringifyAndParseObjectsHook Applies JSON.stringify and JSON.parse on all objects provided as arguments to a logging method.

// enabled vs consoleEnabled
// Setting enabled to false will disable all logger functionality (console output + hook invocations).
// Setting consoleEnabled to false will disable just the console output but will still invoke the hooks.

// RedactSensitiveDataHook runs FIRST, and must: StringifyObjectsHook is what serialises an
// axios error, and an axios error carries the request config — Authorization header included.
// Redacting before that runs is what keeps a live bearer token out of the console.
const logger = createLogger({
  enabled: true,
  beforeHooks: [ RedactSensitiveDataHook, StringifyObjectsHook ]
});

function getStack(error: any) {
  // Handling incompatibilities
  // Non-standard: This feature is non-standard and is not on a standards track. Do not use it on production sites facing the Web: it will not work for every user. 
  // There may also be large incompatibilities between implementations and the behavior may change in the future.
  // https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Error/stack
  try {
    return error.stack;
  } catch (err) {
    logger.warn("Error stack is not supported");
  }
  return error;
}

let hasGlobalErrorListeners = false;

/**
 * Sends errors that never reach Vue's errorHandler — an unhandled promise rejection, or an error thrown
 * outside a component (a timer, an event listener, a script) — through the logger, so the log store
 * keeps them like any other line, redacted first. Errors inside components already go through
 * app.config.errorHandler and do not reach window, so nothing is logged twice.
 */
function listenForGlobalErrors() {
  if(hasGlobalErrorListeners || typeof window === "undefined" || !window.addEventListener) {return;}
  hasGlobalErrorListeners = true;

  window.addEventListener("unhandledrejection", (event: PromiseRejectionEvent) => {
    const reason = event.reason;
    // An Error stringifies to "{}", so its stack (which carries the message) is logged instead
    logger.error("Unhandled promise rejection:", reason instanceof Error ? getStack(reason) : reason);
  });

  window.addEventListener("error", (event: ErrorEvent) => {
    // event.error is null for a cross-origin script, which only reports "Script error."
    const location = event.filename ? ` (${event.filename}:${event.lineno}:${event.colno})` : "";
    logger.error(`Unhandled error:${location}`, event.error ? getStack(event.error) : event.message);
  });
}

export default {
  install(app: any, options: any) {

    app.config.errorHandler = (error: any, instance: any, info: any) => {
      // TODO Improve code to add more information related to code failed
      logger.error("Global handler:" + getStack(error));
    }
    const level = options.level ? options.level : "error"

    // The log store always runs last, after any app hook (Faro, for one), so the logs modal works in every app
    const afterHooks = [...(options.afterHooks || []), logStore.logStoreHook]
    listenForGlobalErrors()

    logger.apply({
      level,
      afterHooks,
      ...(options.callerInfo !== undefined ? { callerInfo: options.callerInfo } : {})
    })

    logger.install(app);
  },
  debug(...args: any): void {
    logger.debug(...args)
  },
  info(...args: any): void {
    logger.info(...args)
  },
  warn(...args: any): void {
    logger.warn(...args)
  },
  error(...args: any): void {
    logger.error(...args)
  },
  log(...args: any): void {
    logger.log(...args)
  }
}