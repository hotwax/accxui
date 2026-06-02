import type { Plugin } from "vite";

type LocalApiServerSignal = "loginOptions" | "rest";

interface LocalApiServer {
  label: string;
  oms: string;
  port: number;
  signal: LocalApiServerSignal;
}

const LOCAL_API_SERVER_HOST = "localhost";
const DISCOVERY_PATH = "/__accxui/local-api-servers";
const REQUEST_TIMEOUT_MS = 700;

const parsePortList = (value?: string) => {
  if (!value) return [];

  return value
    .split(",")
    .map((port) => Number(port.trim()))
    .filter((port) => Number.isInteger(port) && port > 0 && port <= 65535);
};

const getProbePorts = () => {
  return parsePortList(process.env.VITE_LOCAL_API_SERVER_PORTS);
};

const fetchWithTimeout = async (url: string) => {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    return await fetch(url, {
      method: "GET",
      cache: "no-store",
      signal: controller.signal
    });
  } finally {
    clearTimeout(timeout);
  }
};

const isRestSignal = (response: Response) => {
  return response.ok || [401, 403, 405].includes(response.status);
};

const detectLocalApiServer = async (port: number): Promise<LocalApiServer | null> => {
  const oms = `http://${LOCAL_API_SERVER_HOST}:${port}`;
  const baseRestUrl = `${oms}/rest/s1/`;

  try {
    const response = await fetchWithTimeout(`${baseRestUrl}admin/checkLoginOptions`);
    if (response.ok) {
      return {
        label: `Local API Server ${port}`,
        oms,
        port,
        signal: "loginOptions"
      };
    }
  } catch {
    // Try the base REST path before treating this port as unavailable.
  }

  try {
    const response = await fetchWithTimeout(baseRestUrl);
    if (isRestSignal(response)) {
      return {
        label: `Local API Server ${port}`,
        oms,
        port,
        signal: "rest"
      };
    }
  } catch {
    return null;
  }

  return null;
};

const discoverLocalApiServers = async () => {
  const results = await Promise.all(getProbePorts().map(detectLocalApiServer));

  return results.filter(Boolean) as LocalApiServer[];
};

export const localApiServerDiscoveryPlugin = (): Plugin => ({
  name: "accxui-local-api-server-discovery",
  apply: "serve",
  configureServer(server) {
    server.middlewares.use(DISCOVERY_PATH, async (req, res) => {
      if (req.method !== "GET") {
        res.statusCode = 405;
        res.end();
        return;
      }

      const servers = await discoverLocalApiServers();
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify(servers));
    });
  }
});
