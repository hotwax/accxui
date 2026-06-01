import { describe, it, expect, beforeEach, vi } from "vitest";
import { setActivePinia, createPinia } from "pinia";
import { mount, flushPromises } from "@vue/test-utils";

vi.stubEnv("VITE_RETURNS_BACKEND", "stub");
vi.mock("@/router", () => ({ default: { push: () => {/* noop */} } }));
vi.mock("@common", () => ({
  translate: (s: string) => s,
  emitter: { emit: () => {/* noop */} },
  commonUtil: { showToast: () => {/* noop */}, formatCurrency: (a: number, c: string) => `${c} ${Number(a).toFixed(2)}` },
}));

import ReturnDetail from "@/views/ReturnDetail.vue";
import { useReturnsStore } from "@/store/returnsStore";
import type { ReturnDetail as ReturnDetailType } from "@/types/returns";

function appeasementDetail(): ReturnDetailType {
  return {
    returnId: "30001", type: "appeasement", orderId: "DEMO-1001", orderName: "#1001",
    statusId: "RETURN_REQUESTED", entryDate: "2026-05-29T12:00:00Z", origin: "pwa",
    sync: { shopify: "not_synced" }, shopifySync: null,
    appeasement: { amount: 12.5, currencyUomId: "USD", reasonId: "APPEASE_GOODWILL", reasonDesc: "Goodwill", note: "sorry", relatedReturnId: "30000" },
    items: [], statuses: [{ statusId: "RETURN_REQUESTED", statusDate: "2026-05-29T12:00:00Z" }],
    externalIds: { shopify: null },
  };
}

describe("ReturnDetail.vue (appeasement)", () => {
  beforeEach(() => setActivePinia(createPinia()));

  it("renders the appeasement badge and refund amount", async () => {
    const store = useReturnsStore();
    store.current = appeasementDetail();
    const wrapper = mount(ReturnDetail, { props: { returnId: "30001" }, global: { stubs: { "ion-page": false } } });
    await flushPromises();
    const text = wrapper.text();
    expect(text).toContain("Appeasement");
    expect(text).toContain("USD 12.50");
    expect(text).toContain("Goodwill");
    expect(text).toContain("sorry");        // note renders
    expect(text).toContain("#30000");       // related-return link renders
    expect(text).not.toContain("Quantity:"); // the returned-items list is absent for an appeasement
  });

  it("does not offer Complete for an approved appeasement (refund-only, nothing to close)", async () => {
    const store = useReturnsStore();
    store.current = {
      ...appeasementDetail(), statusId: "RETURN_APPROVED",
      sync: { shopify: "synced" },
      shopifySync: { synced: true, shopifyRefundId: "gid://shopify/Refund/1", pushStatusId: "PUSH_OK" },
    };
    const wrapper = mount(ReturnDetail, { props: { returnId: "30001" }, global: { stubs: { "ion-page": false } } });
    await flushPromises();
    expect(wrapper.find('[data-testid="detail-complete-btn"]').exists()).toBe(false);
  });

  it("shows no misleading 'never synced' completion card for a completed appeasement", async () => {
    const store = useReturnsStore();
    store.current = {
      ...appeasementDetail(), statusId: "RETURN_COMPLETED",
      sync: { shopify: "synced" },
      shopifySync: { synced: true, shopifyRefundId: "gid://shopify/Refund/1", pushStatusId: "PUSH_OK" },
    };
    const wrapper = mount(ReturnDetail, { props: { returnId: "30001" }, global: { stubs: { "ion-page": false } } });
    await flushPromises();
    expect(wrapper.find('[data-testid="detail-completion-chip"]').exists()).toBe(false);
    expect(wrapper.text()).not.toContain("never synced to Shopify");
  });

  it("offers no approve / reject / cancel / complete actions on a completed appeasement", async () => {
    const store = useReturnsStore();
    store.current = {
      ...appeasementDetail(), statusId: "RETURN_COMPLETED",
      sync: { shopify: "synced" },
      shopifySync: { synced: true, shopifyRefundId: "gid://shopify/Refund/1", pushStatusId: "PUSH_OK" },
    };
    const wrapper = mount(ReturnDetail, { props: { returnId: "30001" }, global: { stubs: { "ion-page": false } } });
    await flushPromises();
    expect(wrapper.find('[data-testid="detail-approve-btn"]').exists()).toBe(false);
    expect(wrapper.find('[data-testid="detail-reject-btn"]').exists()).toBe(false);
    expect(wrapper.find('[data-testid="detail-cancel-btn"]').exists()).toBe(false);
    expect(wrapper.find('[data-testid="detail-complete-btn"]').exists()).toBe(false);
  });
});
