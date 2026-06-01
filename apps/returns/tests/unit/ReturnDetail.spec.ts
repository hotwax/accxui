import { describe, it, expect, beforeEach, vi } from "vitest";
import { setActivePinia, createPinia } from "pinia";
import { mount, flushPromises } from "@vue/test-utils";

vi.stubEnv("VITE_RETURNS_BACKEND", "stub");
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
  });
});
