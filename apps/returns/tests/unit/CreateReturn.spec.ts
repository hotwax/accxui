import { describe, it, expect, beforeEach, vi } from "vitest";
import { setActivePinia, createPinia } from "pinia";
import { mount, flushPromises } from "@vue/test-utils";

vi.stubEnv("VITE_RETURNS_BACKEND", "stub");
vi.mock("@common", () => ({ translate: (s: string) => s, logger: { error: () => {/* noop */} }, emitter: { emit: () => {/* noop */} }, commonUtil: { showToast: () => {/* noop */} } }));
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

  it("gives a specific hint: a valid amount alone asks only for a reason, not an amount error", async () => {
    const wrapper = mount(CreateReturn, { global: { stubs: { "ion-page": false } } });
    (wrapper.vm as any).orderId = "DEMO-1001";
    await (wrapper.vm as any).lookupOrder();
    await flushPromises();
    (wrapper.vm as any).selections["00001"] = { qty: 1, returnReasonId: "RTN_NOT_WANT" };
    (wrapper.vm as any).appeasementEnabled = true;
    // A valid amount (within the kept cap) but no reason yet → hint names the reason, not the amount.
    (wrapper.vm as any).appeasementAmount = 10;
    await flushPromises();
    expect((wrapper.vm as any).appeasementHint.toLowerCase()).toContain("reason");
    expect((wrapper.vm as any).appeasementHint.toLowerCase()).not.toContain("amount");
    // An over-cap amount → hint names the amount/cap, not the reason.
    (wrapper.vm as any).appeasementAmount = 9999;
    await flushPromises();
    expect((wrapper.vm as any).appeasementHint.toLowerCase()).toContain("amount");
    // A fully valid appeasement → no hint at all.
    (wrapper.vm as any).appeasementAmount = 10;
    (wrapper.vm as any).appeasementReasonId = "APPEASE_GOODWILL";
    await flushPromises();
    expect((wrapper.vm as any).appeasementHint).toBe("");
  });

  it("allows a stand-alone appeasement submit (customer keeps everything, no item returned)", async () => {
    const wrapper = mount(CreateReturn, { global: { stubs: { "ion-page": false } } });
    (wrapper.vm as any).orderId = "DEMO-1001";
    await (wrapper.vm as any).lookupOrder();
    await flushPromises();
    // No item selected for return — a pure goodwill refund on a fully-kept order.
    (wrapper.vm as any).appeasementEnabled = true;
    (wrapper.vm as any).appeasementAmount = 10;
    (wrapper.vm as any).appeasementReasonId = "APPEASE_GOODWILL";
    await flushPromises();
    expect((wrapper.vm as any).canSubmit).toBe(true);
    const id = await (wrapper.vm as any).submit();
    expect(id).toBeTruthy();
    const created = await getReturnsService().getReturn(id!);
    expect(created.type).toBe("appeasement");
  });

  it("includes a valid appeasement in the submit payload", async () => {
    const wrapper = mount(CreateReturn, { global: { stubs: { "ion-page": false } } });
    (wrapper.vm as any).orderId = "DEMO-1001";
    await (wrapper.vm as any).lookupOrder();
    await flushPromises();
    expect((wrapper.vm as any).appeasementReasons.some((r: any) => r.returnReasonId.startsWith("APPEASE_"))).toBe(true);
    (wrapper.vm as any).selections["00001"] = { qty: 1, returnReasonId: "RTN_NOT_WANT" };
    (wrapper.vm as any).appeasementEnabled = true;
    (wrapper.vm as any).appeasementAmount = 10;
    (wrapper.vm as any).appeasementReasonId = "APPEASE_GOODWILL";
    expect((wrapper.vm as any).canSubmit).toBe(true);
    const id = await (wrapper.vm as any).submit();
    expect(id).toBeTruthy();
    const { items } = await getReturnsService().listReturns({ pageSize: 50 });
    expect(items.some((r) => r.type === "appeasement")).toBe(true);
  });

  it("items mode: picking a lost item auto-fills the amount and submits an item-based appeasement", async () => {
    const wrapper = mount(CreateReturn, { global: { stubs: { "ion-page": false } } });
    (wrapper.vm as any).orderId = "DEMO-1001";
    await (wrapper.vm as any).lookupOrder();
    await flushPromises();
    // Keep everything (no standard-return selections) so the appeasement is eligible.
    (wrapper.vm as any).appeasementEnabled = true;
    (wrapper.vm as any).setAppeasementMode("items");
    (wrapper.vm as any).setAppeasementQty("00001", 1); // Classic Tee @ 19.99
    (wrapper.vm as any).appeasementReasonId = "APPEASE_GOODWILL";
    await flushPromises();
    // Amount auto-fills to the picked-line total and the form is valid.
    expect((wrapper.vm as any).appeasementAmount).toBeCloseTo(19.99, 2);
    expect((wrapper.vm as any).appeasementValid).toBe(true);

    const id = await (wrapper.vm as any).submit();
    const detail = await getReturnsService().getReturn(id);
    expect(detail.type).toBe("appeasement");
    expect(detail.items[0].productId).toBe("P1");
    expect(detail.appeasement?.amount).toBeCloseTo(19.99, 2);
  });

  it("items mode: an over-cap override is invalid and hints the cap", async () => {
    const wrapper = mount(CreateReturn, { global: { stubs: { "ion-page": false } } });
    (wrapper.vm as any).orderId = "DEMO-1001";
    await (wrapper.vm as any).lookupOrder();
    await flushPromises();
    (wrapper.vm as any).appeasementEnabled = true;
    (wrapper.vm as any).setAppeasementMode("items");
    (wrapper.vm as any).setAppeasementQty("00001", 1);
    (wrapper.vm as any).appeasementReasonId = "APPEASE_GOODWILL";
    // keptValue for the full order = 2*19.99 + 1*49 = 88.98; an override above that is invalid.
    (wrapper.vm as any).onAppeasementAmountInput(9999);
    await flushPromises();
    expect((wrapper.vm as any).appeasementValid).toBe(false);
    expect((wrapper.vm as any).appeasementHint).toContain("kept-item value");
  });

  it("items mode: no picked line blocks submit with a 'pick' hint", async () => {
    const wrapper = mount(CreateReturn, { global: { stubs: { "ion-page": false } } });
    (wrapper.vm as any).orderId = "DEMO-1001";
    await (wrapper.vm as any).lookupOrder();
    await flushPromises();
    (wrapper.vm as any).appeasementEnabled = true;
    (wrapper.vm as any).setAppeasementMode("items");
    (wrapper.vm as any).appeasementReasonId = "APPEASE_GOODWILL";
    await flushPromises();
    expect((wrapper.vm as any).appeasementValid).toBe(false);
    expect((wrapper.vm as any).appeasementHint).toContain("Pick at least one lost item");
  });
});
