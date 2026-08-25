<template>
  <!--
    The menu footer every app repeats: which OMS instance you are connected to, which product
    store you are acting as, and what time it is in your configured timezone.

    Purely presentational — it reads no store of its own. Each app's user/product-store state has
    a different shape (userStore.getUserTimeZone vs userProfile.timeZone, a productStore catalog
    vs userProfile.stores), so the data arrives as props and the store change leaves as an event.

    With more than one product store the picker needs its own row, and the instance label keeps
    the row above it. With exactly one there is nothing to pick, so the store name becomes that
    row's value and the instance label its overline — one row instead of two.
  -->
  <ion-footer>
    <ion-toolbar>
      <ion-item lines="none">
        <ion-label class="ion-text-wrap">
          <p class="overline">{{ instanceLabel }}</p>
          <template v-if="!hasStorePicker">{{ currentStoreLabel }}</template>
        </ion-label>
        <ion-note v-if="timeZone" slot="end" class="ion-text-end" :color="timeZoneMismatched ? 'danger' : ''">
          {{ timeZone }}
          <p v-if="zoneTime">{{ zoneTime }}</p>
        </ion-note>
      </ion-item>

      <ion-item v-if="hasStorePicker" lines="none">
        <ion-select
          :label="selectLabel || translate('Select store')"
          interface="popover"
          :value="currentProductStoreId"
          @ionChange="emit('update:productStore', $event.detail.value, $event)"
        >
          <ion-select-option
            v-for="store in productStores"
            :key="storeId(store)"
            :value="storeId(store)"
          >
            {{ storeLabel(store) }}
          </ion-select-option>
        </ion-select>
      </ion-item>
    </ion-toolbar>
  </ion-footer>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { IonFooter, IonItem, IonLabel, IonNote, IonSelect, IonSelectOption, IonToolbar } from '@ionic/vue';
import { translate } from '../core/i18n';

const props = withDefaults(defineProps<{
  /** The OMS this session is pointed at — a bare handle reads better than a full URL. */
  instanceLabel?: string;
  /** Stores available to switch between. One or none hides the picker. */
  productStores?: any[];
  /** Which of `productStores` is active. */
  currentProductStoreId?: string;
  /** The user's configured timezone. Omitted entirely when blank. */
  timeZone?: string;
  /** Colors the timezone danger — the app decides what counts as a mismatch. */
  timeZoneMismatched?: boolean;
  /** Current time in `timeZone`. Apps that do not run a clock leave it blank and it is hidden. */
  zoneTime?: string;
  /** Overrides the picker's label. */
  selectLabel?: string;
}>(), {
  instanceLabel: '',
  productStores: () => [],
  currentProductStoreId: '',
  timeZone: '',
  timeZoneMismatched: false,
  zoneTime: '',
  selectLabel: ''
});

const emit = defineEmits<{
  /**
   * The chosen store id, plus the originating Ionic event. Most apps only need the id; the
   * event is there for the ones that confirm the switch and have to put the picker back when
   * the user declines — ion-select keeps its own display value, so reverting means writing to
   * `event.target.value`, which is unreachable from the id alone.
   */
  (event: 'update:productStore', productStoreId: string, ionEvent: any): void;
}>();

function storeId(store: any): string {
  return store?.productStoreId;
}

function storeLabel(store: any): string {
  return store?.storeName || store?.productStoreId || '';
}

const hasStorePicker = computed(() => (props.productStores?.length || 0) > 1);

const currentStoreLabel = computed(() => {
  const current = (props.productStores || []).find((store: any) => storeId(store) === props.currentProductStoreId);
  return current ? storeLabel(current) : '';
});
</script>
