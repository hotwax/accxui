import type { LoggerHook } from 'vue-logger-plugin'

/**
 * Log redaction.
 *
 * A failed axios call carries the whole request `config` on the thrown error, and axios bolts a
 * `toJSON` onto it that includes that config (see axios' `enhanceError`). The logger's
 * `StringifyObjectsHook` then runs `JSON.stringify` over every object argument, which calls that
 * `toJSON` — so `logger.error('...', error)` prints `headers.Authorization` and a live bearer
 * token. Anything that forwards console output onward (session replay, remote logging, a support
 * screenshare) keeps a copy of it.
 *
 * `sanitizeForLog` turns an unknown thrown value into something safe to print, and
 * `RedactSensitiveDataHook` applies it to every logger argument, so the ~58 existing
 * `logger.error(msg, error)` call sites are fixed without touching any of them.
 *
 * Spec: common/tests/logRedaction.spec.ts
 */

export const REDACTED = '[redacted]'

/**
 * Substrings that mark a key as holding a credential, matched against the key with punctuation
 * stripped so `Authorization`, `x-xsrf-token` and `access_token` all hit. Deliberately broad:
 * over-redacting a log line costs a debugging detail, under-redacting leaks a credential.
 */
const SENSITIVE_KEY_PATTERNS = [
  'authorization', 'authentication', 'cookie', 'token', 'password', 'passwd',
  'secret', 'apikey', 'privatekey', 'credential', 'sessionid', 'bearer'
]

/** Guards against a self-referencing or pathologically deep object turning a log into a hang. */
const MAX_DEPTH = 6

function isSensitiveKey(key: string): boolean {
  const normalized = key.toLowerCase().replace(/[^a-z0-9]/g, '')
  return SENSITIVE_KEY_PATTERNS.some((pattern) => normalized.includes(pattern))
}

/** Deep copy with every credential-shaped key replaced. Used for headers, params and bodies. */
function redactValue(value: unknown, depth: number, seen: WeakSet<object>): unknown {
  if (value === null || typeof value !== 'object') return value
  if (depth >= MAX_DEPTH) return '[truncated]'
  if (seen.has(value as object)) return '[circular]'
  seen.add(value as object)

  if (Array.isArray(value)) return value.map((entry) => redactValue(entry, depth + 1, seen))

  const redacted: Record<string, unknown> = {}
  Object.entries(value as Record<string, unknown>).forEach(([key, entry]) => {
    redacted[key] = isSensitiveKey(key) ? REDACTED : redactValue(entry, depth + 1, seen)
  })
  return redacted
}

/**
 * Strips credential-shaped query parameters out of a URL. A token has no business being in a
 * query string, but a log is the wrong place to find out that one is.
 */
function redactUrl(url: string): string {
  const queryStart = url.indexOf('?')
  if (queryStart === -1) return url

  const query = url
    .slice(queryStart + 1)
    .split('&')
    .map((pair) => {
      const separator = pair.indexOf('=')
      if (separator === -1) return pair
      const key = pair.slice(0, separator)
      return isSensitiveKey(key) ? `${key}=${REDACTED}` : pair
    })
    .join('&')

  return `${url.slice(0, queryStart)}?${query}`
}

/**
 * Whether a thrown value is an axios error. `isAxiosError` is the flag axios sets; the config
 * check also catches a rethrown or hand-built shape that lost the flag but still carries the
 * request config that does the leaking.
 */
function isAxiosLikeError(value: any): boolean {
  if (!value || typeof value !== 'object') return false
  if (value.isAxiosError === true) return true
  return !!value.config && typeof value.config === 'object'
    && ('url' in value.config || 'headers' in value.config)
}

/** What a failed request is worth logging: where it went, what came back, and why it failed. */
function sanitizeAxiosError(error: any, seen: WeakSet<object>): Record<string, unknown> {
  const safe: Record<string, unknown> = { name: error.name, message: error.message }

  if (error.code) safe.code = error.code
  if (error.config?.method) safe.method = String(error.config.method).toUpperCase()
  if (error.config?.baseURL) safe.baseURL = redactUrl(String(error.config.baseURL))
  if (error.config?.url) safe.url = redactUrl(String(error.config.url))
  if (error.config?.params !== undefined) safe.params = redactValue(error.config.params, 1, seen)

  if (error.response) {
    if (error.response.status !== undefined) safe.status = error.response.status
    if (error.response.statusText) safe.statusText = error.response.statusText
    // A response body can carry a credential of its own (a login reply), so it is redacted too.
    if (error.response.data !== undefined) safe.responseData = redactValue(error.response.data, 1, seen)
  }

  // The stack names the failing code and holds no credential, so it stays.
  if (error.stack) safe.stack = error.stack
  return safe
}

/**
 * Makes one logger argument safe to print. Anything that is not an object passes through
 * untouched; an axios error collapses to the fields worth reading; any other error becomes a
 * plain object (`JSON.stringify` renders a bare `Error` as `{}`, so this reads better too);
 * everything else is deep-redacted in place of its credential-shaped keys.
 */
export function sanitizeForLog(value: unknown): unknown {
  if (value === null || typeof value !== 'object') return value

  const seen = new WeakSet<object>()

  if (isAxiosLikeError(value)) return sanitizeAxiosError(value, seen)

  if (value instanceof Error) {
    const { name, message, stack } = value
    return { name, message, stack }
  }

  return redactValue(value, 0, seen)
}

/**
 * Redacts every argument handed to the logger. Must run BEFORE `StringifyObjectsHook`, which is
 * what serialises an axios error's config — `beforeHooks` run in array order.
 */
export const RedactSensitiveDataHook: LoggerHook = {
  run(event) {
    for (let index = 0; index < event.argumentArray.length; index++) {
      event.argumentArray[index] = sanitizeForLog(event.argumentArray[index])
    }
  }
}
