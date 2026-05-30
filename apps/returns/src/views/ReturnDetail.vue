<template>
  <ion-page>
    <ion-header>
      <ion-toolbar>
        <ion-back-button data-testid="return-detail-back-btn" slot="start" default-href="/tabs/returns" />
        <ion-title>{{ translate("Return") }} #{{ returnId }}</ion-title>
      </ion-toolbar>
    </ion-header>

    <ion-content>
      <main class="empty-state" data-testid="return-detail-loading" v-if="loading && !loaded">
        <ion-spinner name="crescent" />
        <ion-label>{{ translate("Fetching return details") }}</ion-label>
      </main>

      <main v-else>
        <p v-if="error" class="ion-padding-start" style="color: var(--ion-color-danger); white-space: pre-wrap">{{ error }}</p>

        <template v-if="r">
          <section class="header">
            <div class="id ion-margin-top">
              <ion-item lines="none">
                <ion-icon slot="start" :icon="receiptOutline" />
                <ion-label>
                  <p class="overline">{{ translate(formatStatus(r.statusId)) }}</p>
                  <h1>{{ r.orderName || r.orderId || `#${returnId}` }}</h1>
                  <p>{{ translate("Requested") }}: {{ formatDate(r.entryDate) }}</p>
                </ion-label>
              </ion-item>
            </div>

            <div class="info">
              <ion-card>
                <ion-card-header>
                  <ion-card-title>{{ translate("Order") }}</ion-card-title>
                </ion-card-header>
                <ion-item lines="none">
                  <ion-label>
                    <h2>{{ r.orderName || r.orderId }}</h2>
                    <p v-if="r.orderDate" class="muted">{{ translate("Ordered") }}: {{ formatDate(r.orderDate) }}</p>
                  </ion-label>
                </ion-item>
              </ion-card>

              <ion-card>
                <ion-card-header>
                  <ion-card-title>{{ translate("Shopify sync") }}</ion-card-title>
                </ion-card-header>
                <ion-card-content>
                  <ion-chip :color="syncColor(r.sync.shopify)">
                    <ion-spinner v-if="r.sync.shopify === 'pending'" name="dots" />
                    <ion-label>{{ syncLabel(r.sync.shopify) }}</ion-label>
                  </ion-chip>
                  <p v-if="r.externalIds.shopify">{{ translate("Shopify return ID") }}: {{ r.externalIds.shopify }}</p>

                  <ion-button v-if="r.sync.shopify === 'not_synced'" expand="block" :disabled="busy" @click="push" data-testid="detail-push-btn">
                    {{ translate("Push to Shopify") }}
                  </ion-button>
                  <ion-button v-if="r.sync.shopify === 'failed'" expand="block" color="danger" :disabled="busy" @click="push" data-testid="detail-retry-btn">
                    {{ translate("Retry") }}
                  </ion-button>
                </ion-card-content>
              </ion-card>
            </div>
          </section>

          <hr />

          <section>
            <div class="list-item" v-for="it in r.items" :key="it.orderItemSeqId">
              <ion-item lines="none">
                <ion-label>
                  <h2>{{ it.productName || it.sku || it.productId }}</h2>
                  <p>{{ translate("Quantity") }}: {{ it.returnQuantity }} · {{ translate(formatReason(it.returnReasonId, it.returnReasonDesc)) }}</p>
                  <p v-if="it.sku" class="muted">{{ translate("SKU") }}: {{ it.sku }}</p>
                </ion-label>
              </ion-item>
            </div>
          </section>
        </template>
      </main>
    </ion-content>
  </ion-page>
</template>

<script setup lang="ts">
import { computed, ref } from "vue";
import { emitter, translate } from "@common";
import {
  IonBackButton, IonButton, IonCard, IonCardContent, IonCardHeader, IonCardTitle, IonChip,
  IonContent, IonHeader, IonIcon, IonItem, IonLabel, IonPage, IonSpinner, IonTitle, IonToolbar,
  onIonViewWillEnter,
} from "@ionic/vue";
import { receiptOutline } from "ionicons/icons";
import { useReturnsStore } from "@/store/returnsStore";
import { describeApiError } from "@/util/errorMessage";
import { formatStatus, formatReason } from "@/util/labels";
import { formatDate } from "@/util/dates";
import { syncColor, syncLabel } from "@/util/syncState";

const props = defineProps<{ returnId: string }>();
const store = useReturnsStore();
const busy = ref(false);
const error = ref("");
const loading = ref(false);

const r = computed(() => store.current);
// True once the loaded return matches this route (store.current may briefly hold a previously-viewed return).
const loaded = computed(() => r.value?.returnId === props.returnId);

async function push() {
  error.value = "";
  busy.value = true;
  emitter.emit("presentLoader", { message: "Pushing to Shopify" });
  try {
    await store.pushAndPoll(props.returnId, "shopify");
  } catch (e) {
    error.value = describeApiError(e, translate("Push to Shopify failed"));
  } finally {
    busy.value = false;
    emitter.emit("dismissLoader");
  }
}

onIonViewWillEnter(async () => {
  error.value = "";
  loading.value = true;
  try {
    await store.fetchReturn(props.returnId);
    // The backend auto-pushes on create, so a freshly-created return loads as "pending" — poll to completion.
    if (store.current?.sync.shopify === "pending") {
      busy.value = true;
      try { await store.pollSync(props.returnId, "shopify"); } finally { busy.value = false; }
    }
  } catch (e) {
    error.value = describeApiError(e, translate("Failed to load return"));
  } finally {
    loading.value = false;
  }
});
</script>

<style scoped>
.empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  text-align: center;
  padding: var(--spacer-lg);
  gap: var(--spacer-sm);
}
.info {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
  align-items: start;
}
.list-item {
  border-bottom: var(--border-medium);
}
.list-item > ion-item {
  width: 100%;
}
hr {
  border-top: 1px solid var(--border-medium);
  margin: var(--spacer-xs) 0;
}
.muted {
  color: var(--ion-color-medium);
  font-size: 0.8em;
}
</style>
