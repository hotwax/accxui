import { translate } from '../index'
import { useUserStore } from '../index'
import { loadingController } from '@ionic/vue'

const login = async (payload: any) => {
  const userStore = useUserStore()
  userStore.login(payload);
} 

const logout = async (payload: any) => {
  const userStore = useUserStore()
  userStore.logout(payload);
}

const loader = {
  value: null as any,
  present: async (message: string) => {
    if (!loader.value) {
      loader.value = await loadingController
        .create({
          message: translate(message),
          translucent: false,
          backdropDismiss: false
        });
    }
    loader.value.present();
  },
  dismiss: () => {
    if (loader.value) {
      loader.value.dismiss();
      loader.value = null as any;
    }
  }
}

export {
  login,
  loader,
  logout
}