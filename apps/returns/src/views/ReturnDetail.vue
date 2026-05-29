<template>
  <ion-page>
    <ion-header>
      <ion-toolbar>
        <ion-buttons slot="start"><ion-back-button default-href="/tabs/returns" /></ion-buttons>
        <ion-title>{{ translate("Return") }} #{{ returnId }}</ion-title>
      </ion-toolbar>
    </ion-header>
    <ion-content class="ion-padding">
      <p v-if="error" style="color: var(--ion-color-danger); white-space: pre-wrap">{{ error }}</p>
      <template v-if="r">
        <ion-item lines="none">
          <ion-label>
            <p>{{ translate("Order") }}</p>
            <h2>{{ r.orderId }}</h2>
          </ion-label>
        </ion-item>
        <ion-item lines="none">
          <ion-label>
            <p>{{ translate("Status") }}</p>
            <h2>{{ r.statusId }}</h2>
          </ion-label>
        </ion-item>

        <ion-list>
          <ion-item v-for="it in r.items" :key="it.orderItemSeqId">
            <ion-label>
              <h2>{{ it.productId }}</h2>
              <p>{{ translate("Quantity") }}: {{ it.returnQuantity }} · {{ it.returnReasonDesc || it.returnReasonId }}</p>
            </ion-label>
          </ion-item>
        </ion-list>

        <ion-card>
          <ion-card-header><ion-card-title>{{ translate("Shopify sync") }}</ion-card-title></ion-card-header>
          <ion-card-content>
            <ion-chip :color="syncColor(r.sync.shopify)">
              <ion-spinner v-if="r.sync.shopify === 'pending'" name="dots" />
              <ion-label>{{ syncLabel(r.sync.shopify) }}</ion-label>
            </ion-chip>
            <p v-if="r.externalIds.shopify">{{ translate("Shopify return ID") }}: {{ r.externalIds.shopify }}</p>

            <ion-button v-if="r.sync.shopify === 'not_synced'" expand="block" :disabled="busy" @click="push">
              {{ translate("Push to Shopify") }}
            </ion-button>
            <ion-button v-if="r.sync.shopify === 'failed'" expand="block" color="danger" :disabled="busy" @click="push">
              {{ translate("Retry") }}
            </ion-button>
          </ion-card-content>
        </ion-card>
      </template>
    </ion-content>
  </ion-page>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { translate } from "@common";
import {
  IonBackButton, IonButton, IonButtons, IonCard, IonCardContent, IonCardHeader, IonCardTitle,
  IonChip, IonContent, IonHeader, IonItem, IonLabel, IonList, IonPage, IonSpinner, IonTitle, IonToolbar,
} from "@ionic/vue";
import { useReturnsStore } from "@/store/returnsStore";
import { describeApiError } from "@/util/errorMessage";
import type { SyncState } from "@/types/returns";

const props = defineProps<{ returnId: string }>();
const store = useReturnsStore();
const busy = ref(false);
const error = ref("");

const r = computed(() => store.current);

function syncColor(s: SyncState) {
  return { synced: "success", pending: "warning", failed: "danger", not_synced: "medium" }[s];
}
function syncLabel(s: SyncState) {
  return translate({ synced: "Synced", pending: "Pending", failed: "Failed", not_synced: "Not synced" }[s]);
}
async function push() {
  error.value = "";
  busy.value = true;
  try {
    await store.pushAndPoll(props.returnId, "shopify");
  } catch (e) {
    error.value = describeApiError(e, "Push to Shopify failed");
  } finally {
    busy.value = false;
  }
}

onMounted(async () => {
  try {
    await store.fetchReturn(props.returnId);
    // The backend auto-pushes on create, so a freshly-created return loads as "pending" — poll to completion.
    if (store.current?.sync.shopify === "pending") {
      busy.value = true;
      try { await store.pollSync(props.returnId, "shopify"); } finally { busy.value = false; }
    }
  } catch (e) {
    error.value = describeApiError(e, "Failed to load return");
  }
});
</script>
