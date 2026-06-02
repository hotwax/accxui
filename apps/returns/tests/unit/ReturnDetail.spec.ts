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

function itemAppeasementDetail(): ReturnDetailType {
  return {
    ...appeasementDetail(),
    appeasement: { amount: 32.5, currencyUomId: "USD", reasonId: "APPEASE_GOODWILL", reasonDesc: "Goodwill", relatedReturnId: "30000" },
    items: [
      { orderItemSeqId: "00001", productId: "P1", productName: "Classic Tee", returnQuantity: 1, returnReasonId: "APPEASE_GOODWILL" },
      { orderItemSeqId: "00002", productId: "P2", productName: "Denim Jacket", returnQuantity: 2, returnReasonId: "APPEASE_GOODWILL" },
    ],
  };
}

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

  it("renders the lost product line(s) and summed refund for an item-based appeasement", async () => {
    const store = useReturnsStore();
    store.current = itemAppeasementDetail();
    const wrapper = mount(ReturnDetail, { props: { returnId: "30001" }, global: { stubs: { "ion-page": false } } });
    await flushPromises();
    expect(wrapper.find("[data-testid=detail-appeasement-items]").exists()).toBe(true);
    const text = wrapper.text();
    expect(text).toContain("Classic Tee");
    expect(text).toContain("Denim Jacket");
    expect(wrapper.find("[data-testid=detail-appeasement-amount]").text()).toContain("32.50");
  });

  it("renders no product-line list for an amount-only appeasement", async () => {
    const store = useReturnsStore();
    store.current = appeasementDetail(); // items: []
    const wrapper = mount(ReturnDetail, { props: { returnId: "30001" }, global: { stubs: { "ion-page": false } } });
    await flushPromises();
    expect(wrapper.find("[data-testid=detail-appeasement-items]").exists()).toBe(false);
  });
});

function exchangeDetail(): ReturnDetailType {
  return {
    returnId: "40001", type: "standard", orderId: "DEMO-1001", orderName: "#1001",
    statusId: "RETURN_APPROVED", entryDate: "2026-05-29T12:00:00Z", origin: "pwa",
    sync: { shopify: "pending" },
    shopifySync: { pushStatusId: "PUSH_OK", processStatusId: "PROC_PENDING", shopifyReturnId: "gid://shopify/Return/1" },
    isExchange: true,
    exchange: {
      replacementOrderId: "EXC40001", orderName: "#1001-EXC", fulfillmentType: "SHIPPED",
      orderStatusId: "ORDER_APPROVED",
      items: [{ productId: "P1", quantity: 1, unitPrice: 19.99, itemDescription: "Classic Tee" }],
      exchangeCreditAmount: 0,
    },
    items: [{ orderItemSeqId: "00001", productId: "P1", productName: "Classic Tee", returnQuantity: 1, returnReasonId: "RTN_SIZE_EXCHANGE" }],
    statuses: [{ statusId: "RETURN_REQUESTED", statusDate: "2026-05-29T12:00:00Z" }],
    externalIds: { shopify: "gid://shopify/Return/1" },
  };
}

describe("ReturnDetail.vue (exchange)", () => {
  beforeEach(() => setActivePinia(createPinia()));

  it("renders the exchange badge and the replacement-order card", async () => {
    const store = useReturnsStore();
    store.current = exchangeDetail();
    const wrapper = mount(ReturnDetail, { props: { returnId: "40001" }, global: { stubs: { "ion-page": false } } });
    await flushPromises();
    const text = wrapper.text();
    expect(text).toContain("Exchange");
    expect(text).toContain("EXC40001");      // replacement order id
    expect(text).toContain("Even swap");     // exchangeCreditAmount === 0 copy
    expect(wrapper.find("[data-testid=detail-exchange-card]").exists()).toBe(true);
  });
});
