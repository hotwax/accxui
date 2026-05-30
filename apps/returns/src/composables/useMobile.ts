import { ref, onMounted, onUnmounted } from "vue";

/** Reactive flag: true below the desktop breakpoint. Mirrors the shared transfers composable. */
export function useMobile(breakpoint = 990) {
  const mediaQueryList = window.matchMedia(`(max-width: ${breakpoint}px)`);
  const isMobile = ref(mediaQueryList.matches);

  function updateIsMobile(e: MediaQueryListEvent) {
    isMobile.value = e.matches;
  }

  onMounted(() => mediaQueryList.addEventListener("change", updateIsMobile as EventListener));
  onUnmounted(() => mediaQueryList.removeEventListener("change", updateIsMobile as EventListener));

  return isMobile;
}
