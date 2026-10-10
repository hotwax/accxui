import type { Directive } from "vue";

/**
 * Keeps segmented content from shrinking under the user when they switch segments.
 *
 * Put it on the element that holds the segments' content, bound to the selected segment:
 *
 *   <div v-segment-height="selectedSegment">
 *     <ItemsSegment v-if="selectedSegment === 'items'" />
 *     <RoutingSegment v-else-if="selectedSegment === 'routing'" />
 *   </div>
 *
 * When the bound segment changes, the element keeps at least the height it had on the segment being
 * left. Without it, a shorter segment shortens the page, the browser clamps the scroll position of a
 * user who had scrolled down to the segments, and the page jumps. Taller content grows as usual.
 *
 * The height is held before the new segment renders, so the page is never shorter for even a frame.
 * If the switch also grows the visible area (a footer shown on only one segment goes away), the
 * element takes the extra height too, and the scroll position stays where the user left it.
 * To start over (another record loaded into the same page), give the element a new `key`.
 */

type SegmentElement = HTMLElement & { segmentScroll?: { scroller: HTMLElement; top: number } };

/** The element that scrolls the page: an Ionic page's content, else the document. */
function scrollerOf(el: HTMLElement): HTMLElement | null {
  const content = el.closest("ion-content");
  const inner = content?.shadowRoot?.querySelector<HTMLElement>(".inner-scroll");

  return inner || (content ? null : (document.scrollingElement || document.documentElement) as HTMLElement);
}

/** min-height measures the content box unless the element says otherwise. */
function frameHeight(el: HTMLElement): number {
  const style = getComputedStyle(el);
  if(style.boxSizing === "border-box") {return 0;}

  return [style.paddingTop, style.paddingBottom, style.borderTopWidth, style.borderBottomWidth]
    .reduce((sum, value) => sum + (parseFloat(value) || 0), 0);
}

export const segmentHeight: Directive<SegmentElement, unknown> = {
  beforeUpdate(el, binding) {
    if(binding.value === binding.oldValue) {return;}
    const height = el.offsetHeight;
    if(height) {el.style.minHeight = `${height - frameHeight(el)}px`;}
    const scroller = scrollerOf(el);
    el.segmentScroll = scroller ? { scroller, top: scroller.scrollTop } : undefined;
  },
  updated(el, binding) {
    if(binding.value === binding.oldValue || !el.segmentScroll) {return;}
    const { scroller, top } = el.segmentScroll;
    el.segmentScroll = undefined;
    // Room the page needs for the user to stay where they were in a taller visible area.
    const missing = top + scroller.clientHeight - scroller.scrollHeight;
    if(missing > 0) {el.style.minHeight = `${(parseFloat(el.style.minHeight) || 0) + missing}px`;}
    if(scroller.scrollTop !== top) {scroller.scrollTop = top;}
  }
};

export default segmentHeight;
