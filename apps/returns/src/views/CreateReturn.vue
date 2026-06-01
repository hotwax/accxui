<template>
  <ion-page>
    <ion-header :translucent="true">
      <ion-toolbar>
        <ion-back-button data-testid="create-back-btn" slot="start" default-href="/tabs/returns" />
        <ion-title>{{ translate("Create return") }}</ion-title>
      </ion-toolbar>
    </ion-header>

    <ion-content id="filter-content">
      <div class="find">
        <section class="search">
          <ion-item>
            <ion-input
              data-testid="create-orderid-input"
              :label="translate('Order ID')"
              label-placement="stacked"
              :placeholder="translate('Search an order to return')"
              v-model="orderId"
              @keyup.enter="lookupOrder"
            />
            <ion-button data-testid="create-lookup-btn" slot="end" @click="lookupOrder">{{ translate("Look up order") }}</ion-button>
          </ion-item>
          <p v-if="error" class="ion-padding-start" style="color: var(--ion-color-danger); white-space: pre-wrap">{{ error }}</p>
        </section>

        <aside class="filters">
          <ion-card v-if="order">
            <ion-card-header>
              <ion-card-title>{{ translate("Order") }}</ion-card-title>
            </ion-card-header>
            <ion-item lines="none">
              <ion-label>
                <h2>{{ order.orderName || order.orderId }}</h2>
                <p v-if="order.billingEmail">{{ order.billingEmail }}</p>
              </ion-label>
            </ion-item>
          </ion-card>
        </aside>

        <main>
          <div class="empty-state" data-testid="create-empty" v-if="!order">
            <ion-icon :icon="bagCheckOutline" color="medium" />
            <h1>{{ translate("Start a return") }}</h1>
            <p>{{ translate("Look up an order above to see its returnable items.") }}</p>
          </div>

          <div class="empty-state" v-else-if="!hasReturnable">
            <p>{{ translate("Nothing on this order can be returned") }}</p>
          </div>

          <ion-list v-else>
            <ion-item v-for="line in order.items" :key="line.orderItemSeqId" :disabled="line.returnableQty === 0">
              <ion-label>
                <h2>{{ line.productName || line.sku || line.productId }}</h2>
                <p v-if="line.sku" class="muted">{{ translate("SKU") }}: {{ line.sku }}</p>
                <p>{{ translate("Returnable") }}: {{ line.returnableQty }}</p>
              </ion-label>
              <ion-select
                :placeholder="translate('Quantity')" slot="end" style="min-width: 90px"
                :value="selections[line.orderItemSeqId]?.qty ?? 0"
                @ionChange="setQty(line.orderItemSeqId, $event.detail.value)">
                <ion-select-option v-for="n in line.returnableQty + 1" :key="n - 1" :value="n - 1">{{ n - 1 }}</ion-select-option>
              </ion-select>
              <ion-select
                :placeholder="translate('Reason')" slot="end" style="min-width: 140px"
                :value="selections[line.orderItemSeqId]?.returnReasonId"
                @ionChange="setReason(line.orderItemSeqId, $event.detail.value)">
                <ion-select-option v-for="r in reasons" :key="r.returnReasonId" :value="r.returnReasonId">{{ r.description }}</ion-select-option>
              </ion-select>
            </ion-item>
          </ion-list>
        </main>
      </div>

      <ion-fab vertical="bottom" horizontal="end" slot="fixed" v-if="order && hasReturnable">
        <ion-fab-button data-testid="create-submit-btn" :disabled="!canSubmit" @click="submit">
          <ion-icon :icon="checkmarkDoneOutline" />
        </ion-fab-button>
      </ion-fab>
    </ion-content>
  </ion-page>
</template>

<script setup lang="ts">
import { computed, reactive, ref } from "vue";
import router from "@/router";
import { emitter, translate } from "@common";
import {
  IonBackButton, IonButton, IonCard, IonCardHeader, IonCardTitle, IonContent, IonFab,
  IonFabButton, IonHeader, IonIcon, IonInput, IonItem, IonLabel, IonList, IonPage, IonSelect,
  IonSelectOption, IonTitle, IonToolbar,
} from "@ionic/vue";
import { bagCheckOutline, checkmarkDoneOutline } from "ionicons/icons";
import { useReturnsStore } from "@/store/returnsStore";
import { describeApiError } from "@/util/errorMessage";
import type { OrderForReturn, ReturnReason } from "@/types/returns";

const store = useReturnsStore();

const orderId = ref("");
const order = ref<OrderForReturn | null>(null);
const reasons = ref<ReturnReason[]>([]);
const error = ref("");
const selections = reactive<Record<string, { qty: number; returnReasonId?: string }>>({});

const hasReturnable = computed(() => !!order.value?.items.some((i) => i.returnableQty > 0));
const canSubmit = computed(() =>
  Object.values(selections).some((s) => s.qty > 0 && s.returnReasonId)
);

async function lookupOrder() {
  error.value = "";
  order.value = null;
  emitter.emit("presentLoader", { message: "Looking up order" });
  try {
    order.value = await store.loadOrder(orderId.value.trim());
    reasons.value = await store.loadReasons();
  } catch (e) {
    error.value = describeApiError(e, translate("Order not found"));
  } finally {
    emitter.emit("dismissLoader");
  }
}
function setQty(seqId: string, qty: number) {
  selections[seqId] = { ...(selections[seqId] ?? {}), qty };
}
function setReason(seqId: string, returnReasonId: string) {
  selections[seqId] = { qty: selections[seqId]?.qty ?? 0, returnReasonId };
}
async function submit(): Promise<string | undefined> {
  if (!order.value) return;
  const items = Object.entries(selections)
    .filter(([, s]) => s.qty > 0 && s.returnReasonId)
    .map(([orderItemSeqId, s]) => {
      const line = order.value!.items.find((i) => i.orderItemSeqId === orderItemSeqId)!;
      return { orderItemSeqId, productId: line.productId, productName: line.productName, returnQuantity: s.qty, returnReasonId: s.returnReasonId! };
    });
  if (!items.length) return;
  error.value = "";
  emitter.emit("presentLoader", { message: "Submitting return" });
  try {
    const returnId = await store.submitReturn({ orderId: order.value.orderId, items });
    router.push(`/return-detail/${returnId}`);
    return returnId;
  } catch (e) {
    error.value = describeApiError(e, translate("Failed to create return"));
  } finally {
    emitter.emit("dismissLoader");
  }
}

defineExpose({ orderId, order, selections, lookupOrder, submit });
</script>

<style scoped>
.empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  text-align: center;
  padding: var(--spacer-lg);
}
.empty-state ion-icon {
  font-size: 72px;
  margin-bottom: var(--spacer-sm);
}
.empty-state h1 {
  margin: 0;
  font-size: 24px;
  font-weight: 600;
}
.empty-state p {
  color: var(--ion-color-medium);
  max-width: 400px;
}
.find {
  height: 100%;
  display: grid;
  grid-template-rows: auto auto 1fr;
}
.muted {
  color: var(--ion-color-medium);
  font-size: 0.8em;
}
@media (min-width: 991px) {
  .find {
    grid-template-rows: auto 1fr;
  }
  .find .search {
    margin-inline-start: var(--spacer-xl);
    padding-block-start: var(--spacer-sm);
  }
}
</style>
