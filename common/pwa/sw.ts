/*
 * Detect-only service worker for useAppUpdate. It never caches and has no fetch handler, so every
 * request still goes to the browser HTTP cache and the network exactly as without it (the same
 * rule as scripts/hosting/retire-legacy-worker.js). It only has to change with every build: the
 * browser's own update check of sw.js then installs the new one, which waits until the user picks
 * Update (SKIP_WAITING), so the app can offer the update through the normal worker lifecycle.
 *
 * An app builds it through vite-plugin-pwa with appUpdatePwaOptions (common/vite/appUpdatePwa.ts):
 * the injectManifest step replaces self.__WB_MANIFEST with the list for index.html, whose revision
 * changes on every build. Nothing is precached from it.
 *
 * No imports: this file is bundled on its own into the app's sw.js.
 */
const sw = self as any;

// The build stamp. Must stay the literal self.__WB_MANIFEST: the build looks for that text.
sw.build = (self as any).__WB_MANIFEST;

sw.addEventListener("message", (event: any) => {
  if(event.data?.type === "SKIP_WAITING") {
    sw.skipWaiting();
  }
});
