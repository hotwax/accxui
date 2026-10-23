// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import { defineComponent, h } from 'vue';
import { useIosKeyboardScroll } from '../composables/useIosKeyboardScroll';

vi.mock('@ionic/vue', () => ({ isPlatform: () => true }));

describe('iOS keyboard viewport scrolling', () => {
  let viewport: EventTarget & { height: number; offsetTop: number; scale: number };
  let wrapper: ReturnType<typeof mount>;
  let content: HTMLElement;
  let scroll: HTMLElement;
  let input: HTMLInputElement;
  let frames: Map<number, FrameRequestCallback>;
  let nextFrame: number;
  const rect = (top: number, height: number) => ({ top, bottom: top + height, height }) as DOMRect;
  const settle = async () => {
    const pending = [...frames.values()]; frames.clear();
    pending.forEach(callback => callback(0));
    await flushPromises();
  };
  const resize = async (height: number) => {
    viewport.height = height;
    viewport.dispatchEvent(new Event('resize'));
    await settle();
  };

  beforeEach(() => {
    frames = new Map(); nextFrame = 0;
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => { frames.set(++nextFrame, callback); return nextFrame; });
    vi.stubGlobal('cancelAnimationFrame', (id: number) => frames.delete(id));
    vi.stubGlobal('innerHeight', 938);
    Object.defineProperty(document.documentElement, 'clientHeight', { configurable: true, value: 938 });
    vi.spyOn(window, 'scrollTo').mockImplementation(() => undefined);
    viewport = Object.assign(new EventTarget(), { height: 938, offsetTop: 0, scale: 1 });
    vi.stubGlobal('visualViewport', viewport);
    wrapper = mount(defineComponent({
      setup() { useIosKeyboardScroll({ pinnedElementSelector: '.scanner', scrollContainerSelector: '.nested-scroll' }); return () => h('ion-content', h('div', h('ion-input', h('input')))); }
    }), { attachTo: document.body });
    content = wrapper.element as HTMLElement;
    scroll = content.querySelector('div')!;
    input = content.querySelector('input')!;
    Object.assign(content, { getScrollElement: async () => scroll });
    scroll.getBoundingClientRect = () => rect(56, 801);
    input.parentElement!.getBoundingClientRect = () => rect(600 - scroll.scrollTop, 56);
    input.focus();
  });
  afterEach(() => {
    wrapper.unmount(); document.body.innerHTML = '';
    delete (document.documentElement as any).clientHeight;
    vi.unstubAllGlobals(); vi.restoreAllMocks();
  });

  it('reveals the whole field above a 484px keyboard, rather than assuming 290px', async () => {
    await resize(454);
    expect(content.style.getPropertyValue('--keyboard-offset')).toBe('484px');
    expect(scroll.scrollTop).toBe(202);
    expect(input.parentElement!.getBoundingClientRect().bottom).toBe(454);
  });

  it('removes keyboard space when dismissed without blurring the field', async () => {
    await resize(454); await resize(938);
    expect(document.activeElement).toBe(input);
    expect(content.style.getPropertyValue('--keyboard-offset')).toBe('0px');
    expect(scroll.scrollTop).toBe(202);
  });

  it('keeps an input below a pinned scanner when changing focus', async () => {
    const scanner = document.createElement('div'); scanner.className = 'scanner'; content.prepend(scanner);
    scanner.getBoundingClientRect = () => rect(56, 80);
    scroll.scrollTop = 500;
    await resize(454);
    expect(input.parentElement!.getBoundingClientRect().top).toBe(136);
  });

  it('scrolls a configured inner panel instead of moving the outer page', async () => {
    const panel = document.createElement('div'); panel.className = 'nested-scroll';
    const field = input.parentElement!;
    scroll.append(panel); panel.append(field);
    panel.getBoundingClientRect = () => rect(56, 398);
    field.getBoundingClientRect = () => rect(600 - panel.scrollTop - scroll.scrollTop, 56);
    input.focus();
    await resize(454);
    expect(panel.scrollTop).toBe(202);
    expect(scroll.scrollTop).toBe(0);
    expect(field.getBoundingClientRect().bottom).toBe(454);
  });

  it('uses the outer scroller when an inner panel has reached its limit', async () => {
    const panel = document.createElement('div'); panel.className = 'nested-scroll';
    const field = input.parentElement!;
    scroll.append(panel); panel.append(field);
    let top = 0;
    Object.defineProperty(panel, 'scrollTop', { get: () => top, set: value => { top = Math.min(100, Math.max(0, value)); } });
    panel.getBoundingClientRect = () => rect(56 - scroll.scrollTop, 600);
    field.getBoundingClientRect = () => rect(600 - top - scroll.scrollTop, 56);
    input.focus();
    await resize(454);
    expect(panel.scrollTop).toBe(100);
    expect(scroll.scrollTop).toBe(102);
    expect(field.getBoundingClientRect().bottom).toBe(454);
  });

  it('restores an existing offset when focus leaves the content', async () => {
    content.style.setProperty('--keyboard-offset', '12px');
    await resize(454);
    input.blur(); await settle();
    expect(content.style.getPropertyValue('--keyboard-offset')).toBe('12px');
  });

  it('ignores an obsolete scroll lookup after focus changes', async () => {
    let resolve!: (element: HTMLElement) => void;
    Object.assign(content, { getScrollElement: () => new Promise<HTMLElement>(done => { resolve = done; }) });
    await resize(454);
    input.blur(); await settle();
    resolve(scroll); await flushPromises();
    expect(scroll.scrollTop).toBe(0);
    expect(content.style.getPropertyValue('--keyboard-offset')).toBe('');
  });

  it('uses the layout viewport and clears Safari document panning', async () => {
    vi.stubGlobal('innerHeight', 680);
    viewport.offsetTop = 258;
    await resize(454);
    expect(content.style.getPropertyValue('--keyboard-offset')).toBe('484px');
    expect(window.scrollTo).toHaveBeenCalledWith(0, 0);
  });

  it('does not treat pinch zoom as a keyboard', async () => {
    viewport.scale = 2;
    await resize(454);
    expect(scroll.scrollTop).toBe(0);
    expect(content.style.getPropertyValue('--keyboard-offset')).toBe('');
  });

  it('restores padding and removes listeners when unmounted', async () => {
    await resize(454); wrapper.unmount();
    expect(content.style.getPropertyValue('--keyboard-offset')).toBe('');
    await resize(300);
    expect(frames.size).toBe(0);
    expect(scroll.scrollTop).toBe(202);
  });
});
