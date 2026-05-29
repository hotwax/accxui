<template>
  <ion-page>
    <ion-header>
      <ion-toolbar>
        <ion-title>{{ translate("Returns") }}</ion-title>
        <ion-buttons slot="end">
          <ion-button router-link="/tabs/returns/create">
            <ion-icon slot="icon-only" :icon="addOutline" />
          </ion-button>
        </ion-buttons>
      </ion-toolbar>
    </ion-header>
    <ion-content>
      <ion-refresher slot="fixed" @ionRefresh="refresh($event)">
        <ion-refresher-content />
      </ion-refresher>

      <div v-if="!store.returns.length && !store.loading" class="ion-padding ion-text-center">
        {{ translate("No returns yet") }}
      </div>

      <ion-list>
        <ion-item v-for="r in store.returns" :key="r.returnId" :router-link="`/tabs/returns/${r.returnId}`">
          <ion-label>
            <h2>#{{ r.returnId }}</h2>
            <p>{{ translate("Order") }} {{ r.orderId }}</p>
          </ion-label>
          <ion-badge v-if="r.origin === 'shopify'" slot="end" color="tertiary">{{ translate("From Shopify") }}</ion-badge>
          <ion-badge slot="end" :color="syncColor(r.sync.shopify)">{{ syncLabel(r.sync.shopify) }}</ion-badge>
        </ion-item>
      </ion-list>
    </ion-content>
  </ion-page>
</template>

<script setup lang="ts">
import { onMounted } from "vue";
import { translate } from "@common";
import {
  IonBadge, IonButton, IonButtons, IonContent, IonHeader, IonIcon, IonItem,
  IonLabel, IonList, IonPage, IonRefresher, IonRefresherContent, IonTitle, IonToolbar,
} from "@ionic/vue";
import { addOutline } from "ionicons/icons";
import { useReturnsStore } from "@/store/returnsStore";
import type { SyncState } from "@/types/returns";

const store = useReturnsStore();

function syncColor(s: SyncState) {
  return { synced: "success", pending: "warning", failed: "danger", not_synced: "medium" }[s];
}
function syncLabel(s: SyncState) {
  return translate({ synced: "Synced", pending: "Pending", failed: "Failed", not_synced: "Not synced" }[s]);
}
async function refresh(ev: CustomEvent) {
  await store.fetchReturns();
  (ev.target as any).complete();
}

onMounted(() => store.fetchReturns());
</script>
