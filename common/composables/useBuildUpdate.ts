import { computed, onMounted, onUnmounted, ref } from "vue";

/** Detect updates only. The consuming app owns user consent and reload safety. */
export function useBuildUpdate(options: { currentBuildId: string; base: string; enabled?: boolean }) {
  const availableBuildId = ref("");
  const updateAvailable = computed(() => Boolean(availableBuildId.value));
  let stopped = true;
  let pending: AbortController | null = null;
  let interval: ReturnType<typeof setInterval> | undefined;
  let lastCheck = 0;

  async function checkForUpdate() {
    if (stopped || pending || document.visibilityState === "hidden" || !navigator.onLine) return;
    const base = new URL(options.base, window.location.origin);
    if (base.origin !== window.location.origin) return;
    const controller = new AbortController();
    pending = controller;
    lastCheck = Date.now();
    const timeout = setTimeout(() => controller.abort(), 10000);
    try {
      const response = await fetch(new URL("app-build.json", base), {
        cache: "no-store", credentials: "omit", redirect: "error", signal: controller.signal
      });
      if (!response.ok || !response.headers.get("content-type")?.includes("application/json")) return;
      const marker = await response.json();
      if (stopped || controller.signal.aborted || marker?.schemaVersion !== 1
        || marker.base !== base.pathname || typeof marker.buildId !== "string"
        || !marker.buildId.trim() || marker.buildId.length > 128) return;
      availableBuildId.value = marker.buildId === options.currentBuildId ? "" : marker.buildId;
    } catch {
      // Offline, an old release without a marker, or a partial deployment must not interrupt work.
    } finally {
      clearTimeout(timeout);
      if (pending === controller) pending = null;
    }
  }

  function checkOnReturn() {
    if (Date.now() - lastCheck >= 30000) void checkForUpdate();
  }
  onMounted(() => {
    if (options.enabled === false || !options.currentBuildId) return;
    stopped = false;
    void checkForUpdate();
    interval = setInterval(() => { void checkForUpdate(); }, 60000);
    window.addEventListener("focus", checkOnReturn);
    window.addEventListener("online", checkOnReturn);
    document.addEventListener("visibilitychange", checkOnReturn);
  });
  onUnmounted(() => {
    stopped = true;
    pending?.abort();
    clearInterval(interval);
    window.removeEventListener("focus", checkOnReturn);
    window.removeEventListener("online", checkOnReturn);
    document.removeEventListener("visibilitychange", checkOnReturn);
  });
  return { availableBuildId, updateAvailable, checkForUpdate };
}
