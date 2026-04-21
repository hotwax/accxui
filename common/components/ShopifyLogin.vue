<template>
  <ion-page>
    <ion-content>
      <div class="center-div">
        <Logo />
        <div v-if="!errorMessage">
          <p>{{ translate("Logging in...") }}</p>
        </div>
        <div v-else>
          <ion-item lines="none">
            <ion-icon slot="start" color="warning" :icon="warningOutline" />
            <h4>{{ translate('Login failed') }}</h4>
          </ion-item>
          <p>{{ translate(errorMessage) }}</p>
        </div>
      </div>
    </ion-content>
  </ion-page>
</template>

<script setup lang="ts">
import { IonContent, IonIcon, IonItem, IonPage, onIonViewDidEnter, onIonViewDidLeave } from "@ionic/vue";
import { ref } from "vue";
import { emitter, translate, useShopify, useEmbeddedAppStore } from "../index";
import Logo from "./Logo.vue";
import { accxuiConfig } from "../core/configRegistry";
import { warningOutline } from "ionicons/icons";

const { appBridgeLogin } = useShopify();
const embeddedAppStore = useEmbeddedAppStore();

const errorMessage = ref('');
let router: any = ref();
let route = null as any
onIonViewDidEnter(async () => {
  try {
    router.value = accxuiConfig.value.router
    route = router.value.currentRoute;
    errorMessage.value = '';
    emitter.emit("presentLoader");

    let { shop, host } = route.query;

    const success = await appBridgeLogin(shop as string, host as string);

    if (success) {
      await accxuiConfig.value.postLogin();
      router.value.push("/");
    } else {
      throw new Error("App Bridge Login failed.");
    }
  } catch (error: any) {
    console.error("Error during Shopify view initialization:", error);
    errorMessage.value = "Something went wrong, please contact administrator";
    embeddedAppStore.$reset();
  }
  emitter.emit("dismissLoader");
});

onIonViewDidLeave(() => {
  emitter.emit("dismissLoader");
});
</script>

<style scoped>
.center-div {
  position: absolute;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  text-align: center;
}
</style>
