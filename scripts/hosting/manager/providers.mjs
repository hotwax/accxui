import { createHash } from "node:crypto";

export function github(token) {
  return async function api(method, endpoint, body) {
    if (!endpoint.startsWith("/")) throw Error("Invalid GitHub path.");
    const response = await fetch(`https://api.github.com${endpoint}`, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        ...(body ? { "Content-Type": "application/json" } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(30000),
      redirect: "error",
    });
    if (!response.ok) {
      const error = new Error(
        `GitHub request failed (${response.status}). Check repository access and token permissions.`,
      );
      error.status = response.status;
      throw error;
    }
    return response.status === 204 ? null : response.json();
  };
}
export async function repoFile(gh, repo, file, ref) {
  const data = await gh(
    "GET",
    `/repos/${repo}/contents/${file}${ref ? `?ref=${encodeURIComponent(ref)}` : ""}`,
  );
  if (data.type !== "file" || data.encoding !== "base64")
    throw Error(`Cannot read ${file}.`);
  return Buffer.from(data.content, "base64").toString("utf8");
}
export async function githubPages(gh, endpoint) {
  const all = [];
  for (let page = 1; page <= 100; page++) {
    const rows = await gh(
      "GET",
      `${endpoint}${endpoint.includes("?") ? "&" : "?"}per_page=100&page=${page}`,
    );
    all.push(...rows);
    if (rows.length < 100) return all;
  }
  throw Error("GitHub pagination limit reached; the list may be incomplete.");
}
export {
  firebaseConnection as firebase,
  listFiles,
} from "../publish-versions.mjs";
import { listFiles } from "../publish-versions.mjs";
export async function snapshot(api, site) {
  const data = await api(
    "GET",
    `/sites/${site}/channels/live/releases`,
    undefined,
    { pageSize: 1 },
  );
  const release = data.releases?.[0];
  if (!release?.version?.name || release.type === "SITE_DISABLE")
    throw Error("No active Firebase deployment found.");
  const version = await api("GET", `/${release.version.name}`);
  const files = await listFiles(api, version.name);
  if (
    !files.some((f) => f.path === "/index.html") ||
    files.some((f) => f.status !== "ACTIVE")
  )
    throw Error("The current Hosting file inventory is incomplete.");
  return { release, version, files };
}
// Firebase returns map fields (each header rule's `headers`) in no fixed key order, so object keys
// are sorted; array order (rule precedence) still counts.
const canonical = (value) =>
  Array.isArray(value)
    ? value.map(canonical)
    : value && typeof value === "object"
      ? Object.fromEntries(
          Object.keys(value)
            .sort()
            .map((k) => [k, canonical(value[k])]),
        )
      : value;
export const fingerprint = (s) =>
  createHash("sha256")
    .update(
      JSON.stringify({
        release: s.release.name,
        config: canonical(s.version.config),
        files: s.files.map((f) => [f.path, f.hash]).sort(),
      }),
    )
    .digest("hex");
export async function publicFile(origin, file) {
  const response = await fetch(origin + file, {
    signal: AbortSignal.timeout(20000),
    redirect: "error",
    headers: { "Cache-Control": "no-cache" },
  });
  if (!response.ok)
    throw Error(`Hosted file unavailable (${response.status}).`);
  return Buffer.from(await response.arrayBuffer());
}
