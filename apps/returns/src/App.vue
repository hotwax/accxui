<template>
  <ion-app data-testid="app-root">
    <ion-router-outlet data-testid="app-router-outlet" />
  </ion-app>
</template>

<script setup lang="ts">
import { computed, onBeforeMount, onMounted, onUnmounted, ref } from "vue";
import { IonApp, IonRouterOutlet, loadingController } from "@ionic/vue";
import { emitter, translate } from "@common";
import { Settings } from "luxon";
import { useUserStore } from "@/store/userStore";

const userProfile = computed(() => useUserStore().getUserProfile);
const loader = ref(null) as any;

async function presentLoader(options: any) {
  const backdropDismiss = options?.backdropDismiss || false;
  // Custom message: drop any existing loader first, else the old message sticks.
  if (options?.message && loader.value) dismissLoader();
  if (!loader.value) {
    loader.value = await loadingController.create({
      message: options?.message
        ? translate(options.message)
        : backdropDismiss
          ? translate("Click the backdrop to dismiss.")
          : translate("Loading..."),
      translucent: true,
      backdropDismiss,
    });
  }
  loader.value.present();
}

function dismissLoader() {
  if (loader.value) {
    loader.value.dismiss();
    loader.value = null as any;
  }
}

onBeforeMount(() => {
  emitter.on("presentLoader", presentLoader);
  emitter.on("dismissLoader", dismissLoader);
});

onMounted(() => {
  // Luxon should render dates in the user's selected timezone, like every other app.
  if (userProfile.value?.timeZone) Settings.defaultZone = userProfile.value.timeZone;
});

onUnmounted(() => {
  emitter.off("presentLoader", presentLoader);
  emitter.off("dismissLoader", dismissLoader);
});
</script>
