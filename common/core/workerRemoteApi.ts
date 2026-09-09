/**
 * Serialize query params the way Moqui expects, expanding arrays into REPEATED keys:
 *   { id: ["A", "B"], id_op: "in" }  →  id=A&id=B&id_op=in
 *
 * `new URLSearchParams(params)` comma-joins instead — `id=A%2CB` — which Moqui reads as one
 * literal value, so the request 200s with an empty list and the failure is silent. Axios (used on
 * the main thread) expands arrays by default, which is why the same query works from a store and
 * fails from a worker.
 */
function toQueryString(params: Record<string, unknown>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null) continue;
    if (Array.isArray(value)) {
      for (const entry of value) {
        if (entry === undefined || entry === null) continue;
        search.append(key, String(entry));
      }
    } else {
      search.append(key, String(value));
    }
  }
  return search.toString();
}

/**
 * An empty 200 is not an error. Moqui answers some list routes with no body at all when the set
 * is empty, and `response.json()` throws a SyntaxError on it. A genuine parse failure (an HTML
 * error page, say) has a different message and must still propagate.
 */
function isEmptyBodyError(err: unknown): boolean {
  if (!(err instanceof SyntaxError)) return false;
  return /unexpected end of (json )?input/i.test(String((err as Error).message ?? ""));
}

export default async function workerRemoteApi(customConfig: {
  url: string;
  method?: string;
  data?: any;
  params?: any;
  baseURL?: string;
  headers?: Record<string, string>;
}) {
  const { url, method = "GET", data, params, baseURL, headers = {} } = customConfig;

  // Build URL
  let baseUrl = baseURL || '';
  if (baseUrl && !baseUrl.startsWith("http://") && !baseUrl.startsWith("https://") && !baseUrl.includes(".") && !baseUrl.includes("/")) {
    baseUrl = `https://${baseUrl}.hotwax.io`;
  }
  if (!baseUrl.endsWith('/')) {
    baseUrl += '/';
  }
  // Ensure Moqui routes use /rest/s1/
  if (url.startsWith('oms/') || url.startsWith('shippingGateways/')) {
    if (baseUrl.includes('/api/')) {
      baseUrl = baseUrl.replace('/api/', '/rest/s1/');
    } else if (!baseUrl.includes('/rest/s1/')) {
      baseUrl += 'rest/s1/';
    }
  } else if (!baseUrl.includes('rest/s1') && !baseUrl.includes('/api/')) {
    baseUrl += 'api/';
  }

  let fullUrl = baseUrl ? `${baseUrl}${url}` : url;
  if (params && Object.keys(params).length > 0) {
    const queryString = toQueryString(params);
    fullUrl += (fullUrl.includes('?') ? '&' : '?') + queryString;
  }

  const fetchOptions: RequestInit = {
    method,
    headers: {
      "Content-Type": "application/json",
      ...headers
    }
  };

  if (data && method.toUpperCase() !== "GET") {
    fetchOptions.body = JSON.stringify(data);
  }

  const response = await fetch(fullUrl, fetchOptions);

  let result: any = null;
  try {
    result = await response.json();
  } catch (err) {
    if (!isEmptyBodyError(err)) throw err;
    result = null;
  }

  if (!response.ok) {
    // A parsed error body is thrown as-is: callers classify auth failures by sniffing its
    // message, and wrapping it would break that. Only a bodyless failure becomes an Error.
    throw result ?? new Error(`Request failed with status ${response.status}`);
  }
  return result;
}