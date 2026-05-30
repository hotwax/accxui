<template>
  <ion-item lines="none">
    <ion-select
      data-testid="returns-status-filter"
      :label="translate('Status')"
      :value="store.query.statusId"
      interface="popover"
      :placeholder="translate('All')"
      @ionChange="store.updateAppliedFilters($event.detail.value, 'statusId')"
    >
      <ion-select-option value="">{{ translate("All") }}</ion-select-option>
      <ion-select-option v-for="s in statuses" :key="s" :value="s">
        {{ translate(formatStatus(s)) }}
      </ion-select-option>
    </ion-select>
  </ion-item>
</template>

<script setup lang="ts">
import { IonItem, IonSelect, IonSelectOption } from "@ionic/vue";
import { translate } from "@common";
import { useReturnsStore } from "@/store/returnsStore";
import { formatStatus } from "@/util/labels";

const store = useReturnsStore();
// The four known return statuses (matches util/labels STATUS_LABELS).
const statuses = ["RETURN_REQUESTED", "RETURN_RECEIVED", "RETURN_COMPLETED", "RETURN_CANCELLED"];
</script>
