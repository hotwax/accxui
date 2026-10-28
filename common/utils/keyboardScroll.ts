import { isPlatform } from '@ionic/vue';

/** Pair with useIosKeyboardScroll in App.vue; leave Ionic's assist enabled elsewhere. */
export function supportsIosKeyboardScroll(): boolean {
  return typeof window !== 'undefined' && !!window.visualViewport && isPlatform('ios');
}
