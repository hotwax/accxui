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
import { commonUtil, emitter, translate, useShopify, useEmbeddedAppStore } from "../index";
import Logo from "./Logo.vue";
import { accxuiConfig } from "../core/configRegistry";
import { warningOutline } from "ionicons/icons";
import { useAuth } from "../composables/useAuth"

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

    console.log('router.', shop, host, import.meta.env.VITE_SHOPIFY_SHOP_CONFIG)

    // Resolve the pinned app version BEFORE touching App Bridge. Shopify's App URL can't carry a version,
    // so an embedded session always starts unversioned and may need one redirect — doing it first means we
    // don't throw away a completed bridge handshake and session-token exchange, and App Bridge is created
    // exactly once, on the page that will actually run. This needs no token (`appVersions` is an anonymous
    // endpoint) and no login round trip: the shop's Maarg instance comes from the build-time shop config.
    const shopConfig = commonUtil.jsonParse(import.meta.env.VITE_SHOPIFY_SHOP_CONFIG)?.[shop as string];
    // A redirect is a pending page load — stop here rather than starting work that gets torn down.
    if (await useAuth().fetchAppVersion(commonUtil.getMaargURL(shopConfig?.maarg))) return;

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
