import { spawn } from "node:child_process";
import { mkdir, writeFile, readFile, readdir, lstat } from "node:fs/promises";
import path from "node:path";
import { repoFile } from "./providers.mjs";

export function command(command, args, cwd, env = process.env) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let bytes = 0; // Build output can contain env values; never save or forward it.
    child.stdout.on("data", (b) => {
      bytes += b.length;
    });
    child.stderr.on("data", (b) => {
      bytes += b.length;
    });
    const timeout = setTimeout(
      () => {
        child.kill("SIGTERM");
        reject(Error(`${command} timed out. No deployment was published.`));
      },
      30 * 60 * 1000,
    );
    child.on("error", () => {
      clearTimeout(timeout);
      reject(Error(`${command} is unavailable.`));
    });
    child.on("close", (code) => {
      clearTimeout(timeout);
      code === 0
        ? resolve({ bytes })
        : reject(
            Error(
              `${command} failed (${code}). Inspect the isolated source checkout; no deployment was published.`,
            ),
          );
    });
  });
}
export async function resolveBuild(gh, app, version) {
  const release = await gh(
    "GET",
    `/repos/${app.repo}/releases/tags/${encodeURIComponent(version)}`,
  );
  if (release.draft || release.prerelease)
    throw Error(`${version} is not a published stable release.`);
  const commit = await gh(
    "GET",
    `/repos/${app.repo}/commits/${encodeURIComponent(version)}`,
  );
  const workflow = await repoFile(
    gh,
    app.repo,
    ".github/workflows/firebase-hosting-release.yml",
    commit.sha,
  );
  const pin = workflow.match(/^\s*accxuiVersion:\s*["']?([^\s"'#]+)/m)?.[1];
  if (!pin || !/^(v\d+\.\d+\.\d+(?:-[\w.-]+)?|[a-f0-9]{40})$/.test(pin))
    throw Error(
      `${version} needs an immutable AccxUI tag or commit in its release workflow.`,
    );
  const framework = await gh(
    "GET",
    `/repos/hotwax/accxui/commits/${encodeURIComponent(pin)}`,
  );
  const example = await repoFile(gh, app.repo, ".env.example", commit.sha);
  const line = example.match(/^VITE_APP_VERSION_CONFIG=(.*)$/m)?.[1];
  let config;
  try {
    config = JSON.parse(line);
  } catch {
    throw Error(`${version} predates versioned builds.`);
  }
  if (!config?.appId) throw Error(`${version} has no app-version identity.`);
  return {
    version,
    appCommit: commit.sha,
    frameworkCommit: framework.sha,
    frameworkPin: pin,
    appId: config.appId,
    config,
  };
}
// App build values come from secrets named per environment; UAT builds use the dev values, as the tag rollout does.
export const BUILD_SECRETS = {
  uat: {
    VITE_FIREBASE_CONFIG: "DEV_VUE_APP_FIREBASE_CONFIG",
    VITE_FIREBASE_VAPID_KEY: "DEV_VUE_APP_FIREBASE_VAPID_KEY",
    VITE_SHOPIFY_SHOP_CONFIG: "DEV_SHOPIFY_SHOP_CONFIG",
  },
  prod: {
    VITE_FIREBASE_CONFIG: "PROD_VUE_APP_FIREBASE_CONFIG",
    VITE_FIREBASE_VAPID_KEY: "PROD_VUE_APP_FIREBASE_VAPID_KEY",
    VITE_SHOPIFY_SHOP_CONFIG: "PROD_SHOPIFY_SHOP_CONFIG",
    VITE_ALIAS: "PROD_OMS_ALIAS",
    VITE_FARO_COLLECTOR_URL: "PROD_FARO_COLLECTOR_URL",
    VITE_FARO_API_KEY: "PROD_FARO_API_KEY",
  },
};
export function buildValues(environment, secrets = process.env) {
  return Object.fromEntries(
    Object.entries(BUILD_SECRETS[environment] || {})
      .filter(([, name]) => secrets[name])
      .map(([key, name]) => [key, secrets[name]]),
  );
}
export async function buildRelease(
  app,
  source,
  environment,
  workspace,
  rootBuild,
  progress,
) {
  const folder = path.join(
    workspace,
    source.version + (rootBuild ? "-default" : ""),
  );
  await mkdir(folder, { recursive: true });
  progress(`Checking out ${source.version}${rootBuild ? " as Default" : ""}`);
  await command(
    "git",
    [
      "clone",
      "--quiet",
      "--no-checkout",
      "https://github.com/hotwax/accxui.git",
      folder,
    ],
    workspace,
  );
  await command(
    "git",
    ["checkout", "--detach", source.frameworkCommit],
    folder,
  );
  const appDir = path.join(folder, "apps", app.id);
  await mkdir(path.dirname(appDir), { recursive: true });
  await command(
    "git",
    [
      "clone",
      "--quiet",
      "--no-checkout",
      `https://github.com/${app.repo}.git`,
      appDir,
    ],
    folder,
  );
  await command("git", ["checkout", "--detach", source.appCommit], appDir);
  await writeFile(
    path.join(appDir, ".env"),
    await readFile(path.join(appDir, ".env.example")),
  );
  const env = {
    ...Object.fromEntries(
      Object.entries(process.env).filter(([k]) => !k.startsWith("VITE_")),
    ),
    CI: "true",
    VITE_APP_VERSION_CONFIG: JSON.stringify({
      ...source.config,
      environmentTypeId: environment === "uat" ? "AppEnvUAT" : "AppEnvProd",
      buildVersion: rootBuild ? "" : source.version,
    }),
  };
  Object.assign(env, buildValues(environment));
  if (env.VITE_FIREBASE_CONFIG) {
    const worker = path.join(appDir, "public/firebase-messaging-sw.js");
    let content;
    try {
      content = await readFile(worker, "utf8");
    } catch (e) {
      if (e.code !== "ENOENT") throw e;
    }
    if (content)
      await writeFile(
        worker,
        content.replace(
          /const firebaseConfig =[^\n]*/,
          `const firebaseConfig = ${JSON.stringify(JSON.parse(env.VITE_FIREBASE_CONFIG))};`,
        ),
      );
  }
  progress(`Installing pinned dependencies for ${source.version}`);
  await command("pnpm", ["install", "--frozen-lockfile"], folder, env);
  progress(
    `Building ${source.version}${rootBuild ? " Default" : " version URL"}`,
  );
  await command("pnpm", ["build"], appDir, env);
  const dist = path.join(appDir, "dist", rootBuild ? "" : source.version);
  const index = await readFile(path.join(dist, "index.html"), "utf8");
  const prefix = rootBuild ? "" : `/${source.version}`;
  if (!index.includes(`${prefix}/assets/`))
    throw Error("Built entry page has the wrong asset base.");
  const files = new Map();
  async function collect(dir, url) {
    for (const item of await readdir(dir)) {
      const filename = path.join(dir, item),
        stat = await lstat(filename);
      if (stat.isSymbolicLink()) throw Error("Build contains a symlink.");
      if (stat.isDirectory()) await collect(filename, `${url}/${item}`);
      else files.set(`${url}/${item}`, await readFile(filename));
    }
  }
  await collect(dist, prefix);
  // Historical Vue CLI workers must never fall through to HTML on newly built paths.
  const retirement = await readFile(
    new URL("../retire-legacy-worker.js", import.meta.url),
  );
  files.set(`${prefix}/service-worker.js`, retirement);
  return files;
}
