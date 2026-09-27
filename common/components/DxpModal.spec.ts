import { flushPromises, mount } from "@vue/test-utils";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { defineComponent, h, ref } from "vue";

const mocks = vi.hoisted(() => ({
  alert: vi.fn(),
  alertRole: "cancel",
  modalCreate: vi.fn(),
  toast: vi.fn(),
  toastPresent: vi.fn(),
}));

vi.mock("../core/i18n", () => ({ translate: (message: string) => message }));
vi.mock("../core/logger", () => ({ default: { error: vi.fn(), warn: vi.fn() } }));
vi.mock("../utils/commonUtil", () => ({ commonUtil: { showToast: mocks.toast } }));

// Ionic's real components render nothing under jsdom, so each is a tagged stand-in.
vi.mock("@ionic/vue", () => {
  const passthrough = (name: string) => ({ name, template: `<div data-stub="${name}"><slot /></div>` });
  const button = (name: string) => ({ name, props: ["disabled"], template: `<button data-stub="${name}" :disabled="disabled"><slot /></button>` });

  return {
    IonHeader: passthrough("ion-header"),
    IonToolbar: passthrough("ion-toolbar"),
    IonButtons: passthrough("ion-buttons"),
    IonTitle: passthrough("ion-title"),
    IonContent: passthrough("ion-content"),
    IonFab: passthrough("ion-fab"),
    IonIcon: passthrough("ion-icon"),
    IonSpinner: passthrough("ion-spinner"),
    IonButton: button("ion-button"),
    IonFabButton: button("ion-fab-button"),
    alertController: {
      create: (options: unknown) => {
        mocks.alert(options);

        return Promise.resolve({ present: vi.fn(), onDidDismiss: () => Promise.resolve({ role: mocks.alertRole }) });
      },
    },
    modalController: { create: mocks.modalCreate },
  };
});

import { type ModalFlowOptions, useModalFlow } from "../composables/useModalFlow";
import { openModal } from "../utils/modal";
import DxpModal from "./DxpModal.vue";

/** A modal built on DxpModal, inside an ion-modal that dismisses the way Ionic does: only if canDismiss agrees. */
function render(options?: ModalFlowOptions<unknown>) {
  const host: any = document.createElement("ion-modal");
  host.closed = null;
  host.dismiss = async (data?: unknown, role?: string) => {
    if(!(await host.canDismiss(data, role))) {return false;}
    host.closed = { data, role };

    return true;
  };
  const slot = document.createElement("div");
  host.appendChild(slot);
  document.body.appendChild(host);

  const wrapper = mount(defineComponent({
    setup() {
      if(options) {useModalFlow(options);}

      return () => h(DxpModal, { title: "Add task" }, () => h("p", "fields"));
    },
  }), { attachTo: slot });
  const close = () => wrapper.get("[data-stub=\"ion-button\"]");
  const fab = () => wrapper.find("[data-stub=\"ion-fab-button\"]");

  return { wrapper, host, close, fab };
}

const DEFAULT_EXIT_ALERT = {
  header: "Discard changes",
  message: "What you entered will be lost.",
  buttons: [{ text: "Keep editing", role: "cancel" }, { text: "Discard", role: "confirm" }],
};

describe("DxpModal", () => {
  beforeEach(() => {
    mocks.alert.mockReset();
    mocks.toast.mockReset().mockImplementation((_message: string, options?: { manualDismiss?: boolean }) =>
      (options?.manualDismiss ? { present: mocks.toastPresent } : undefined));
    mocks.toastPresent.mockReset();
  });

  it("draws the title and the content, and a confirm button only for a modal that confirms", () => {
    const viewer = render();
    expect(viewer.wrapper.get("[data-stub=\"ion-title\"]").text()).toBe("Add task");
    expect(viewer.wrapper.text()).toContain("fields");
    expect(viewer.fab().exists()).toBe(false);

    expect(render({ confirm: () => true }).fab().exists()).toBe(true);
  });

  it("closes a clean modal without asking", async () => {
    const { close, host } = render();
    await close().trigger("click");
    await flushPromises();
    expect(mocks.alert).not.toHaveBeenCalled();
    expect(host.closed).toEqual({ data: undefined, role: "cancel" });
  });

  it("asks before any way out of a dirty modal, and stays when told to", async () => {
    const { host } = render({ dirty: ref(true) });
    mocks.alertRole = "cancel";
    expect(await host.dismiss(undefined, "backdrop")).toBe(false);
    expect(mocks.alert).toHaveBeenCalledWith(DEFAULT_EXIT_ALERT);

    mocks.alertRole = "confirm";
    expect(await host.dismiss(undefined, "backdrop")).toBe(true);
  });

  it("uses the modal’s own exit alert when it has one", async () => {
    const { close } = render({ dirty: true, exitAlert: { title: "Discard task", body: "The task will not be created.", confirmText: "Discard task" } });
    mocks.alertRole = "cancel";
    await close().trigger("click");
    await flushPromises();
    expect(mocks.alert).toHaveBeenCalledWith({
      header: "Discard task",
      message: "The task will not be created.",
      buttons: [{ text: "Cancel", role: "cancel" }, { text: "Discard task", role: "confirm" }],
    });
  });

  it("confirms without asking about the input it just saved, and closes with the result", async () => {
    const { fab, host } = render({ dirty: true, confirm: () => Promise.resolve("task-1") });
    await fab().trigger("click");
    await flushPromises();
    expect(mocks.alert).not.toHaveBeenCalled();
    expect(host.closed).toEqual({ data: "task-1", role: "confirm" });
  });

  it("closes with true when the work returns nothing", async () => {
    const { fab, host } = render({ confirm: () => undefined });
    await fab().trigger("click");
    await flushPromises();
    expect(host.closed).toEqual({ data: true, role: "confirm" });
  });

  it("stays open and shows the work’s own error text, kept up when asked", async () => {
    const { fab, host } = render({ confirm: () => Promise.reject(new Error("Failed to create tasks.")), persistError: true });
    await fab().trigger("click");
    await flushPromises();
    expect(host.closed).toBeNull();
    expect(mocks.toast).toHaveBeenCalledWith("Failed to create tasks.", { manualDismiss: true, canDismiss: true });
    expect(mocks.toastPresent).toHaveBeenCalled();
  });

  it("shows a generic error for a failure the work did not word", async () => {
    const { fab } = render({ confirm: () => Promise.reject(new TypeError("x is undefined")) });
    await fab().trigger("click");
    await flushPromises();
    expect(mocks.toast).toHaveBeenCalledWith("Something went wrong. Please try again.");
  });

  it("refuses every way out while the work runs", async () => {
    let finish!: () => void;
    const { close, fab, host } = render({ confirm: () => new Promise<void>((resolve) => { finish = resolve; }) });
    await fab().trigger("click");
    expect(close().attributes("disabled")).toBeDefined();
    expect(await host.dismiss(undefined, "backdrop")).toBe(false);
    finish();
    await flushPromises();
    expect(host.closed?.role).toBe("confirm");
  });

  it("does nothing until it can confirm, and asks first when told to", async () => {
    const work = vi.fn();
    const blocked = render({ canConfirm: false, confirm: work });
    expect(blocked.fab().attributes("disabled")).toBeDefined();

    const asked = render({ confirm: work, confirmAlert: { title: "Release order", body: "The order goes to fulfillment.", confirmText: "Release" } });
    mocks.alertRole = "cancel";
    await asked.fab().trigger("click");
    await flushPromises();
    expect(work).not.toHaveBeenCalled();
    expect(asked.host.closed).toBeNull();
  });
});

describe("openModal", () => {
  it("resolves with the confirm result, and with undefined for any other way out", async () => {
    const dismissWith = (result: { data?: unknown; role?: string }) => mocks.modalCreate.mockResolvedValueOnce({
      present: vi.fn(),
      onWillDismiss: () => Promise.resolve(result),
    });

    dismissWith({ data: "PARKING_1", role: "confirm" });
    expect(await openModal({})).toBe("PARKING_1");
    dismissWith({ data: "PARKING_1", role: "backdrop" });
    expect(await openModal({})).toBeUndefined();
  });
});
