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
  const code = await verifiedFile(state, target, entry);
  let version = parseBuildMetadata(code);
  const config =
    code.match(/"environmentTypeId"\s*:\s*"(AppEnv\w+)"/)?.[1] || null;
  if (!version) {
    // Only chunks referenced by the active entry, never unrelated retained old assets.
    const chunks = [
      ...new Set(
        [
          ...code.matchAll(/["'](?:\.\/)?(assets\/Settings[^"']+\.js)["']/g),
        ].map((m) => "/" + m[1]),
      ),
    ]
      .filter((p) => !p.includes("legacy"))
      .slice(0, 3);
    for (const file of chunks) {
      try {
        version = parseBuildMetadata(await verifiedFile(state, target, file));
        if (version) break;
      } catch {}
    }
  }
  return {
    defaultVersion: version,
    configuredEnvironment: config,
    source: version ? "Compiled build metadata" : null,
  };
}
