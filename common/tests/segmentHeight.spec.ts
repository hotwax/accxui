// @vitest-environment jsdom

import { mount } from "@vue/test-utils";
import { describe, expect, it } from "vitest";
import { defineComponent, h, nextTick, ref, withDirectives } from "vue";
import { segmentHeight } from "../directives/segmentHeight";

// jsdom does no layout, so each segment declares the height it would render at.
const HEIGHTS: Record<string, number> = { items: 900, routing: 300, holds: 1200 };

function mountSegments(style: Record<string, string> = {}) {
  const selected = ref("items");
  let heldAtRender = "";
  const wrapper = mount(defineComponent({
    setup: () => () => withDirectives(h("div", { style, "data-segment": selected.value }, [
      h("p", {
        // Records the element's min-height at the moment the new segment's content renders.
        ref: (child) => { heldAtRender = ((child as HTMLElement | null)?.parentElement?.style.minHeight) ?? heldAtRender; }
      }, selected.value)
    ]), [[segmentHeight, selected.value]])
  }), { attachTo: document.body });
  const el = wrapper.element as HTMLElement;
  Object.defineProperty(el, "offsetHeight", {
    configurable: true,
    get: () => {
      const natural = HEIGHTS[el.dataset.segment || ""] || 0;
      const computed = getComputedStyle(el);
      const frame = ["paddingTop", "paddingBottom"].reduce((sum, side) => sum + (parseFloat(computed[side as "paddingTop"]) || 0), 0);

      return Math.max(natural, parseFloat(el.style.minHeight) || 0) + frame;
    }
  });

  return { selected, el, wrapper, heldAtRender: () => heldAtRender };
}

describe("v-segment-height", () => {
  it("holds the height of the segment being left, before the new one renders", async () => {
    const { selected, el, heldAtRender } = mountSegments();

    selected.value = "routing";
    await nextTick();

    expect(el.style.minHeight).toBe("900px");
    expect(heldAtRender()).toBe("900px");
    expect(el.offsetHeight).toBe(900);
  });

  it("lets taller content grow, and never shrinks below the tallest segment left", async () => {
    const { selected, el } = mountSegments();

    selected.value = "holds";
    await nextTick();
    expect(el.offsetHeight).toBe(1200);

    selected.value = "routing";
    await nextTick();
    expect(el.style.minHeight).toBe("1200px");
  });

  it("does not grow a padded element on every switch", async () => {
    const { selected, el } = mountSegments({ padding: "16px" });

    selected.value = "routing";
    await nextTick();
    selected.value = "items";
    await nextTick();
    selected.value = "routing";
    await nextTick();

    expect(el.style.minHeight).toBe("900px");
    expect(el.offsetHeight).toBe(932);
  });

  it("keeps the scroll position when the switch also grows the visible area", async () => {
    // A footer shown only on "items" goes away on "routing": the page's visible area grows by 56px
    // while the user is scrolled to the bottom, so the page needs 56px more to keep them in place.
    const ABOVE = 1293;
    const { selected, el } = mountSegments();
    const page = document.documentElement;
    let top = 1186; // the bottom: 1293 above + 900 of segment - 1007 visible
    Object.defineProperty(page, "clientHeight", { configurable: true, get: () => (el.dataset.segment === "items" ? 1007 : 1063) });
    Object.defineProperty(page, "scrollHeight", { configurable: true, get: () => ABOVE + el.offsetHeight });
    Object.defineProperty(page, "scrollTop", {
      configurable: true,
      get: () => Math.min(top, page.scrollHeight - page.clientHeight),
      set: (value: number) => { top = value; }
    });
    expect(page.scrollTop).toBe(1186);

    selected.value = "routing";
    await nextTick();

    expect(el.style.minHeight).toBe("956px");
    expect(page.scrollTop).toBe(1186);
  });

  it("leaves the element alone when it re-renders on the same segment", async () => {
    const { el, wrapper } = mountSegments();

    await wrapper.vm.$forceUpdate();
    await nextTick();

    expect(el.style.minHeight).toBe("");
  });
});
