import { createHash } from "node:crypto";
import { gzipSync } from "node:zlib";
import { publicFile } from "./providers.mjs";
const hash = (b) => createHash("sha256").update(b).digest("hex");
export function matchesHostedHash(bytes, expected) {
  if (hash(bytes) === expected) return true;
  for (const level of [6, 9]) {
    const compressed = gzipSync(bytes, { level });
    for (const os of [3, 19, 255]) {
      compressed[9] = os;
      if (hash(compressed) === expected) return true;
    }
  }
  return false;
}
export async function verifiedFile(state, target, file) {
  const record = state.files.find((f) => f.path === file);
  if (!record) throw Error("File is not in the current Hosting manifest.");
  const bytes = await publicFile(target.origin, file);
  if (!matchesHostedHash(bytes, record.hash))
    throw Error(
      "Public file differs from the active Hosting snapshot. Refresh before proceeding.",
    );
  return bytes.toString("utf8");
}
export function parseBuildMetadata(code) {
  const records = [
    ...code.matchAll(
      /\{\s*"version"\s*:\s*"[^"\n]+"\s*,\s*"branch"\s*:\s*"[^"\n]*"\s*,\s*"tag"\s*:\s*"[^"\n]*"\s*,\s*"revision"\s*:\s*"[^"\n]*"\s*,\s*"builtTime"\s*:\s*\d+\s*\}/g,
    ),
  ].flatMap((m) => {
    try {
      return [JSON.parse(m[0])];
    } catch {
      return [];
    }
  });
  const releases = [
    ...new Set(
      records
        .filter((r) => !r.branch && /^v\d+\.\d+\.\d+$/.test(r.tag))
        .map((r) => r.tag),
    ),
  ];
  return releases.length === 1 ? releases[0] : null;
}
export async function discoverDefault(state, target) {
  for (const file of ["/release-manager.json", "/hosted-versions.json"]) {
    if (!state.files.some((f) => f.path === file)) continue;
    try {
      const manifest = JSON.parse(await verifiedFile(state, target, file));
      if (/^v\d+\.\d+\.\d+$/.test(manifest.rootVersion))
        return {
          defaultVersion: manifest.rootVersion,
          configuredEnvironment: manifest.environmentTypeId || null,
          source: "Hosting manifest",
        };
    } catch {
      /* Continue to actual compiled build metadata. */
    }
  }
  const html = await verifiedFile(state, target, "/index.html");
  const entry = html.match(/<script[^>]*type="module"[^>]*src="([^"]+)"/)?.[1];
  if (!entry?.startsWith("/assets/"))
    return { defaultVersion: null, configuredEnvironment: null, source: null };
  // Walk only the chunks reachable from the active root entry, never unrelated
  // retained old assets. Module-federation builds (e.g. fulfillment) start from
  // a small bootstrap that imports the real bundle a few hops later.
  let config = null;
  const queue = [entry];
  const seen = new Set(queue);
  for (let i = 0; i < queue.length && i < MAX_ENTRY_SCRIPTS; i++) {
    let code;
    try {
      code = await verifiedFile(state, target, queue[i]);
    } catch (e) {
      if (i === 0) throw e;
      continue;
    }
    config ||=
      code.match(/"environmentTypeId"\s*:\s*"(AppEnv\w+)"/)?.[1] || null;
    const version = parseBuildMetadata(code);
    if (version)
      return {
        defaultVersion: version,
        configuredEnvironment: config,
        source: "Compiled build metadata",
      };
    for (const next of entryScriptImports(code, queue[i]))
      if (!seen.has(next)) {
        seen.add(next);
        queue.push(next);
      }
  }
  return { defaultVersion: null, configuredEnvironment: config, source: null };
}
const MAX_ENTRY_SCRIPTS = 12;
// Root-level /assets/*.js files a script loads, in the order worth checking:
// Settings chunks (which carry build metadata in non-federated builds), then
// dynamic imports (federation bootstrap -> app bundle), then static imports.
export function entryScriptImports(code, from) {
  const base = new URL(from, "https://hosting.invalid");
  const resolve = (spec) => new URL(spec, base).pathname;
  const collect = (re) => [...code.matchAll(re)].map((m) => resolve(m[1]));
  const settings = [
    ...code.matchAll(/["'](?:\.\/)?(assets\/Settings[^"']+\.js)["']/g),
  ].map((m) => "/" + m[1]);
  const dynamic = collect(
    /(?:\bimport|__mfImport)\s*\(\s*["'](\.{1,2}\/[^"'\s]+\.js)["']/g,
  );
  const fixed = collect(
    /(?:\bfrom|\bimport)\s*["'](\.{1,2}\/[^"'\s]+\.js)["']/g,
  );
  return [...new Set([...settings, ...dynamic, ...fixed])].filter(
    (p) => /^\/assets\/[^/]+\.js$/.test(p) && !p.includes("legacy"),
  );
}
