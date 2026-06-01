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
        <p v-if="error" class="error ion-padding-start">{{ error }}</p>

        <template v-if="r">
          <section class="header">
            <div class="id ion-margin-top">
              <ion-item lines="none">
                <ion-icon slot="start" :icon="receiptOutline" />
                <ion-label>
                  <p class="overline">{{ translate(formatStatus(r.statusId)) }}</p>
                  <ion-badge v-if="isAppeasement" color="tertiary" data-testid="detail-appeasement-badge">{{ translate("Appeasement") }}</ion-badge>
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

              <ion-card v-if="isAppeasement && r.appeasement">
                <ion-card-header>
                  <ion-card-title>{{ translate("Appeasement refund") }}</ion-card-title>
                </ion-card-header>
                <ion-card-content>
                  <h2 data-testid="detail-appeasement-amount">{{ commonUtil.formatCurrency(r.appeasement.amount, r.appeasement.currencyUomId) }}</h2>
                  <p>{{ translate("Reason") }}: {{ translate(formatReason(r.appeasement.reasonId, r.appeasement.reasonDesc)) }}</p>
                  <p v-if="r.appeasement.note" class="muted">{{ r.appeasement.note }}</p>
                  <p v-if="r.appeasement.relatedReturnId">
                    {{ translate("Related return") }}:
                    <ion-button fill="clear" size="small" data-testid="detail-related-return" @click="goToReturn(r.appeasement.relatedReturnId)">#{{ r.appeasement.relatedReturnId }}</ion-button>
                  </p>
                </ion-card-content>
              </ion-card>

              <ion-card v-if="canApprove || canComplete || canCancel">
                <ion-card-header>
                  <ion-card-title>{{ translate("Actions") }}</ion-card-title>
                </ion-card-header>
                <ion-card-content>
                  <template v-if="canApprove">
                    <p class="muted">{{ translate("Approve this return to sync it to Shopify, or reject it.") }}</p>
                    <ion-button expand="block" :disabled="busy" @click="approve" data-testid="detail-approve-btn">
                      {{ translate("Approve") }}
                    </ion-button>
                    <ion-button expand="block" color="danger" fill="outline" :disabled="busy" @click="reject" data-testid="detail-reject-btn">
                      {{ translate("Reject") }}
                    </ion-button>
                  </template>
                  <ion-button v-if="canComplete" expand="block" :disabled="busy" @click="complete" data-testid="detail-complete-btn">
                    {{ translate("Complete") }}
                  </ion-button>
                  <ion-button v-if="canCancel" expand="block" color="medium" fill="outline" :disabled="busy" @click="cancel" data-testid="detail-cancel-btn">
                    {{ translate("Cancel return") }}
                  </ion-button>
                </ion-card-content>
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

                  <p v-if="cancelledInShopify" class="muted">
                    {{ translate("Cancelled in OMS — still synced to Shopify") }}<template v-if="r.shopifySync?.returnStatusId"> · {{ r.shopifySync.returnStatusId }}</template>
                  </p>
                  <p v-else-if="canApprove" class="muted">{{ translate("Syncs to Shopify automatically when approved.") }}</p>

                  <!-- Approval drives the push; a failed push is recoverable, so let staff re-kick it. -->
                  <template v-if="r.sync.shopify === 'failed'">
                    <p v-if="r.shopifySync?.pushErrorMessage" class="error">{{ r.shopifySync.pushErrorMessage }}</p>
                    <ion-button expand="block" color="danger" :disabled="busy" @click="retryPush" data-testid="detail-retry-btn">
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
                  <ion-chip :color="completionColor(closeState)" data-testid="detail-completion-chip">
                    <ion-spinner v-if="closeState === 'pending'" name="dots" />
                    <ion-label>{{ completionLabel(closeState) }}</ion-label>
                  </ion-chip>

                  <p v-if="closeState === 'skipped'" class="muted">{{ translate("Completed in OMS — this return was never synced to Shopify.") }}</p>
                  <p v-else-if="closeState === 'pending'" class="muted">{{ translate("Closing the return in Shopify…") }}</p>

                  <p v-if="closeState === 'failed' && r.shopifySync?.closePushErrorMessage" class="error">{{ r.shopifySync.closePushErrorMessage }}</p>
                  <ion-button v-if="closeState === 'failed'" expand="block" color="danger" :disabled="busy" @click="retryComplete" data-testid="detail-retry-complete-btn">
                    {{ translate("Retry") }}
                  </ion-button>
                </ion-card-content>
              </ion-card>
            </div>
          </section>

          <hr />

          <ion-list v-if="!isAppeasement">
            <ion-item v-for="it in r.items" :key="it.orderItemSeqId" lines="full">
              <ion-label>
                <h2>{{ it.productName || it.sku || it.productId }}</h2>
                <p>{{ translate("Quantity") }}: {{ it.returnQuantity }} · {{ translate(formatReason(it.returnReasonId, it.returnReasonDesc)) }}</p>
                <p v-if="it.sku" class="muted">{{ translate("SKU") }}: {{ it.sku }}</p>
              </ion-label>
            </ion-item>
          </ion-list>
          <ion-list v-else>
            <ion-item lines="full">
              <ion-label>
                <h2>{{ translate("Goodwill refund") }}</h2>
                <p v-if="r.appeasement">{{ commonUtil.formatCurrency(r.appeasement.amount, r.appeasement.currencyUomId) }} · {{ translate(formatReason(r.appeasement.reasonId, r.appeasement.reasonDesc)) }}</p>
              </ion-label>
            </ion-item>
          </ion-list>
        </template>
      </main>
    </ion-content>
  </ion-page>
</template>

<script setup lang="ts">
import { computed, ref } from "vue";
import { commonUtil, emitter, translate } from "@common";
import {
  IonBackButton, IonBadge, IonButton, IonCard, IonCardContent, IonCardHeader, IonCardTitle, IonChip,
  IonContent, IonHeader, IonIcon, IonItem, IonLabel, IonList, IonPage, IonSpinner, IonTitle, IonToolbar,
  alertController, onIonViewWillEnter,
} from "@ionic/vue";
import { receiptOutline } from "ionicons/icons";
import router from "@/router";
import { useReturnsStore } from "@/store/returnsStore";
import { describeApiError } from "@/util/errorMessage";
import { formatStatus, formatReason } from "@/util/labels";
import { formatDate } from "@/util/dates";
import { completionColor, completionLabel, resolveShopifyCloseState, syncColor, syncLabel } from "@/util/syncState";

const props = defineProps<{ returnId: string }>();
const store = useReturnsStore();
const busy = ref(false);
const error = ref("");
const loading = ref(false);

const r = computed(() => store.current);
// True once the loaded return matches this route (store.current may briefly hold a previously-viewed return).
const loaded = computed(() => r.value?.returnId === props.returnId);
const isAppeasement = computed(() => r.value?.type === "appeasement");
// Requested → Approve + Reject (+ Cancel). Approved → Cancel (+ Complete for normal returns). Received →
// Complete. Terminal → none. An appeasement is refund-only — the refund fires on approve and there is no
// Shopify return to close, so it is NOT completable; its lifecycle ends at approved / rejected / cancelled.
const canApprove = computed(() => r.value?.statusId === "RETURN_REQUESTED");
const canCancel = computed(() => r.value?.statusId === "RETURN_REQUESTED" || r.value?.statusId === "RETURN_APPROVED");
const canComplete = computed(() => !isAppeasement.value && (r.value?.statusId === "RETURN_APPROVED" || r.value?.statusId === "RETURN_RECEIVED"));
const isCompleted = computed(() => r.value?.statusId === "RETURN_COMPLETED");
// Collapsed Shopify completion state — only meaningful for a normal return once it's RETURN_COMPLETED.
// An appeasement has no Shopify return to close, so it has no completion state (the refund sync chip stands).
const closeState = computed(() => (isCompleted.value && !isAppeasement.value ? resolveShopifyCloseState(r.value?.shopifySync) : null));
// A return cancelled in the OMS but still linked in Shopify (synced stays true; Shopify status → CANCELED).
const cancelledInShopify = computed(() => r.value?.statusId === "RETURN_CANCELLED" && r.value?.sync.shopify === "synced");

// Run a lifecycle action with the global loader + error handling.
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

async function confirmAction(header: string, confirmText: string): Promise<boolean> {
  const alert = await alertController.create({
    header: translate(header),
    buttons: [
      { text: translate("Cancel"), role: "cancel" },
      { text: translate(confirmText), role: "confirm" },
    ],
  });
  await alert.present();
  const { role } = await alert.onDidDismiss();
  return role === "confirm";
}

function approve() {
  return runAction("Approving return", () => store.approveReturn(props.returnId), "Failed to approve return");
}
async function reject() {
  if (!(await confirmAction("Reject this return?", "Reject"))) return;
  return runAction("Rejecting return", () => store.rejectReturn(props.returnId), "Failed to reject return");
}
async function cancel() {
  if (!(await confirmAction("Cancel this return?", "Cancel return"))) return;
  return runAction("Cancelling return", () => store.cancelReturn(props.returnId), "Failed to cancel return");
}
async function complete() {
  if (!(await confirmAction("Complete this return?", "Complete"))) return;
  return runAction("Completing return", async () => {
    await store.completeReturn(props.returnId);
    // The OMS is RETURN_COMPLETED regardless; if the Shopify close didn't settle, surface it (it's retryable).
    if (closeState.value === "failed") {
      commonUtil.showToast(translate("Completed in OMS, but closing in Shopify failed — you can retry below."));
    }
  }, "Failed to complete return");
}
// Re-run a failed Shopify completion (the OMS is already RETURN_COMPLETED).
function retryComplete() {
  return runAction("Completing in Shopify", () => store.retryComplete(props.returnId), "Failed to retry completion");
}

// An appeasement links back to the standard return created alongside it.
function goToReturn(id: string) {
  router.push(`/return-detail/${id}`);
}

// Re-kick a failed Shopify push (approval already happened); the chip reflects the resulting state.
function retryPush() {
  return runAction("Pushing to Shopify", () => store.pushAndPoll(props.returnId, "shopify"), "Push to Shopify failed");
}

onIonViewWillEnter(async () => {
  error.value = "";
  loading.value = true;
  try {
    await store.fetchReturn(props.returnId);
    // A freshly-approved return loads as "pending" — poll the create-push to completion.
    if (store.current?.sync.shopify === "pending") {
      busy.value = true;
      try { await store.pollSync(props.returnId, "shopify"); } finally { busy.value = false; }
    }
    // A freshly-completed return whose Shopify close is still in flight — poll it to settle.
    if (isCompleted.value && closeState.value === "pending") {
      busy.value = true;
      try { await store.pollCompletion(props.returnId); } finally { busy.value = false; }
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
hr {
  border-top: 1px solid var(--border-medium);
  margin: var(--spacer-xs) 0;
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
