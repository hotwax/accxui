/**
 * Turn a caught error (axios rejection, our thrown Error, or a network failure) into a
 * human-readable string that preserves the HTTP status and the server's message, so failures
 * aren't masked behind a generic catch-all in the UI.
 */
export function describeApiError(e: any, fallback = "Request failed"): string {
  const status = e?.response?.status;
  const data = e?.response?.data;
  const raw =
    (typeof data?.errors === "string" && data.errors) ||
    (Array.isArray(data?.errors) && data.errors.join("; ")) ||
    data?._ERROR_MESSAGE_ ||
    (typeof data?.error === "string" && data.error) ||
    "";
  const msg = String(raw || e?.message || fallback).trim();
  return status ? `[${status}] ${msg}` : msg;
}
