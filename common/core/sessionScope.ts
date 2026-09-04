/**
 * Session-scoped module state in `common` — the logout story for shared composables.
 *
 * Shared composables (the product master, for one) hold tenant data at module level, and an SPA logout
 * unmounts nothing, so without a reset the next login on the same tab reads the previous tenant's data.
 * A composable registers its reset here at module scope; `useAuth().logout()` runs every registered
 * reset exactly once, after the app's own `postLogout` hook. That makes the guarantee a property of the
 * composable rather than of whichever app view happened to import it.
 *
 * Apps keep their own registries for app-local state; this one is only for state that lives in `common`.
 */

type SessionReset = () => void;

const resets = new Set<SessionReset>();

/** Register a reset for module-level session state held in `common`. Returns an unregister. */
export function onSessionCleared(reset: SessionReset): () => void {
  resets.add(reset);

  return () => resets.delete(reset);
}

/** Run every registered reset. Called from `useAuth().logout()`; safe to call more than once. */
export function clearSessionScopedState(): void {
  for(const reset of resets) {
    try {
      reset();
    } catch (error) {
      // One composable's failure must not leave the rest of the session dirty.
      console.error("sessionScope reset failed", error);
    }
  }
}
