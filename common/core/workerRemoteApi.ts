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
    const queryString = new URLSearchParams(params).toString();
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
  const result = await response.json();

  if (!response.ok) {
    throw result;
  }
  return result;
}