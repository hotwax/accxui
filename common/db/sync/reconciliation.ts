export const CACHE_RECONCILIATION_ERROR_MESSAGE =
  "The server change was saved, but this view could not be refreshed. Refresh before retrying.";

/**
 * A server mutation completed, but its mandatory local-cache reconciliation did not.
 *
 * Keeping this stage explicit prevents a retry from duplicating a create or replaying a
 * date-effective association write. The domain and PK are diagnostics only; they never contain
 * credentials or response bodies.
 */
export class CacheReconciliationError extends Error {
  readonly mutationCommitted = true;

  constructor(
    readonly domain: string,
    readonly pk: Record<string, unknown>,
    cause?: unknown,
    readonly failedDomains: readonly string[] = [domain],
  ) {
    super(CACHE_RECONCILIATION_ERROR_MESSAGE, { cause });
    this.name = "CacheReconciliationError";
  }
}

export function isCacheReconciliationError(error: unknown): error is CacheReconciliationError {
  return error instanceof CacheReconciliationError ||
    Boolean(error &&
      typeof error === "object" &&
      (error as any).name === "CacheReconciliationError" &&
      (error as any).mutationCommitted === true);
}

/**
 * Build the canonical cache-refetch scope shared by the main-thread bootstrap and sync worker.
 *
 * Object keys are sorted recursively so equivalent primary keys produce the same scope even when
 * their insertion order differs between a mutation caller and a worker status message.
 */
export function cacheScopeKey(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value) ?? "";
  }
  if (Array.isArray(value)) {
    return `[${value.map(cacheScopeKey).join(",")}]`;
  }
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, entry]) => entry !== undefined)
    .sort(([left], [right]) => left.localeCompare(right));

  return `{${entries.map(([key, entry]) =>
    `${JSON.stringify(key)}:${cacheScopeKey(entry)}`).join(",")}}`;
}
