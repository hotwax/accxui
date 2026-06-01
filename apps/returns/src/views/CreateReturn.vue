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

          <ion-card v-if="order && hasReturnable" class="appeasement">
            <ion-item lines="none">
              <ion-toggle data-testid="create-appeasement-toggle" :checked="appeasementEnabled"
                :disabled="!hasKeptItems" @ionChange="appeasementEnabled = $event.detail.checked">
                {{ translate("Add a goodwill refund (appeasement)") }}
              </ion-toggle>
            </ion-item>
            <ion-card-content v-if="!hasKeptItems">
              <p class="muted">{{ translate("A full return already refunds this order — appeasements are for orders with kept items.") }}</p>
            </ion-card-content>
            <ion-card-content v-else-if="appeasementEnabled">
              <ion-item>
                <ion-input data-testid="create-appeasement-amount" type="number" min="0"
                  :label="translate('Refund amount')" label-placement="stacked"
                  :value="appeasementAmount" @ionInput="appeasementAmount = Number($event.target.value ?? 0)" />
              </ion-item>
              <ion-item>
                <ion-select data-testid="create-appeasement-reason" :placeholder="translate('Reason')"
                  :label="translate('Reason')" label-placement="stacked"
                  :value="appeasementReasonId" @ionChange="appeasementReasonId = $event.detail.value">
                  <ion-select-option v-for="rsn in reasons" :key="rsn.returnReasonId" :value="rsn.returnReasonId">{{ rsn.description }}</ion-select-option>
                </ion-select>
              </ion-item>
              <ion-item>
                <ion-textarea data-testid="create-appeasement-note" :label="translate('Note (optional)')"
                  label-placement="stacked" :value="appeasementNote" @ionInput="appeasementNote = $event.target.value ?? ''" />
              </ion-item>
              <p v-if="appeasementAmount !== null && !appeasementValid" class="error" role="alert">
                {{ translate("Enter an amount between 0 and the kept-item value, and choose a reason.") }}
              </p>
            </ion-card-content>
          </ion-card>
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
import { computed, reactive, ref, watch } from "vue";
import router from "@/router";
import { emitter, translate } from "@common";
import {
  IonBackButton, IonButton, IonCard, IonCardContent, IonCardHeader, IonCardTitle, IonContent, IonFab,
  IonFabButton, IonHeader, IonIcon, IonInput, IonItem, IonLabel, IonList, IonPage, IonSelect,
  IonSelectOption, IonTextarea, IonTitle, IonToggle, IonToolbar,
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
const appeasementEnabled = ref(false);
const appeasementAmount = ref<number | null>(null);
const appeasementReasonId = ref<string>("");
const appeasementNote = ref<string>("");

const hasReturnable = computed(() => !!order.value?.items.some((i) => i.returnableQty > 0));
// Merchandise value of returnable units NOT selected for return. > 0 means the customer keeps something.
const keptValue = computed(() => {
  if (!order.value) return 0;
  return order.value.items.reduce((sum, line) => {
    const selectedQty = selections[line.orderItemSeqId]?.qty ?? 0;
    return sum + Math.max(0, line.returnableQty - selectedQty) * line.unitPrice;
  }, 0);
});
const hasKeptItems = computed(() => keptValue.value > 0);
// A partially-filled or out-of-range appeasement is invalid and must block submit.
const appeasementValid = computed(() => {
  if (!appeasementEnabled.value) return true;
  const amt = Number(appeasementAmount.value);
  return hasKeptItems.value && amt > 0 && amt <= keptValue.value && !!appeasementReasonId.value;
});
// When the operator returns everything (nothing kept), the appeasement is no longer eligible —
// turn it off so the toggle's state matches reality and no stale amount/reason lingers enabled.
watch(hasKeptItems, (has) => {
  if (!has) appeasementEnabled.value = false;
});
const hasItemsSelected = computed(() =>
  Object.values(selections).some((s) => s.qty > 0 && s.returnReasonId)
);
const canSubmit = computed(() => hasItemsSelected.value && appeasementValid.value);

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
    const returnId = await store.submitReturn({
      orderId: order.value.orderId,
      items,
      appeasement: appeasementEnabled.value
        ? {
            amount: Number(appeasementAmount.value),
            currencyUomId: order.value.currencyUomId,
            reasonId: appeasementReasonId.value,
            ...(appeasementNote.value.trim() ? { note: appeasementNote.value.trim() } : {}),
          }
        : undefined,
    });
    router.push(`/return-detail/${returnId}`);
    return returnId;
  } catch (e) {
    error.value = describeApiError(e, translate("Failed to create return"));
  } finally {
    emitter.emit("dismissLoader");
  }
}

defineExpose({
  orderId, order, selections, lookupOrder, submit,
  appeasementEnabled, appeasementAmount, appeasementReasonId, appeasementNote,
  keptValue, hasKeptItems, appeasementValid, canSubmit,
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
.error {
  color: var(--ion-color-danger);
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
