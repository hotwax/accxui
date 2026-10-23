import { supportsIosKeyboardScroll } from '../utils/keyboardScroll';
import { onMounted, onUnmounted } from 'vue';

export interface IosKeyboardScrollOptions {
  /** Scrollable ancestors inside ion-content, from the app's layout. */
  scrollContainerSelector?: string;
  /** Pinned elements that must not cover the focused field. */
  pinnedElementSelector?: string;
}

// Safari's keyboard can be taller than Ionic's estimate, or collapse to a hardware
// keyboard toolbar without blurring the input. Keep the real viewport authoritative.
export function useIosKeyboardScroll(options: IosKeyboardScrollOptions = {}) {
  if (!supportsIosKeyboardScroll()) return;
  const viewport = window.visualViewport!;

  let frame = 0;
  let revision = 0;
  let paddedContent: HTMLIonContentElement | undefined;
  let originalPadding = '';
  const restorePadding = () => {
    if (!paddedContent) return;
    if (originalPadding) paddedContent.style.setProperty('--keyboard-offset', originalPadding);
    else paddedContent.style.removeProperty('--keyboard-offset');
    paddedContent = undefined;
  };
  const revealInput = async (currentRevision: number) => {
    const input = document.activeElement;
    const content = input?.closest('ion-content') as HTMLIonContentElement | null;
    if (!(input instanceof HTMLInputElement || input instanceof HTMLTextAreaElement) || !content || viewport.scale !== 1) {
      restorePadding();
      return;
    }
    if (content !== paddedContent) {
      restorePadding();
      paddedContent = content;
      originalPadding = content.style.getPropertyValue('--keyboard-offset');
    }
    // Safari can shrink innerHeight while panning the page to a focused input.
    // The Ionic layout viewport remains stable and gives the actual keyboard size.
    const layoutHeight = document.documentElement.clientHeight || window.innerHeight;
    const keyboardHeight = Math.max(0, layoutHeight - viewport.height);
    content.style.setProperty('--keyboard-offset', `${keyboardHeight}px`);
    if (!keyboardHeight) return;
    // Ionic owns page scrolling. Undo Safari's document pan so headers and pinned
    // controls remain on screen; the viewport event schedules the settled geometry.
    if (viewport.offsetTop > 0 || window.scrollY > 0) window.scrollTo(window.scrollX, 0);
    const scroll = await content.getScrollElement();
    if (currentRevision !== revision || document.activeElement !== input) return;
    const field = input.closest('ion-input, ion-textarea, ion-searchbar') || input;
    const containers: HTMLElement[] = [];
    for (let ancestor = input.parentElement; ancestor && ancestor !== content; ancestor = ancestor.parentElement) {
      if (options.scrollContainerSelector && ancestor.matches(options.scrollContainerSelector)) containers.push(ancestor);
    }
    containers.push(scroll);
    const pinnedElements = options.pinnedElementSelector
      ? [...content.querySelectorAll(options.pinnedElementSelector)] : [];
    for (const container of containers) {
      const bounds = container.getBoundingClientRect();
      const visibleTop = Math.max(bounds.top, viewport.offsetTop);
      const visibleBottom = Math.min(bounds.bottom, viewport.offsetTop + viewport.height);
      const top = pinnedElements.reduce((edge, pinned) => {
        const pinnedBounds = pinned.getBoundingClientRect();
        return !pinned.contains(input) && pinnedBounds.top <= visibleTop && pinnedBounds.bottom > visibleTop
          ? Math.max(edge, pinnedBounds.bottom) : edge;
      }, visibleTop);
      const bottom = pinnedElements.reduce((edge, pinned) => {
        const pinnedBounds = pinned.getBoundingClientRect();
        return !pinned.contains(input) && pinnedBounds.bottom >= visibleBottom && pinnedBounds.top < visibleBottom
          ? Math.min(edge, pinnedBounds.top) : edge;
      }, visibleBottom);
      const rect = field.getBoundingClientRect();
      // Prefer the top edge if a very short viewport cannot fit the entire control.
      const delta = rect.top < top || rect.height > bottom - top
        ? rect.top - top : Math.max(0, rect.bottom - bottom);
      container.scrollTop += delta > 0 ? Math.ceil(delta) : Math.floor(delta);
    }
  };
  const schedule = () => {
    const currentRevision = ++revision;
    cancelAnimationFrame(frame);
    frame = requestAnimationFrame(() => { void revealInput(currentRevision); });
  };
  onMounted(() => {
    document.addEventListener('focusin', schedule);
    document.addEventListener('focusout', schedule);
    viewport.addEventListener('resize', schedule);
    viewport.addEventListener('scroll', schedule);
  });
  onUnmounted(() => {
    ++revision;
    cancelAnimationFrame(frame);
    document.removeEventListener('focusin', schedule);
    document.removeEventListener('focusout', schedule);
    viewport.removeEventListener('resize', schedule);
    viewport.removeEventListener('scroll', schedule);
    restorePadding();
  });
}
