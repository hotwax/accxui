/**
 * Whether the backend is reachable, as the last API response showed it.
 *
 * A server fault (a 5xx, 408, 429) or a request that got no response means the service is
 * unavailable, not that the session is invalid: the user stays signed in and requests are retried.
 * `remoteApi` records every response here; `useAuth().login()` reads it to tell an outage apart
 * from bad credentials. Apps can listen for the `serviceUnavailable` / `serviceRestored` events on
 * the emitter to show a banner.
 */
import emitter from "./emitter";
import { onSessionCleared } from "./sessionScope";

let unavailable = false;
let retryNoticeShown = false;

/** A failed axios request that the server did not answer, or answered with a server fault. */
export function isServiceUnavailableError(error: any): boolean {
  if (!error?.config || error?.__CANCEL__) return false;
  const status = error?.response?.status;
  if (status === undefined) return !!error?.request || error?.code === "ECONNABORTED" || error?.message === "Network Error";

  return status >= 500 || status === 408 || status === 429;
}

export function isServiceUnavailable(): boolean {
  return unavailable;
}

/** Record an unavailable response. Returns true when this starts an outage (the first one since a success). */
export function markServiceUnavailable(): boolean {
  if (unavailable) return false;
  unavailable = true;
  emitter.emit("serviceUnavailable");

  return true;
}

/** Record a response the server answered normally (any status that is not a server fault). */
export function markServiceAvailable(): void {
  if (!unavailable) return;
  unavailable = false;
  retryNoticeShown = false;
  emitter.emit("serviceRestored");
}

/** True once per outage: the "retrying" notice is shown on the first retry, not on every one. */
export function claimRetryNotice(): boolean {
  if (retryNoticeShown) return false;
  retryNoticeShown = true;

  return true;
}

onSessionCleared(() => {
  unavailable = false;
  retryNoticeShown = false;
});
