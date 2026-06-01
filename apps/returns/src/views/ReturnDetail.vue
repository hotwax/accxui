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

              <ion-card v-if="canCancel">
                <ion-card-header>
                  <ion-card-title>{{ translate("Approval") }}</ion-card-title>
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
                  <ion-button expand="block" color="medium" fill="outline" :disabled="busy" @click="cancel" data-testid="detail-cancel-btn">
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
                  <p v-else-if="canApprove" class="muted">{{ translate("Syncs to Shopify once approved.") }}</p>

                  <p v-if="r.sync.shopify === 'failed' && r.shopifySync?.pushErrorMessage" style="color: var(--ion-color-danger); white-space: pre-wrap">{{ r.shopifySync.pushErrorMessage }}</p>
                  <!-- Approved but not synced (failed OR stuck pending) → let staff re-kick the push. -->
                  <ion-button v-if="canManualPush" expand="block" :color="r.sync.shopify === 'failed' ? 'danger' : 'primary'" :disabled="busy" @click="push" :data-testid="r.sync.shopify === 'failed' ? 'detail-retry-btn' : 'detail-push-btn'">
                    {{ r.sync.shopify === "failed" ? translate("Retry") : translate("Push to Shopify") }}
                  </ion-button>
                </ion-card-content>
              </ion-card>
            </div>
          </section>

          <hr />

          <ion-list>
            <ion-item v-for="it in r.items" :key="it.orderItemSeqId" lines="full">
              <ion-label>
                <h2>{{ it.productName || it.sku || it.productId }}</h2>
                <p>{{ translate("Quantity") }}: {{ it.returnQuantity }} · {{ translate(formatReason(it.returnReasonId, it.returnReasonDesc)) }}</p>
                <p v-if="it.sku" class="muted">{{ translate("SKU") }}: {{ it.sku }}</p>
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
  IonBackButton, IonButton, IonCard, IonCardContent, IonCardHeader, IonCardTitle, IonChip,
  IonContent, IonHeader, IonIcon, IonItem, IonLabel, IonList, IonPage, IonSpinner, IonTitle, IonToolbar,
  alertController, onIonViewWillEnter,
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
// Requested → Approve + Reject (+ Cancel). Approved → Cancel only. Terminal statuses → no actions.
const canApprove = computed(() => r.value?.statusId === "RETURN_REQUESTED");
const canCancel = computed(() => r.value?.statusId === "RETURN_REQUESTED" || r.value?.statusId === "RETURN_APPROVED");
// A return cancelled in the OMS but still linked in Shopify (synced stays true; Shopify status → CANCELED).
const cancelledInShopify = computed(() => r.value?.statusId === "RETURN_CANCELLED" && r.value?.sync.shopify === "synced");
// Approved but not yet synced (failed or stuck pending) → allow a manual re-push from the UI.
const canManualPush = computed(() => r.value?.statusId === "RETURN_APPROVED" && r.value?.sync.shopify !== "synced");

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

// Re-kick the Shopify push (approval already happened) — for a failed or stuck-pending sync.
function push() {
  return runAction("Pushing to Shopify", async () => {
    await store.pushAndPoll(props.returnId, "shopify");
    // The push can be a no-op ("skipped" — e.g. a stale push already pending) or not finish in time;
    // surface that instead of silently leaving the spinner, so staff know it didn't sync.
    if (store.current?.sync.shopify !== "synced") {
      commonUtil.showToast(translate("Shopify push didn't complete — it may already be pending. The OMS may need to clear a stuck push."));
    }
  }, "Push to Shopify failed");
}

onIonViewWillEnter(async () => {
  error.value = "";
  loading.value = true;
  try {
    await store.fetchReturn(props.returnId);
    // A freshly-approved return loads as "pending" — poll to completion.
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
hr {
  border-top: 1px solid var(--border-medium);
  margin: var(--spacer-xs) 0;
}
.muted {
  color: var(--ion-color-medium);
  font-size: 0.8em;
}
</style>
