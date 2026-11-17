import path from "path";
import { fileURLToPath } from "url";

const PWA_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../pwa");

/**
 * vite-plugin-pwa options for the detect-only update worker (common/pwa/sw.ts), used with
 * useAppUpdate from @common. Pass the result to the app's own VitePWA:
 *
 *   VitePWA(appUpdatePwaOptions({ manifest }))
 *
 * The app keeps importing VitePWA itself: the apps pin different Vite versions, so the plugin
 * must come from the app's dependencies, not the framework's.
 *
 * The worker caches nothing (no Firebase cache headers needed) and is built as sw.js under the
 * app's base, the same URL the previous self-destroying worker used, so existing registrations
 * update to it in place. useAppUpdate registers it: no script is injected into index.html.
 */
export const appUpdatePwaOptions = (options: { manifest?: any } = {}) => ({
  strategies: "injectManifest" as const,
  srcDir: PWA_DIR,
  filename: "sw.ts",
  registerType: "prompt" as const,
  injectRegister: false as const,
  // Only stamps the build into sw.js; nothing is precached.
  injectManifest: { globPatterns: ["index.html"] },
  includeManifestIcons: false,
  manifest: options.manifest
});
