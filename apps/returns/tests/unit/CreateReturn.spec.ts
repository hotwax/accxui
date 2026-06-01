import { describe, it, expect, beforeEach, vi } from "vitest";
import { setActivePinia, createPinia } from "pinia";
import { mount, flushPromises } from "@vue/test-utils";

vi.stubEnv("VITE_RETURNS_BACKEND", "stub");
vi.mock("@common", () => ({ translate: (s: string) => s, logger: { error: () => {/* noop */} }, emitter: { emit: () => {/* noop */} } }));
vi.mock("@/router", () => ({ default: { push: () => {/* noop */} } }));

import CreateReturn from "@/views/CreateReturn.vue";
import { __resetStub } from "@/adapters/stubAdapter";
import { getReturnsService } from "@/services/ReturnsService";

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

  it("carries the product name onto the created return for display", async () => {
    const wrapper = mount(CreateReturn, { global: { stubs: { "ion-page": false } } });
    (wrapper.vm as any).orderId = "DEMO-1001";
    await (wrapper.vm as any).lookupOrder();
    await flushPromises();
    (wrapper.vm as any).selections["00001"] = { qty: 1, returnReasonId: "RTN_NOT_WANT" };
    const id = await (wrapper.vm as any).submit();

    const created = await getReturnsService().getReturn(id);
    expect(created.items[0].productName).toBe("Classic Tee");
  });

  it("computes kept value and disables the appeasement when nothing is kept", async () => {
    const wrapper = mount(CreateReturn, { global: { stubs: { "ion-page": false } } });
    (wrapper.vm as any).orderId = "DEMO-1001";
    await (wrapper.vm as any).lookupOrder();
    await flushPromises();
    expect((wrapper.vm as any).hasKeptItems).toBe(true);
    (wrapper.vm as any).selections["00001"] = { qty: 2, returnReasonId: "RTN_NOT_WANT" };
    (wrapper.vm as any).selections["00002"] = { qty: 1, returnReasonId: "RTN_NOT_WANT" };
    await flushPromises();
    expect((wrapper.vm as any).hasKeptItems).toBe(false);
  });

  it("blocks submit when the appeasement amount exceeds the kept cap", async () => {
    const wrapper = mount(CreateReturn, { global: { stubs: { "ion-page": false } } });
    (wrapper.vm as any).orderId = "DEMO-1001";
    await (wrapper.vm as any).lookupOrder();
    await flushPromises();
    (wrapper.vm as any).selections["00001"] = { qty: 1, returnReasonId: "RTN_NOT_WANT" };
    (wrapper.vm as any).appeasementEnabled = true;
    (wrapper.vm as any).appeasementAmount = 9999;
    (wrapper.vm as any).appeasementReasonId = "RTN_NOT_WANT";
    await flushPromises();
    expect((wrapper.vm as any).canSubmit).toBe(false);
  });

  it("includes a valid appeasement in the submit payload", async () => {
    const wrapper = mount(CreateReturn, { global: { stubs: { "ion-page": false } } });
    (wrapper.vm as any).orderId = "DEMO-1001";
    await (wrapper.vm as any).lookupOrder();
    await flushPromises();
    (wrapper.vm as any).selections["00001"] = { qty: 1, returnReasonId: "RTN_NOT_WANT" };
    (wrapper.vm as any).appeasementEnabled = true;
    (wrapper.vm as any).appeasementAmount = 10;
    (wrapper.vm as any).appeasementReasonId = "RTN_NOT_WANT";
    expect((wrapper.vm as any).canSubmit).toBe(true);
    const id = await (wrapper.vm as any).submit();
    expect(id).toBeTruthy();
    const { items } = await getReturnsService().listReturns({ pageSize: 50 });
    expect(items.some((r) => r.type === "appeasement")).toBe(true);
  });
});
