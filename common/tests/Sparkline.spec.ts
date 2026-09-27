import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';
import Sparkline from '../components/Sparkline.vue';

describe('Sparkline accessibility', () => {
  it('names a labelled trend as an image', () => {
    const svg = mount(Sparkline, { props: { points: [2, 6, 4], label: 'Unfillable orders over the last seven days' } }).get('svg');

    expect(svg.attributes('role')).toBe('img');
    expect(svg.attributes('aria-label')).toBe('Unfillable orders over the last seven days');
    expect(svg.attributes('aria-hidden')).toBeUndefined();
  });

  it('hides an unlabelled trend from assistive technology as decoration', () => {
    const svg = mount(Sparkline, { props: { points: [2, 6, 4] } }).get('svg');

    expect(svg.attributes('role')).toBe('presentation');
    expect(svg.attributes('aria-hidden')).toBe('true');
    expect(svg.attributes('aria-label')).toBeUndefined();
  });

  it('draws a single value as a dot rather than a line', () => {
    const wrapper = mount(Sparkline, { props: { points: [5], label: 'One day' } });

    expect(wrapper.find('polyline').exists()).toBe(false);
    expect(wrapper.find('line').exists()).toBe(true);
  });
});
