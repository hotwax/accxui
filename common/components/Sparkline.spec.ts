// @vitest-environment jsdom

import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';
import Sparkline from './Sparkline.vue';

describe('Sparkline accessibility', () => {
  it('exposes a labeled SVG as an image with the supplied accessible name', () => {
    const wrapper = mount(Sparkline, {
      props: {
        points: [2, 6, 4],
        ariaLabel: 'Unfillable orders over the last seven days'
      }
    });

    const sparkline = wrapper.get('svg');
    expect(sparkline.attributes('role')).toBe('img');
    expect(sparkline.attributes('aria-label')).toBe('Unfillable orders over the last seven days');
    expect(sparkline.attributes('aria-hidden')).toBeUndefined();
  });

  it('hides an unlabeled SVG from assistive technology', () => {
    const wrapper = mount(Sparkline, {
      props: {
        points: [2, 6, 4]
      }
    });

    const sparkline = wrapper.get('svg');
    expect(sparkline.attributes('aria-hidden')).toBe('true');
    expect(sparkline.attributes('role')).toBeUndefined();
    expect(sparkline.attributes('aria-label')).toBeUndefined();
  });

  it('preserves the normalized polyline geometry for varying values', () => {
    const wrapper = mount(Sparkline, {
      props: {
        points: [2, 6, 4],
        ariaLabel: 'Trend'
      }
    });

    expect(wrapper.get('polyline').attributes('points')).toBe('0,28 50,2 100,15');
  });
});
