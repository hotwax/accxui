<template>
  <ion-page>
    <ion-menu v-if="isMobile" menu-id="returns-filter" content-id="filter-content" type="overlay">
      <ion-header>
        <ion-toolbar>
          <ion-title>{{ translate("Filters") }}</ion-title>
        </ion-toolbar>
      </ion-header>
      <ion-content>
        <ReturnFiltersContent />
      </ion-content>
    </ion-menu>

    <ion-header>
      <ion-toolbar>
        <ion-title>{{ translate("Returns") }}</ion-title>
        <ion-buttons slot="end">
          <ion-menu-button menu="returns-filter" class="mobile-only">
            <ion-icon :icon="filterOutline" />
          </ion-menu-button>
        </ion-buttons>
      </ion-toolbar>
    </ion-header>

    <ion-content id="filter-content" :scroll-y="false">
      <div class="find">
        <section class="search">
          <ion-searchbar
            data-testid="returns-search-input"
            :placeholder="translate('Search returns')"
            :value="store.query.searchTerm"
            @ionInput="store.query.searchTerm = $event.target.value"
          />
        </section>

        <aside class="filters" v-if="!isMobile">
          <ReturnFiltersContent />
        </aside>

        <main class="ion-content-scroll-host">
          <div class="empty-state" data-testid="returns-loading" v-if="store.loading && !store.returns.length">
            <ion-spinner name="crescent" />
            <p>{{ translate("Fetching returns") }}</p>
          </div>

          <div class="empty-state" data-testid="returns-empty" v-else-if="!filteredReturns.length">
            <template v-if="isAnyFilterApplied">
              <p>{{ translate("No returns found for the applied filters.") }}</p>
            </template>
            <template v-else>
              <ion-icon :icon="receiptOutline" color="medium" />
              <h1>{{ translate("No returns yet") }}</h1>
              <p>{{ translate("No returns were found. Create a return to get started.") }}</p>
              <ion-button fill="outline" @click="router.push('/create-return')">
                {{ translate("Create return") }}
              </ion-button>
            </template>
          </div>

          <template v-else>
            <div
              class="list-item return"
              :data-testid="`returns-row-${r.returnId}`"
              v-for="r in filteredReturns"
              :key="r.returnId"
              @click="router.push(`/return-detail/${r.returnId}`)"
            >
              <ion-item lines="none">
                <ion-label>
                  <template v-if="orderLabel(r)">{{ translate("Order") }} {{ orderLabel(r) }}</template>
                  <template v-else>{{ translate("Return") }} #{{ r.returnId }}</template>
                  <p>{{ translate(formatStatus(r.statusId)) }} · {{ translate("Requested") }} {{ formatDate(r.entryDate) }}</p>
                </ion-label>
              </ion-item>
              <div class="metadata">
                <ion-badge v-if="r.origin === 'shopify'" color="tertiary">{{ translate("From Shopify") }}</ion-badge>
                <ion-badge v-if="r.sync" :color="syncColor(r.sync.shopify)">{{ syncLabel(r.sync.shopify) }}</ion-badge>
              </div>
            </div>
          </template>

          <ion-infinite-scroll
            data-testid="returns-infinite-scroll"
            @ionInfinite="loadMore($event)"
            threshold="100px"
            v-if="store.isScrollable"
          >
            <ion-infinite-scroll-content loading-spinner="crescent" :loading-text="translate('Loading')" />
          </ion-infinite-scroll>
        </main>
      </div>

      <ion-fab vertical="bottom" horizontal="end" slot="fixed">
        <ion-fab-button data-testid="returns-create-fab" @click="router.push('/create-return')">
          <ion-icon :icon="addOutline" />
        </ion-fab-button>
      </ion-fab>
    </ion-content>
  </ion-page>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { translate } from "@common";
import {
  IonBadge, IonButton, IonButtons, IonContent, IonFab, IonFabButton, IonHeader, IonIcon,
  IonInfiniteScroll, IonInfiniteScrollContent, IonItem, IonLabel, IonMenu, IonMenuButton,
  IonPage, IonSearchbar, IonSpinner, IonTitle, IonToolbar, onIonViewWillEnter,
} from "@ionic/vue";
import { addOutline, receiptOutline, filterOutline } from "ionicons/icons";
import router from "@/router";
import { useMobile } from "@/composables/useMobile";
import ReturnFiltersContent from "@/components/ReturnFiltersContent.vue";
import { useReturnsStore } from "@/store/returnsStore";
import { formatStatus } from "@/util/labels";
import { formatDate } from "@/util/dates";
import { syncColor, syncLabel } from "@/util/syncState";
import type { ReturnSummary } from "@/types/returns";

const store = useReturnsStore();
const isMobile = useMobile();
const filteredReturns = computed(() => store.getFilteredReturns);
const isAnyFilterApplied = computed(() => !!(store.query.searchTerm || store.query.statusId));

// Prefer the customer-facing order name; fall back to the internal order id. Empty -> caller shows the return id.
function orderLabel(r: ReturnSummary) {
  return r.orderName || r.orderId || "";
}
async function loadMore(event: any) {
  const nextPage = Math.ceil(store.returns.length / 20);
  await store.fetchReturns(nextPage);
  await event.target.complete();
}

onIonViewWillEnter(() => store.fetchReturns(0));
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
  margin-bottom: var(--spacer-lg);
}
.metadata {
  text-align: end;
  margin-inline-end: var(--spacer-sm);
}
.find {
  height: 100%;
  display: grid;
  grid-template-rows: auto auto 1fr;
}
.find main {
  height: 100%;
  overflow-y: auto;
  padding-bottom: var(--spacer-lg);
}
.return {
  border-bottom: var(--border-medium);
  transition: background-color .3s ease;
  cursor: pointer;
}
.return ion-item {
  --background: transparent;
  width: 100%;
}
@media (min-width: 991px) {
  .mobile-only { display: none; }
  .find {
    grid-template-rows: auto 1fr;
  }
  .find .search {
    margin-inline-start: var(--spacer-xl);
    padding-block-start: var(--spacer-sm);
  }
  .find main {
    overflow-y: scroll;
  }
}
</style>
