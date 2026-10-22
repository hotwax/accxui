import { readFile, writeFile, readdir, access } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const legacyWorkerPattern = "^/(?:v[0-9]+\\.[0-9]+\\.[0-9]+/)?service-worker\\.js$";
const versionDirectory = /^v\d+\.\d+\.\d+$/;

// Run after assembling ALL versions and regenerating rewrites, immediately before deployment.
// It intentionally uses only Node builtins so pinned historical framework builds can use it.
export async function prepareHosting(appDirectory) {
  const configPath = path.join(appDirectory, "firebase.json");
  const config = JSON.parse(await readFile(configPath, "utf8"));
  const targets = Array.isArray(config.hosting) ? config.hosting : [config.hosting];
  if (!targets.length || targets.some((target) => !target?.public)) {
    throw new Error("Expected static Firebase hosting targets with a public directory");
  }
  const worker = await readFile(new URL("./retire-legacy-worker.js", import.meta.url), "utf8");
  // Validate every target before changing any output/configuration.
  const outputRoots = [...new Set(targets.map((target) => path.resolve(appDirectory, target.public)))];
  const workerRoots = [...outputRoots];
  for (const root of outputRoots) {
    for (const entry of await readdir(root, { withFileTypes: true })) {
      if (!entry.isDirectory() || !versionDirectory.test(entry.name)) continue;
      workerRoots.push(path.join(root, entry.name));
    }
  }
  for (const root of workerRoots) await access(path.join(root, "index.html"));
  // Static files take precedence over Firebase rewrites, including old workers in retained tags.
  for (const root of workerRoots) await writeFile(path.join(root, "service-worker.js"), worker);
  for (const target of targets) {
    target.rewrites = [
      // Retain an update endpoint even for a version whose application files were pruned.
      { regex: legacyWorkerPattern, destination: "/service-worker.js" },
      ...(target.rewrites || []).filter((rule) => rule.regex !== legacyWorkerPattern),
    ];
    target.headers = [
      ...(target.headers || []).filter((rule) => rule.regex !== legacyWorkerPattern),
      { regex: legacyWorkerPattern, headers: [
        { key: "Cache-Control", value: "no-store" },
        { key: "Content-Type", value: "application/javascript; charset=utf-8" },
      ] },
    ];
  }
  await writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.length !== 3) throw new Error("Usage: node scripts/hosting/prepare.mjs <app-directory>");
  await prepareHosting(path.resolve(process.argv[2]));
  console.log("Prepared permanent legacy service-worker recovery endpoints");
}
