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
          <ion-segment v-if="order && hasReturnable" data-testid="create-mode-segment" :value="mode"
            @ionChange="setMode($event.detail.value as 'return' | 'exchange')">
            <ion-segment-button value="return" data-testid="create-mode-return">
              <ion-label>{{ translate("Return") }}</ion-label>
            </ion-segment-button>
            <ion-segment-button value="exchange" data-testid="create-mode-exchange">
              <ion-label>{{ translate("Exchange") }}</ion-label>
            </ion-segment-button>
          </ion-segment>

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

          <ion-card v-if="order && hasReturnable && mode === 'return'" class="appeasement">
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
              <ion-segment data-testid="create-appeasement-mode" :value="appeasementMode"
                @ionChange="setAppeasementMode($event.detail.value as 'amount' | 'items')">
                <ion-segment-button value="amount" data-testid="create-appeasement-mode-amount">
                  <ion-label>{{ translate("Refund an amount") }}</ion-label>
                </ion-segment-button>
                <ion-segment-button value="items" data-testid="create-appeasement-mode-items">
                  <ion-label>{{ translate("Refund specific items") }}</ion-label>
                </ion-segment-button>
              </ion-segment>

              <ion-list v-if="appeasementMode === 'items'" data-testid="create-appeasement-items">
                <ion-item v-for="line in order.items" :key="line.orderItemSeqId" :disabled="line.returnableQty === 0">
                  <ion-label>
                    <h2>{{ line.productName || line.sku || line.productId }}</h2>
                    <p>{{ translate("Returnable") }}: {{ line.returnableQty }}</p>
                  </ion-label>
                  <ion-select :placeholder="translate('Quantity')" slot="end" style="min-width: 90px"
                    :value="appeasementSelections[line.orderItemSeqId]?.qty ?? 0"
                    @ionChange="setAppeasementQty(line.orderItemSeqId, $event.detail.value)">
                    <ion-select-option v-for="n in line.returnableQty + 1" :key="n - 1" :value="n - 1">{{ n - 1 }}</ion-select-option>
                  </ion-select>
                </ion-item>
              </ion-list>

              <ion-item>
                <ion-input data-testid="create-appeasement-amount" type="number" min="0"
                  :label="appeasementMode === 'items' ? translate('Refund amount (override)') : translate('Refund amount')"
                  label-placement="stacked"
                  :value="appeasementAmount" @ionInput="onAppeasementAmountInput(Number($event.target.value ?? 0))" />
              </ion-item>
              <ion-item>
                <ion-select data-testid="create-appeasement-reason" :placeholder="translate('Reason')"
                  :label="translate('Reason')" label-placement="stacked"
                  :value="appeasementReasonId" @ionChange="appeasementReasonId = $event.detail.value">
                  <ion-select-option v-for="rsn in appeasementReasons" :key="rsn.returnReasonId" :value="rsn.returnReasonId">{{ rsn.description }}</ion-select-option>
                </ion-select>
              </ion-item>
              <ion-item>
                <ion-textarea data-testid="create-appeasement-note" :label="translate('Note (optional)')"
                  label-placement="stacked" :value="appeasementNote" @ionInput="appeasementNote = $event.target.value ?? ''" />
              </ion-item>
              <p v-if="appeasementHint" class="error" role="alert">{{ appeasementHint }}</p>
            </ion-card-content>
          </ion-card>

          <ion-card v-if="order && hasReturnable && mode === 'exchange'" class="fulfillment">
            <ion-card-header>
              <ion-card-title>{{ translate("Replacement delivery") }}</ion-card-title>
            </ion-card-header>
            <ion-card-content>
              <ion-segment data-testid="create-fulfillment-segment" :value="fulfillmentType"
                @ionChange="fulfillmentType = $event.detail.value as 'SHIPPED' | 'IMMEDIATE'">
                <ion-segment-button value="SHIPPED" data-testid="create-fulfillment-shipped">
                  <ion-label>{{ translate("Ship to customer") }}</ion-label>
                </ion-segment-button>
                <ion-segment-button value="IMMEDIATE" data-testid="create-fulfillment-immediate">
                  <ion-label>{{ translate("Hand over now") }}</ion-label>
                </ion-segment-button>
              </ion-segment>
              <p class="muted">{{ fulfillmentType === 'IMMEDIATE'
                ? translate("The replacement is handed over now and its order completes immediately.")
                : translate("The replacement is shipped to the customer through the normal fulfillment flow.") }}</p>
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
import { commonUtil, emitter, translate } from "@common";
import {
  IonBackButton, IonButton, IonCard, IonCardContent, IonCardHeader, IonCardTitle, IonContent, IonFab,
  IonFabButton, IonHeader, IonIcon, IonInput, IonItem, IonLabel, IonList, IonPage, IonSegment,
  IonSegmentButton, IonSelect, IonSelectOption, IonTextarea, IonTitle, IonToggle, IonToolbar,
} from "@ionic/vue";
import { bagCheckOutline, checkmarkDoneOutline } from "ionicons/icons";
import { useReturnsStore } from "@/store/returnsStore";
import { describeApiError } from "@/util/errorMessage";
import type { FulfillmentType, OrderForReturn, ReturnReason } from "@/types/returns";

const store = useReturnsStore();

const orderId = ref("");
const order = ref<OrderForReturn | null>(null);
const reasons = ref<ReturnReason[]>([]);
const appeasementReasons = ref<ReturnReason[]>([]);
const error = ref("");
const selections = reactive<Record<string, { qty: number; returnReasonId?: string }>>({});
const appeasementEnabled = ref(false);
const appeasementAmount = ref<number | null>(null);
const appeasementReasonId = ref<string>("");
const appeasementNote = ref<string>("");
const appeasementMode = ref<"amount" | "items">("amount");
const mode = ref<"return" | "exchange">("return");
const fulfillmentType = ref<FulfillmentType>("SHIPPED");
function setMode(m: "return" | "exchange") {
  mode.value = m;
  if (m === "exchange") appeasementEnabled.value = false; // appeasement is unavailable for exchanges
}
const appeasementSelections = reactive<Record<string, { qty: number }>>({});
// Did the operator type an explicit override? While false, the amount field mirrors the picked-line total.
const appeasementAmountTouched = ref(false);

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
const appeasementItemsTotal = computed(() =>
  Object.entries(appeasementSelections).reduce((sum, [seqId, s]) => {
    const line = order.value?.items.find((i) => i.orderItemSeqId === seqId);
    return sum + (line ? line.unitPrice * s.qty : 0);
  }, 0));
const pickedAppeasementItems = computed(() =>
  Object.entries(appeasementSelections)
    .filter(([, s]) => s.qty > 0)
    .map(([orderItemSeqId, s]) => ({ orderItemSeqId, quantity: s.qty })));
// The refund total in effect: the override (once touched) else the auto picked-line total.
const appeasementEffectiveTotal = computed(() =>
  appeasementMode.value === "items" && !appeasementAmountTouched.value
    ? appeasementItemsTotal.value
    : Number(appeasementAmount.value));
// A partially-filled or out-of-range appeasement is invalid and must block submit.
const appeasementValid = computed(() => {
  if (!appeasementEnabled.value) return true;
  if (!hasKeptItems.value || !appeasementReasonId.value) return false;
  if (appeasementMode.value === "items") {
    const total = appeasementEffectiveTotal.value;
    return pickedAppeasementItems.value.length > 0 && total > 0 && total <= keptValue.value;
  }
  const amt = Number(appeasementAmount.value);
  return amt > 0 && amt <= keptValue.value;
});
// The single, specific reason the appeasement can't be submitted yet (drives the inline message).
// Empty string = nothing to flag. Only one cause is surfaced at a time so a valid amount never reads
// as an amount error when the real gap is a missing reason.
const appeasementHint = computed(() => {
  if (!appeasementEnabled.value || appeasementValid.value) return "";
  const cap = `${order.value?.currencyUomId ?? ""} ${keptValue.value.toFixed(2)}`.trim();
  if (appeasementMode.value === "items") {
    if (!pickedAppeasementItems.value.length) return translate("Pick at least one lost item.");
    if (appeasementEffectiveTotal.value > keptValue.value) {
      return `${translate("Refund can't exceed the kept-item value of")} ${cap}.`;
    }
    if (!appeasementReasons.value.length) {
      return translate("Appeasement reasons couldn't be loaded — reload the order and try again.");
    }
    return translate("Choose a reason for the appeasement.");
  }
  if (appeasementAmount.value === null) return "";
  const amt = Number(appeasementAmount.value);
  if (!(amt > 0 && amt <= keptValue.value)) {
    return `${translate("Enter a refund amount between 0 and")} ${cap}.`;
  }
  if (!appeasementReasons.value.length) {
    return translate("Appeasement reasons couldn't be loaded — reload the order and try again.");
  }
  return translate("Choose a reason for the appeasement.");
});
// When the operator returns everything (nothing kept), the appeasement is no longer eligible —
// turn it off so the toggle's state matches reality and no stale amount/reason lingers enabled.
watch(hasKeptItems, (has) => {
  if (!has) appeasementEnabled.value = false;
});
// Mirror the amount field to the auto picked-line total while the operator hasn't overridden it.
watch([appeasementItemsTotal, appeasementMode], ([total, mode]) => {
  if (mode === "items" && !appeasementAmountTouched.value) appeasementAmount.value = total as number;
});
function setAppeasementMode(mode: "amount" | "items") {
  appeasementMode.value = mode;
  appeasementAmountTouched.value = false;
  appeasementAmount.value = mode === "items" ? appeasementItemsTotal.value : null;
}
function setAppeasementQty(seqId: string, qty: number) {
  appeasementSelections[seqId] = { qty };
}
function onAppeasementAmountInput(v: number) {
  appeasementAmount.value = v;
  if (appeasementMode.value === "items") appeasementAmountTouched.value = true;
}
const hasItemsSelected = computed(() =>
  Object.values(selections).some((s) => s.qty > 0 && s.returnReasonId)
);
// Submit needs at least one of: a standard return (selected items) OR an appeasement. A stand-alone
// goodwill refund (customer keeps everything) is valid — the backend accepts an appeasement with no
// accompanying item return.
const canSubmit = computed(() =>
  mode.value === "exchange"
    ? hasItemsSelected.value
    : (hasItemsSelected.value || appeasementEnabled.value) && appeasementValid.value);

async function lookupOrder() {
  error.value = "";
  order.value = null;
  emitter.emit("presentLoader", { message: "Looking up order" });
  try {
    order.value = await store.loadOrder(orderId.value.trim());
    reasons.value = await store.loadReasons();
    // Appeasement reasons are optional context — a failure (e.g. the endpoint isn't live yet) must not
    // fail the whole lookup or block the standard return flow. The appeasement hint surfaces the gap.
    try {
      appeasementReasons.value = await store.loadAppeasementReasons();
    } catch {
      appeasementReasons.value = [];
    }
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
  // Exchange: send the picked lines back and the SAME products out (mirrored), with a fulfillment choice.
  if (mode.value === "exchange") {
    if (!items.length) return;
    const returnItems = items.map((i) => ({ orderItemSeqId: i.orderItemSeqId, returnQuantity: i.returnQuantity, returnReasonId: i.returnReasonId }));
    const exchangeItems = items.map((i) => ({ productId: i.productId, quantity: i.returnQuantity }));
    error.value = "";
    emitter.emit("presentLoader", { message: "Submitting exchange" });
    let exchangeReturnId: string | undefined;
    try {
      exchangeReturnId = await store.submitExchange({ orderId: order.value.orderId, fulfillmentType: fulfillmentType.value, returnItems, exchangeItems, currencyUomId: order.value.currencyUomId });
    } catch (e) {
      error.value = describeApiError(e, translate("Failed to create exchange"));
      commonUtil.showToast(error.value);
    } finally {
      emitter.emit("dismissLoader");
    }
    if (exchangeReturnId) router.push(`/return-detail/${exchangeReturnId}`);
    return exchangeReturnId;
  }
  const appeasement = appeasementEnabled.value && appeasementValid.value
    ? {
        currencyUomId: order.value.currencyUomId,
        reasonId: appeasementReasonId.value,
        ...(appeasementNote.value.trim() ? { note: appeasementNote.value.trim() } : {}),
        ...(appeasementMode.value === "items"
          ? {
              items: pickedAppeasementItems.value,
              ...(appeasementAmountTouched.value ? { amount: Number(appeasementAmount.value) } : {}),
            }
          : { amount: Number(appeasementAmount.value) }),
      }
    : undefined;
  // Nothing to submit: no returned items and no valid appeasement.
  if (!items.length && !appeasement) return;
  error.value = "";
  emitter.emit("presentLoader", { message: "Submitting return" });
  let returnId: string | undefined;
  try {
    returnId = await store.submitReturn({ orderId: order.value.orderId, items, appeasement });
  } catch (e) {
    error.value = describeApiError(e, translate("Failed to create return"));
    // Surface the failure regardless of scroll position — the inline error sits at the top of the page.
    commonUtil.showToast(error.value);
  } finally {
    emitter.emit("dismissLoader");
  }
  // Navigate only after the loader is dismissed — an active overlay swallows the Ionic route
  // transition, leaving the URL changed but the page un-transitioned until a manual refresh.
  if (returnId) router.push(`/return-detail/${returnId}`);
  return returnId;
}

defineExpose({
  orderId, order, selections, lookupOrder, submit,
  appeasementEnabled, appeasementAmount, appeasementReasonId, appeasementNote, appeasementReasons,
  keptValue, hasKeptItems, appeasementValid, appeasementHint, canSubmit,
  appeasementMode, appeasementSelections, appeasementAmountTouched,
  setAppeasementMode, setAppeasementQty, onAppeasementAmountInput,
  appeasementItemsTotal, pickedAppeasementItems, appeasementEffectiveTotal,
  mode, fulfillmentType, setMode,
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
