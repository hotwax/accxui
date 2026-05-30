<template>
  <ion-page>
    <ion-tabs>
      <ion-router-outlet data-testid="tabs-router-outlet"></ion-router-outlet>
      <ion-tab-bar data-testid="tabs-bottom-bar" slot="bottom" v-if="showFooter()">
        <ion-tab-button tab="returns" href="/tabs/returns">
          <ion-icon :icon="receiptOutline" />
          <ion-label data-testid="tabs-returns-btn">{{ translate("Returns") }}</ion-label>
        </ion-tab-button>
        <ion-tab-button tab="settings" href="/tabs/settings">
          <ion-icon :icon="settingsOutline" />
          <ion-label data-testid="tabs-settings-btn">{{ translate("Settings") }}</ion-label>
        </ion-tab-button>
      </ion-tab-bar>
    </ion-tabs>
  </ion-page>
</template>

<script setup lang="ts">
import { translate } from "@common";
import { IonIcon, IonLabel, IonPage, IonRouterOutlet, IonTabBar, IonTabButton, IonTabs } from "@ionic/vue";
import { receiptOutline, settingsOutline } from "ionicons/icons";
import router from "@/router";

// Only show the tab bar on top-level tab routes (hidden on pushed detail/create pages).
function showFooter() {
  return ["/tabs/returns", "/tabs/settings"].includes(router.currentRoute.value.path);
}
</script>

<style scoped>
ion-tab-bar {
  bottom: 0px;
  width: 100%;
  transition: width .5s ease-in-out, bottom 1s ease-in-out;
}

@media (min-width: 991px) {
  ion-tab-bar {
    position: absolute;
    left: 50%;
    transform: translateX(-50%);
    bottom: var(--spacer-base);
    width: 375px;
    box-shadow: rgb(0 0 0 / 20%) 0px 3px 1px -2px, rgb(0 0 0 / 14%) 0px 2px 2px 0px, rgb(0 0 0 / 12%) 0px 1px 5px 0px;
    border-radius: 15px;
  }
}
</style>
