export type LocalApiServerSignal = "loginOptions" | "rest";

export interface LocalApiServer {
  label: string;
  oms: string;
  port: number;
  signal: LocalApiServerSignal;
}

interface DiscoverLocalApiServersOptions {
  ports?: number[];
  fetcher?: typeof fetch;
}

const LOCAL_API_SERVER_HOST = "localhost";
const LOCAL_API_SERVER_DISCOVERY_ENDPOINT = "/__accxui/local-api-servers";
const REQUEST_TIMEOUT_MS = 1000;

const parsePortList = (value?: string) => {
  if (!value) return [];

  return value
    .split(",")
    .map((port) => Number(port.trim()))
    .filter((port) => Number.isInteger(port) && port > 0 && port <= 65535);
};


const probe = async (fetcher: typeof fetch, url: string, isSignal: (response: Response) => boolean) => {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const response = await fetcher(url, {
      method: "GET",
      cache: "no-store",
      credentials: "omit",
      signal: controller.signal
    });

    return isSignal(response);
  } finally {
    clearTimeout(timeout);
  }
};

const detectLocalApiServer = async (port: number, fetcher: typeof fetch): Promise<LocalApiServer | null> => {
  const oms = `http://${LOCAL_API_SERVER_HOST}:${port}`;
  const baseRestUrl = `${oms}/rest/s1/`;

  try {
    if (await probe(fetcher, `${baseRestUrl}admin/checkLoginOptions`, (response) => response.ok)) {
      return {
        label: `Local API Server ${port}`,
        oms,
        port,
        signal: "loginOptions"
      };
    }
  } catch {
    return null;
  }

  return null;
};

const getDevServerLocalApiServers = async (fetcher: typeof fetch) => {
  if (!import.meta.env.DEV) return null;

  try {
    const response = await fetcher(LOCAL_API_SERVER_DISCOVERY_ENDPOINT, {
      method: "GET",
      cache: "no-store",
      credentials: "same-origin"
    });
    if (!response.ok) return null;

    const servers = await response.json();
    if (!Array.isArray(servers)) return null;

    return servers.filter((server): server is LocalApiServer => {
      return Boolean(
        server
        && typeof server.label === "string"
        && typeof server.oms === "string"
        && typeof server.port === "number"
        && (server.signal === "loginOptions" || server.signal === "rest")
      );
    });
  } catch {
    return null;
  }
};

export const getLocalApiServerProbePorts = () => {
  return parsePortList(import.meta.env.VITE_LOCAL_API_SERVER_PORTS);
};

export const discoverLocalApiServers = async (options: DiscoverLocalApiServersOptions = {}) => {
  const fetcher = options.fetcher || fetch;
  const devServerServers = await getDevServerLocalApiServers(fetcher);
  if (devServerServers) return devServerServers;

  const ports = options.ports || getLocalApiServerProbePorts();
  const results = await Promise.all(ports.map((port) => detectLocalApiServer(port, fetcher)));

  return results.filter(Boolean) as LocalApiServer[];
};
