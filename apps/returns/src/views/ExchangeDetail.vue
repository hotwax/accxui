<template>
  <ion-page>
    <ion-header>
      <ion-toolbar>
        <ion-back-button data-testid="exchange-detail-back-btn" slot="start" default-href="/tabs/returns" />
        <ion-title>{{ translate("Exchange") }} #{{ returnId }}</ion-title>
      </ion-toolbar>
    </ion-header>

    <ion-content>
      <main class="empty-state" data-testid="exchange-detail-loading" v-if="loading && !loaded">
        <ion-spinner name="crescent" />
        <ion-label>{{ translate("Fetching exchange details") }}</ion-label>
      </main>

      <main v-else>
        <p v-if="error" class="error ion-padding-start">{{ error }}</p>

        <template v-if="r && isExchange">
        <section class="header">
          <div class="id ion-margin-top">
            <ion-item lines="none">
              <ion-icon slot="start" :icon="swapHorizontalOutline" />
              <ion-label>
                <p class="overline">{{ translate(formatStatus(r.statusId)) }}</p>
                <ion-badge color="secondary" data-testid="exchange-detail-badge">{{ translate("Exchange") }}</ion-badge>
                <h1>{{ r.orderName || r.orderId || `#${returnId}` }}</h1>
                <p>{{ translate("Requested") }}: {{ formatDate(r.entryDate) }}</p>
              </ion-label>
            </ion-item>
          </div>

          <div class="info">
            <!-- ===== Returning half ===== -->
            <ion-card data-testid="exchange-returning-section">
              <ion-card-header>
                <ion-card-title>{{ translate("Returning") }}</ion-card-title>
                <ion-card-subtitle>{{ translate("Items coming back") }}</ion-card-subtitle>
              </ion-card-header>
              <ion-list>
                <ion-item v-for="it in r.items" :key="it.orderItemSeqId" lines="full">
                  <ion-label>
                    <h3>{{ it.productName || it.sku || it.productId }}</h3>
                    <p>{{ translate("Quantity") }}: {{ it.returnQuantity }} · {{ translate(formatReason(it.returnReasonId, it.returnReasonDesc)) }}</p>
                    <p v-if="it.sku" class="muted">{{ translate("SKU") }}: {{ it.sku }}</p>
                  </ion-label>
                </ion-item>
              </ion-list>
            </ion-card>

            <!-- Shopify sync (exchange create-push: returnCreate + returnProcess) -->
            <ion-card>
              <ion-card-header>
                <ion-card-title>{{ translate("Shopify sync") }}</ion-card-title>
              </ion-card-header>
              <ion-card-content>
                <ion-chip :color="syncColor(r.sync.shopify)">
                  <ion-spinner v-if="r.sync.shopify === 'pending'" name="dots" />
                  <ion-label>{{ r.sync.shopify === 'synced' ? translate("Exchange confirmed") : syncLabel(r.sync.shopify) }}</ion-label>
                </ion-chip>
                <p v-if="r.externalIds.shopify">{{ translate("Shopify return ID") }}: {{ r.externalIds.shopify }}</p>
                <!-- A failed exchange push is recoverable via the exchange retry endpoint. -->
                <template v-if="r.sync.shopify === 'failed'">
                  <p v-if="r.shopifySync?.processErrorMessage || r.shopifySync?.pushErrorMessage" class="error">
                    {{ r.shopifySync.processErrorMessage || r.shopifySync.pushErrorMessage }}
                  </p>
                  <ion-button expand="block" color="danger" :disabled="busy" @click="retryPush" data-testid="exchange-retry-btn">
                    {{ translate("Retry") }}
                  </ion-button>
                </template>
              </ion-card-content>
            </ion-card>

            <ion-card v-if="isCompleted && closeState">
              <ion-card-header>
                <ion-card-title>{{ translate("Completion") }}</ion-card-title>
              </ion-card-header>
              <ion-card-content>
                <ion-chip :color="completionColor(closeState)" data-testid="exchange-completion-chip">
                  <ion-spinner v-if="closeState === 'pending'" name="dots" />
                  <ion-label>{{ completionLabel(closeState) }}</ion-label>
                </ion-chip>
                <p v-if="closeState === 'pending'" class="muted">{{ translate("Closing the return in Shopify…") }}</p>
                <p v-if="closeState === 'failed' && r.shopifySync?.closePushErrorMessage" class="error">{{ r.shopifySync.closePushErrorMessage }}</p>
                <ion-button v-if="closeState === 'failed'" expand="block" color="danger" :disabled="busy" @click="retryComplete" data-testid="exchange-retry-complete-btn">
                  {{ translate("Retry") }}
                </ion-button>
              </ion-card-content>
            </ion-card>

            <!-- ===== Replacement half ===== -->
            <ion-card data-testid="exchange-replacement-section">
              <ion-card-header>
                <ion-card-title>{{ translate("Replacement order") }}</ion-card-title>
                <ion-card-subtitle>{{ translate("Items going out") }}</ion-card-subtitle>
              </ion-card-header>
              <ion-card-content>
                <div class="empty-state" v-if="replacementLoading">
                  <ion-spinner name="crescent" />
                </div>
                <p v-else-if="replacementError" class="muted">{{ translate("Couldn't load the replacement order") }}</p>

                <template v-else-if="replacementOrder">
                  <h2 data-testid="exchange-replacement-order">{{ replacementOrder.orderName || replacementOrder.orderId }}</h2>
                  <p v-if="replacementOrder.orderName && replacementOrder.orderName !== replacementOrder.orderId" class="muted">{{ replacementOrder.orderId }}</p>
                  <p v-if="replacementOrder.orderDate" class="muted">{{ translate("Ordered") }}: {{ formatDate(replacementOrder.orderDate) }}</p>
                  <p>{{ replacementOrder.statusId === 'ORDER_COMPLETED' ? translate("Replacement completed") : translate("Replacement approved — in fulfillment") }}</p>
                  <p class="muted">{{ replacementOrder.fulfillmentType === 'IMMEDIATE' ? translate("Handed over in store") : translate("Shipped to customer") }}<template v-if="replacementOrder.shipmentMethod"> · {{ replacementOrder.shipmentMethod }}</template></p>
                  <p v-if="replacementOrder.trackingCode" class="muted">{{ translate("Tracking") }}: {{ replacementOrder.trackingCode }}<template v-if="replacementOrder.carrier"> ({{ replacementOrder.carrier }})</template></p>

                  <ion-list data-testid="exchange-replacement-items">
                    <ion-item v-for="(it, idx) in replacementOrder.items" :key="idx" lines="full">
                      <ion-label>
                        <h3>{{ it.productName || it.sku || it.productId }}</h3>
                        <p>{{ translate("Quantity") }}: {{ it.quantity }} · {{ commonUtil.formatCurrency(it.unitPrice, replacementOrder.currencyUomId) }}</p>
                        <p v-if="it.sku" class="muted">{{ translate("SKU") }}: {{ it.sku }}</p>
                      </ion-label>
                    </ion-item>
                  </ion-list>

                  <p v-if="replacementOrder.grandTotal != null"><strong>{{ translate("Order total") }}:</strong> {{ commonUtil.formatCurrency(replacementOrder.grandTotal, replacementOrder.currencyUomId) }}</p>
                </template>

                <p class="muted">{{ exchangeCredit > 0
                  ? `${translate('Refund difference owed')}: ${commonUtil.formatCurrency(exchangeCredit, replacementOrder?.currencyUomId || 'USD')}`
                  : translate("Even swap — no refund difference") }}</p>
              </ion-card-content>
            </ion-card>
          </div>
        </section>
        </template>
      </main>
    </ion-content>
  </ion-page>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { commonUtil, emitter, translate } from "@common";
import {
  IonBackButton, IonBadge, IonButton, IonCard, IonCardContent, IonCardHeader, IonCardSubtitle, IonCardTitle,
  IonChip, IonContent, IonHeader, IonIcon, IonItem, IonLabel, IonList, IonPage, IonSpinner, IonTitle,
  IonToolbar, onIonViewWillEnter,
} from "@ionic/vue";
import { swapHorizontalOutline } from "ionicons/icons";
import { useReturnsStore } from "@/store/returnsStore";
import { describeApiError } from "@/util/errorMessage";
import { formatStatus, formatReason } from "@/util/labels";
import { formatDate } from "@/util/dates";
import { completionColor, completionLabel, resolveShopifyCloseState, syncColor, syncLabel } from "@/util/syncState";
import type { ReplacementOrderDetail } from "@/types/returns";

const props = defineProps<{ returnId: string }>();
const store = useReturnsStore();
const busy = ref(false);
const error = ref("");
const loading = ref(false);
const replacementOrder = ref<ReplacementOrderDetail | null>(null);
const replacementLoading = ref(false);
const replacementError = ref(false);

const r = computed(() => store.current);
const loaded = computed(() => r.value?.returnId === props.returnId);
const isExchange = computed(() => r.value?.isExchange === true);
const exchangeCredit = computed(() => r.value?.exchange?.exchangeCreditAmount ?? 0);

const isCompleted = computed(() => r.value?.statusId === "RETURN_COMPLETED");
const closeState = computed(() => (isCompleted.value ? resolveShopifyCloseState(r.value?.shopifySync) : null));

async function runAction(message: string, action: () => Promise<unknown>, failMessage: string) {
  error.value = "";
  busy.value = true;
  emitter.emit("presentLoader", { message });
  try {
    await action();
  } catch (e) {
    error.value = describeApiError(e, translate(failMessage));
  } finally {
    busy.value = false;
    emitter.emit("dismissLoader");
  }
}

function retryComplete() {
  return runAction("Completing in Shopify", () => store.retryComplete(props.returnId), "Failed to retry completion");
}
// An exchange's push is recovered via the exchange-specific endpoint (pushExchangeToShopify), never the plain one.
function retryPush() {
  return runAction("Pushing exchange to Shopify", () => store.retryExchangePush(props.returnId), "Push to Shopify failed");
}

async function loadReplacement() {
  const orderId = r.value?.exchange?.replacementOrderId;
  if (!orderId) return;
  replacementError.value = false;
  replacementLoading.value = true;
  try {
    replacementOrder.value = await store.loadReplacementOrder(orderId);
  } catch (e) {
    replacementError.value = true;
  } finally {
    replacementLoading.value = false;
  }
}

// Holds the in-flight enter promise so both onMounted and onIonViewWillEnter (which both fire on first
// entry) dedupe to a single load — and the exposed enter() in tests awaits the same promise.
let enterPromise: Promise<void> | null = null;

async function _enter() {
  error.value = "";
  loading.value = true;
  try {
    await store.fetchReturn(props.returnId);
    await loadReplacement();
    // A freshly-created exchange loads "pending" — poll the create-push (PROC) to completion.
    if (store.current?.sync.shopify === "pending") {
      busy.value = true;
      try { await store.pollSync(props.returnId, "shopify"); } finally { busy.value = false; }
    }
    if (isCompleted.value && closeState.value === "pending") {
      busy.value = true;
      try { await store.pollCompletion(props.returnId); } finally { busy.value = false; }
    }
  } catch (e) {
    error.value = describeApiError(e, translate("Failed to load exchange"));
  } finally {
    loading.value = false;
    enterPromise = null;
  }
}

function enter(): Promise<void> {
  if (!enterPromise) enterPromise = _enter();
  return enterPromise;
}
// Load on mount (covers a direct/deep-link visit and the first nav-in) and on view-enter (refreshes on
// re-entry to a CACHED view, where onMounted doesn't run again). The loading-guard dedupes the pair.
onMounted(enter);
onIonViewWillEnter(enter);

// Exposed for unit tests (Ionic's onIonViewWillEnter does not fire under a plain mount).
defineExpose({ enter, replacementOrder });
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
.muted {
  color: var(--ion-color-medium);
  font-size: 0.8em;
}
.error {
  color: var(--ion-color-danger);
  white-space: pre-wrap;
}
</style>
