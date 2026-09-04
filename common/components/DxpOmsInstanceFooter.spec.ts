import { describe, expect, it, vi } from 'vitest';
import { mount } from '@vue/test-utils';

vi.mock('../core/i18n', () => ({ translate: (message: string) => message }));

// Ionic's real components render nothing under jsdom, so they are stubbed the way the rest of
// this monorepo's mounting specs do it — but tagged per component so the structural assertions
// below can still tell a picker row from a label row.
vi.mock('@ionic/vue', () => {
  const passthrough = (name: string) => ({ name, template: `<div data-stub="${name}"><slot /></div>` });

  return {
    IonFooter: passthrough('ion-footer'),
    IonToolbar: passthrough('ion-toolbar'),
    IonItem: passthrough('ion-item'),
    IonLabel: passthrough('ion-label'),
    IonNote: {
      name: 'ion-note',
      props: ['color'],
      template: '<div data-stub="ion-note" :data-color="color"><slot /></div>'
    },
    IonSelect: {
      name: 'ion-select',
      props: ['label', 'value'],
      emits: ['ionChange'],
      template: '<div data-stub="ion-select"><slot /></div>'
    },
    IonSelectOption: passthrough('ion-select-option')
  };
});

import DxpOmsInstanceFooter from './DxpOmsInstanceFooter.vue';

const STORES = [
  { productStoreId: 'STORE', storeName: 'Rails' },
  { productStoreId: 'OUTLET', storeName: 'Rails Outlet' }
];

function render(props: Record<string, unknown> = {}) {
  return mount(DxpOmsInstanceFooter, { props });
}

const picker = (wrapper: any) => wrapper.find('[data-stub="ion-select"]');
const note = (wrapper: any) => wrapper.find('[data-stub="ion-note"]');

describe('DxpOmsInstanceFooter', () => {
  it('shows the instance label and the store name on one row when there is nothing to pick', () => {
    const wrapper = render({
      instanceLabel: 'rails-oms',
      productStores: [STORES[0]],
      currentProductStoreId: 'STORE'
    });

    expect(wrapper.text()).toContain('rails-oms');
    expect(wrapper.text()).toContain('Rails');
    // A lone store needs no picker, so no second row is spent on one.
    expect(picker(wrapper).exists()).toBe(false);
  });

  it('gives the picker its own row once there is more than one store', () => {
    const wrapper = render({
      instanceLabel: 'rails-oms',
      productStores: STORES,
      currentProductStoreId: 'STORE'
    });

    expect(picker(wrapper).exists()).toBe(true);
    expect(wrapper.findAll('[data-stub="ion-select-option"]')).toHaveLength(2);
    // The store name is not also inlined on the label row — the picker already shows it.
    expect(wrapper.find('[data-stub="ion-label"]').text()).toBe('rails-oms');
  });

  it('emits the selected store id, so apps need not dig into the Ionic event', () => {
    const wrapper = render({ productStores: STORES, currentProductStoreId: 'STORE' });

    wrapper.findComponent({ name: 'ion-select' }).vm.$emit('ionChange', { detail: { value: 'OUTLET' } });

    expect(wrapper.emitted('update:productStore')?.[0]?.[0]).toBe('OUTLET');
  });

  it('also passes the raw event through, for apps that must revert the picker', () => {
    // available-to-promise confirms before leaving an unsaved page and puts the picker back
    // when the user declines. ion-select keeps its own display value, so reverting means
    // writing to event.target.value — unreachable from the id alone.
    const wrapper = render({ productStores: STORES, currentProductStoreId: 'STORE' });
    const ionEvent = { detail: { value: 'OUTLET' }, target: { value: 'OUTLET' } };

    wrapper.findComponent({ name: 'ion-select' }).vm.$emit('ionChange', ionEvent);

    expect(wrapper.emitted('update:productStore')?.[0]?.[1]).toBe(ionEvent);
  });

  it('colors the timezone as danger only when the app says it is mismatched', () => {
    expect(note(render({ timeZone: 'America/Los_Angeles' })).attributes('data-color')).toBe('');
    expect(
      note(render({ timeZone: 'America/Los_Angeles', timeZoneMismatched: true })).attributes('data-color')
    ).toBe('danger');
  });

  it('hides the timezone entirely when the app has none', () => {
    expect(note(render({ instanceLabel: 'rails-oms' })).exists()).toBe(false);
  });

  it('hides the clock for apps that do not run one', () => {
    // job-manager, available-to-promise and order-routing show a timezone but no live time.
    expect(note(render({ timeZone: 'America/Los_Angeles' })).text()).toBe('America/Los_Angeles');

    const withClock = render({ timeZone: 'America/Los_Angeles', zoneTime: '5:47 PM' });
    expect(note(withClock).text()).toContain('5:47 PM');
  });

  it('falls back to the store id when a store has no name', () => {
    const wrapper = render({
      productStores: [{ productStoreId: 'STORE' }],
      currentProductStoreId: 'STORE'
    });

    expect(wrapper.text()).toContain('STORE');
  });

  it('shows the sole store when currentProductStoreId is omitted', () => {
    const wrapper = render({
      productStores: [STORES[0]]
    });

    expect(wrapper.text()).toContain('Rails');
    expect(picker(wrapper).exists()).toBe(false);
  });

  it('resolves timezone from accxuiConfig when prop is omitted', async () => {
    const { accxuiConfig } = await import('../core/configRegistry');
    accxuiConfig.value.current = { timeZone: 'America/New_York' };

    const wrapper = render();
    expect(note(wrapper).text()).toContain('America/New_York');

    accxuiConfig.value.current = {};
  });
});

