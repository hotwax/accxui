/**
 * Local Moqui Server Discovery for Dev environments.
 */

export interface LocalMoquiServer {
  label: string;
  oms: string;
  port: number;
  signal: string;
}

export function getLocalMoquiProbePorts(): number[] {
  const defaultPorts = [8080, 8443, 8081, 8082];
  const envVal = (typeof process !== "undefined" && process.env?.VITE_LOCAL_MOQUI_PORTS) || (import.meta as any).env?.VITE_LOCAL_MOQUI_PORTS;

  if (!envVal) return defaultPorts;

  const parsed = String(envVal)
    .split(",")
    .map((s) => parseInt(s.trim(), 10))
    .filter((n) => Number.isFinite(n) && n > 0);

  const seen = new Set<number>();
  const result: number[] = [];

  for (const port of [...parsed, ...defaultPorts]) {
    if (!seen.has(port)) {
      seen.add(port);
      result.push(port);
    }
  }

  return result;
}

export async function discoverLocalMoquiServers(options: {
  ports?: number[];
  fetcher?: (url: string) => Promise<Response>;
} = {}): Promise<LocalMoquiServer[]> {
  const fetcher = options.fetcher || ((url: string) => fetch(url));

  // 1. Try Vite dev discovery endpoint first
  try {
    const devEndpointResp = await fetcher("/__accxui/local-moqui-servers");
    if (devEndpointResp.status === 200) {
      const data = await devEndpointResp.json();
      if (Array.isArray(data)) {
        return data;
      }
    }
  } catch {
    // Continue to port probing if dev endpoint fails
  }

  // 2. Direct port probes
  const ports = options.ports || getLocalMoquiProbePorts();
  const discovered: LocalMoquiServer[] = [];

  for (const port of ports) {
    const omsUrl = `http://localhost:${port}`;
    try {
      const checkResp = await fetcher(`${omsUrl}/rest/s1/admin/checkLoginOptions`);
      if (checkResp.status === 200) {
        discovered.push({
          label: `Local Moqui ${port}`,
          oms: omsUrl,
          port,
          signal: "checkLoginOptions",
        });
        continue;
      }
    } catch {
      // checkLoginOptions failed, try rest root
    }

    try {
      const restResp = await fetcher(`${omsUrl}/rest/s1/`);
      if (restResp.status === 200 || restResp.status === 401 || restResp.status === 403) {
        discovered.push({
          label: `Local Moqui ${port}`,
          oms: omsUrl,
          port,
          signal: "rest",
        });
      }
    } catch {
      // port unreachable
    }
  }

  return discovered;
}
