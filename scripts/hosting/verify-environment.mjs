import { access, readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

// Inspect the compiled config, not .env: Vite's mode/local files or shell may override it.
export async function verifyEnvironment(dist, expected) {
  if (!["AppEnvDev", "AppEnvUAT", "AppEnvProd"].includes(expected)) {
    throw new Error("Expected AppEnvDev, AppEnvUAT or AppEnvProd");
  }
  const versions = (await readdir(dist, { withFileTypes: true }))
    .filter(entry => entry.isDirectory() && /^v\d+\.\d+\.\d+$/.test(entry.name))
    .map(entry => entry.name);
  for (const version of ["", ...versions]) {
    const root = path.join(dist, version);
    await access(path.join(root, "index.html"));
    const assets = path.join(root, "assets");
    let found = false;
    for (const file of await readdir(assets)) {
      if (!file.endsWith(".js")) continue;
      // Vite emits the JSON config inside either a single- or double-quoted JS string.
      const source = (await readFile(path.join(assets, file), "utf8")).replaceAll('\\"', '"');
      for (const match of source.matchAll(/"environmentTypeId"\s*:\s*"([^"]*)"/g)) {
        found = true;
        if (match[1] !== expected) {
          throw new Error(`${version || "root"}/assets/${file}: expected ${expected}, found ${match[1]}`);
        }
      }
    }
    if (!found) throw new Error(`${version || "root"}: no compiled environmentTypeId found`);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  verifyEnvironment(process.argv[2], process.argv[3]).then(() => {
    console.log(`Verified root and versioned builds use ${process.argv[3]}`);
  }).catch(error => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
