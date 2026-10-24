import { randomUUID } from "node:crypto";
import type { Plugin } from "vite";

/** Opt-in build identity; a rebuild with different environment values also gets a new ID. */
export function buildUpdatePlugin(): Plugin {
  const buildId = randomUUID();
  let base = "/";
  return {
    name: "hotwax-build-update",
    apply: "build",
    config: () => ({ define: { "import.meta.env.VITE_APP_BUILD_ID": JSON.stringify(buildId) } }),
    configResolved(config) { base = config.base; },
    generateBundle() {
      this.emitFile({
        type: "asset", fileName: "app-build.json",
        source: JSON.stringify({ schemaVersion: 1, buildId, base })
      });
    }
  };
}
