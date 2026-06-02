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

import ExchangeDetail from "@/views/ExchangeDetail.vue";
import { useReturnsStore } from "@/store/returnsStore";
import { getReturnsService } from "@/services/ReturnsService";

beforeEach(() => setActivePinia(createPinia()));

async function makeExchange(fulfillmentType: "SHIPPED" | "IMMEDIATE") {
  const svc = getReturnsService();
  const { returnId } = await svc.createExchange({
    orderId: "DEMO-1001",
    returnItems: [{ orderItemSeqId: "00001", returnQuantity: 1, returnReasonId: "RTN_SIZE_EXCHANGE" }],
    exchangeItems: [{ productId: "P1", quantity: 1 }],
    fulfillmentType,
    ...(fulfillmentType === "SHIPPED" ? { shipmentMethodTypeId: "STANDARD" } : { facilityId: "STORE_DT" }),
  });
  return returnId;
}

describe("ExchangeDetail", () => {
  it("shipped: read-only — no approve/complete/cancel buttons; sync settles to Exchange confirmed", async () => {
    const returnId = await makeExchange("SHIPPED");
    const wrapper = mount(ExchangeDetail, { props: { returnId }, global: { stubs: { "ion-page": false } } });
    await (wrapper.vm as any).enter();
    await flushPromises();
    expect(wrapper.find("[data-testid=exchange-approve-btn]").exists()).toBe(false);
    expect(wrapper.find("[data-testid=exchange-complete-btn]").exists()).toBe(false);
    expect(wrapper.find("[data-testid=exchange-cancel-btn]").exists()).toBe(false);
    const store = useReturnsStore();
    expect(store.current?.sync.shopify).toBe("synced");
  });

  it("immediate: read-only — no action buttons", async () => {
    const returnId = await makeExchange("IMMEDIATE");
    const wrapper = mount(ExchangeDetail, { props: { returnId }, global: { stubs: { "ion-page": false } } });
    await (wrapper.vm as any).enter();
    await flushPromises();
    expect(wrapper.find("[data-testid=exchange-approve-btn]").exists()).toBe(false);
    expect(wrapper.find("[data-testid=exchange-complete-btn]").exists()).toBe(false);
    expect(wrapper.find("[data-testid=exchange-cancel-btn]").exists()).toBe(false);
  });
});
