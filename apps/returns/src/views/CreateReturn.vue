<template>
  <ion-page>
    <ion-header>
      <ion-toolbar>
        <ion-buttons slot="start"><ion-back-button default-href="/tabs/returns" /></ion-buttons>
        <ion-title>{{ translate("Create return") }}</ion-title>
      </ion-toolbar>
    </ion-header>
    <ion-content class="ion-padding">
      <ion-item>
        <ion-input v-model="orderId" :label="translate('Order ID')" label-placement="stacked" />
        <ion-button slot="end" @click="lookupOrder">{{ translate("Look up order") }}</ion-button>
      </ion-item>

      <p v-if="error" class="ion-padding-start" style="color: var(--ion-color-danger); white-space: pre-wrap">{{ error }}</p>

      <template v-if="order">
        <ion-item lines="none">
          <ion-label>
            <p>{{ translate("Order") }}</p>
            <h2>{{ order.orderName || order.orderId }}</h2>
            <p v-if="order.billingEmail">{{ order.billingEmail }}</p>
          </ion-label>
        </ion-item>
        <p v-if="!hasReturnable" class="ion-padding-start">{{ translate("Nothing on this order can be returned") }}</p>
        <ion-list>
          <ion-item v-for="line in order.items" :key="line.orderItemSeqId" :disabled="line.returnableQty === 0">
            <ion-label>
              <h2>{{ line.productName || line.productId }}</h2>
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

        <ion-button expand="block" :disabled="!canSubmit" @click="submit">{{ translate("Submit return") }}</ion-button>
      </template>
    </ion-content>
  </ion-page>
</template>

<script setup lang="ts">
import { computed, reactive, ref } from "vue";
import router from "@/router";
import { translate } from "@common";
import {
  IonBackButton, IonButton, IonButtons, IonContent, IonHeader, IonInput, IonItem,
  IonLabel, IonList, IonPage, IonSelect, IonSelectOption, IonTitle, IonToolbar,
} from "@ionic/vue";
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
  try {
    order.value = await store.loadOrder(orderId.value.trim());
    reasons.value = await store.loadReasons();
  } catch (e) {
    error.value = describeApiError(e, "Order not found");
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
  try {
    const returnId = await store.submitReturn({ orderId: order.value.orderId, items });
    router.push(`/tabs/returns/${returnId}`);
    return returnId;
  } catch (e) {
    error.value = describeApiError(e, "Failed to create return");
  }
}

defineExpose({ orderId, order, selections, lookupOrder, submit });
</script>
