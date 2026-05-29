import { describe, it, expect, beforeEach, vi } from "vitest";
import { setActivePinia, createPinia } from "pinia";
import { mount, flushPromises } from "@vue/test-utils";

vi.stubEnv("VITE_RETURNS_BACKEND", "stub");
vi.mock("@common", () => ({ translate: (s: string) => s, logger: { error: () => {/* noop */} } }));
vi.mock("@/router", () => ({ default: { push: () => {/* noop */} } }));

import CreateReturn from "@/views/CreateReturn.vue";
import { __resetStub } from "@/adapters/stubAdapter";

describe("CreateReturn.vue", () => {
  beforeEach(() => { setActivePinia(createPinia()); __resetStub(); });

  it("looks up an order and exposes returnable lines", async () => {
    const wrapper = mount(CreateReturn, { global: { stubs: { "ion-page": false } } });
    (wrapper.vm as any).orderId = "DEMO-1001";
    await (wrapper.vm as any).lookupOrder();
    await flushPromises();
    expect((wrapper.vm as any).order.items.length).toBe(2);
    expect((wrapper.vm as any).order.items[0].returnableQty).toBe(2);
  });

  it("submits a return and returns the new id", async () => {
    const wrapper = mount(CreateReturn, { global: { stubs: { "ion-page": false } } });
    (wrapper.vm as any).orderId = "DEMO-1001";
    await (wrapper.vm as any).lookupOrder();
    await flushPromises();
    (wrapper.vm as any).selections["00001"] = { qty: 1, returnReasonId: "RTN_NOT_WANT" };
    const id = await (wrapper.vm as any).submit();
    expect(id).toBeTruthy();
  });
});
