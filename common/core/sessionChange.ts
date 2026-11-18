/**
 * The framework emitter event for "this tab's session was replaced": a login in another tab or app
 * rewrote the shared session cookies, to another OMS instance, another Maarg or another user.
 * `useSessionChangeAlert` emits it and shows the reload alert; `setupAppDbSync` emits it when the sync
 * service detects an instance switch itself, and stops the sync on it. Kept apart from both so neither
 * imports the other.
 */
export const SESSION_CHANGED = "sessionChanged";

export interface SessionChange {
  from: string;
  to: string;
  /** Which session cookie changed. Absent means `oms` (the sync service only reports an instance switch). */
  field?: "oms" | "maarg" | "userId";
}
