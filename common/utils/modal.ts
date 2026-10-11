import { type ModalOptions, modalController } from "@ionic/vue";
import { CONFIRM_ROLE } from "../composables/useDxpModal";

/**
 * Opens a modal and waits for it to close. Resolves with what its confirm path returned, or
 * undefined for every other way out: the close button, a backdrop tap, Escape or a swipe.
 */
export async function openModal<T = true>(
  component: ModalOptions["component"],
  componentProps?: Record<string, unknown>,
  options: Omit<ModalOptions, "component" | "componentProps"> = {}
): Promise<T | undefined> {
  const modal = await modalController.create({ ...options, component, componentProps });
  await modal.present();
  const { data, role } = await modal.onWillDismiss();

  return role === CONFIRM_ROLE ? data as T : undefined;
}
