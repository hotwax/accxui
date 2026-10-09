import { alertController } from "@ionic/vue";
import { type MaybeRefOrGetter, computed, reactive, ref, toValue } from "vue";
import { translate } from "../core/i18n";
import logger from "../core/logger";
import { commonUtil } from "../utils/commonUtil";

/** An alert the flow shows before it goes on: a title, a body, and the two buttons' words. */
export type DxpModalAlert = {
  title: string;
  body: string;
  /** The button that goes on. */
  confirmText: string;
  /** The button that stays. Defaults to Cancel. */
  cancelText?: string;
};

export type DxpModalOptions<T> = {
  /** The modal holds input that closing would lose; exiting asks first. */
  dirty?: MaybeRefOrGetter<boolean>;
  /** The confirm path can run: the form is valid, or something is selected. Defaults to true. */
  canConfirm?: MaybeRefOrGetter<boolean>;
  /**
   * The confirm path's work. What it returns is the modal's result; returning nothing means true.
   * Throw an Error (or a string) to stay open: its message is what the operator reads. Anything
   * else thrown, like an uncaught request error, shows a generic message.
   * A modal without one has no confirm path, only a way out.
   */
  confirm?: () => T | Promise<T>;
  /** Replaces the default "Discard changes" alert shown when exiting a dirty modal. */
  exitAlert?: DxpModalAlert;
  /** Asks before the confirm path runs. */
  confirmAlert?: DxpModalAlert;
  /** The error toast stays up, with a Dismiss button, instead of fading. */
  persistError?: boolean;
};

/**
 * open: waiting for the operator. asking: an alert is up. saving: the confirm path is running.
 * closing: the confirm path succeeded and the modal is on its way out.
 */
export type DxpModalState = "open" | "asking" | "saving" | "closing";

/** The ion-modal element, as much of it as the flow uses. */
type ModalHost = HTMLElement & {
  canDismiss: boolean | ((data?: unknown, role?: string) => Promise<boolean>);
  dismiss: (data?: unknown, role?: string) => Promise<boolean>;
};

export type DxpModalFlow = {
  readonly state: DxpModalState;
  /** Nothing else can start: an alert is up, or the confirm path is running. */
  readonly busy: boolean;
  readonly saving: boolean;
  readonly hasConfirm: boolean;
  readonly canConfirm: boolean;
  exit: () => Promise<boolean>;
  confirm: () => Promise<void>;
  /** Hands the flow its ion-modal. DxpModal does this with its own header. */
  attach: (element?: Element | null) => void;
};

/** The role the confirm path closes with. Every other way out resolves openModal to undefined. */
export const CONFIRM_ROLE = "confirm";

function errorText(error: unknown) {
  if(typeof error === "string" && error) {return error;}
  // A plain Error was raised on purpose with words for the operator; a TypeError or a request error was not.
  if(error instanceof Error && error.name === "Error" && error.message) {return error.message;}

  return translate("Something went wrong. Please try again.");
}

/** Cancel first, then the action's verb. */
async function ask({ title, body, confirmText, cancelText }: DxpModalAlert) {
  const alert = await alertController.create({
    header: title,
    message: body,
    buttons: [{ text: cancelText ?? translate("Cancel"), role: "cancel" }, { text: confirmText, role: "confirm" }],
  });
  await alert.present();

  return (await alert.onDidDismiss()).role === "confirm";
}

async function showError(message: string, persistent?: boolean) {
  if(!persistent) {return commonUtil.showToast(message);}
  // manualDismiss hands the toast back unpresented, with no duration; canDismiss adds the Dismiss button.
  const toast = await commonUtil.showToast(message, { manualDismiss: true, canDismiss: true });

  return toast?.present();
}

/**
 * A modal's two ways out. The exit path (the close button, a backdrop tap, Escape, a swipe, the
 * hardware back button) asks first when the modal is dirty. The confirm path runs the modal's own
 * work, stays open with a toast when that fails, and closes with its result when it succeeds.
 * The modal brings its content and logic, and hands what this returns to DxpModal as its state;
 * DxpModal draws the paths. Each call is its own flow, so one component can hold several modals.
 */
export function useDxpModal<T = true>(options: DxpModalOptions<T> = {}): DxpModalFlow {
  const state = ref<DxpModalState>("open");
  let host: ModalHost | null = null;

  async function askFirst(alert: DxpModalAlert) {
    state.value = "asking";
    try {
      return await ask(alert);
    } finally {
      state.value = "open";
    }
  }

  const exitAlert = (): DxpModalAlert => options.exitAlert ?? {
    title: translate("Discard changes"),
    body: translate("What you entered will be lost."),
    confirmText: translate("Discard"),
    cancelText: translate("Keep editing"),
  };

  // Ionic runs this for every dismiss, the confirm path's own included.
  async function canDismiss(_data?: unknown, role?: string) {
    if(state.value === "closing") {return role === CONFIRM_ROLE;}
    if(state.value !== "open") {return false;}
    if(!toValue(options.dirty)) {return true;}

    return await askFirst(exitAlert());
  }

  function attach(element?: Element | null) {
    host = element?.closest<ModalHost>("ion-modal") ?? null;
    if(host) {host.canDismiss = canDismiss;} else {logger.warn("useDxpModal: no ion-modal around this modal, so its exit path cannot ask before closing.");}
  }

  const exit = async () => !!(await host?.dismiss(undefined, "cancel"));

  const canConfirm = computed(() => toValue(options.canConfirm) ?? true);

  async function confirm() {
    if(!options.confirm || state.value !== "open" || !canConfirm.value) {return;}
    if(options.confirmAlert && !(await askFirst(options.confirmAlert))) {return;}

    state.value = "saving";
    let result: unknown;
    try {
      result = await options.confirm();
    } catch (error) {
      logger.error("The modal could not complete its action", error);
      state.value = "open";
      await showError(errorText(error), options.persistError);

      return;
    }

    state.value = "closing";
    const closed = await host?.dismiss(result === undefined ? true : result, CONFIRM_ROLE);
    if(!closed) {state.value = "open";}
  }

  const flow = reactive({
    state,
    busy: computed(() => state.value !== "open"),
    saving: computed(() => state.value === "saving" || state.value === "closing"),
    hasConfirm: !!options.confirm,
    canConfirm,
    exit,
    confirm,
    attach,
  }) as DxpModalFlow;

  return flow;
}
