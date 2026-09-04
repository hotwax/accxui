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
        <ion-select
          v-if="hasStorePicker"
          label-placement="stacked"
          :justify="selectLabel ? 'space-between' : 'start'"
          :aria-label="selectLabel || translate('Select store')"
          interface="popover"
          :value="currentProductStoreId"
          @ionChange="emit('update:productStore', $event.detail.value, $event)"
        >
          <ion-label slot="label">
            <p class="overline">{{ displayInstanceLabel }}</p>
            <template v-if="selectLabel">{{ selectLabel }}</template>
          </ion-label>
          <ion-select-option
            v-for="store in productStores"
            :key="storeId(store)"
            :value="storeId(store)"
          >
            {{ storeLabel(store) }}
          </ion-select-option>
        </ion-select>

        <ion-label v-else class="ion-text-wrap">
          <p class="overline">{{ displayInstanceLabel }}</p>
          {{ currentStoreLabel }}
        </ion-label>

        <ion-note v-if="displayTimeZone" slot="end" class="ion-text-end" :color="isTimeZoneMismatched ? 'danger' : ''">
          {{ displayTimeZone }}
          <p v-if="displayZoneTime">{{ displayZoneTime }}</p>
        </ion-note>
      </ion-item>
    </ion-toolbar>
  </ion-footer>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue';
import { IonFooter, IonItem, IonLabel, IonNote, IonSelect, IonSelectOption, IonToolbar } from '@ionic/vue';
import { translate } from '../core/i18n';
import { accxuiConfig } from '../core/configRegistry';
import { commonUtil } from '../utils/commonUtil';

const HOTWAX_HOST_SUFFIX = '.hotwax.io';

const props = withDefaults(defineProps<{
  /** The OMS this session is pointed at — a bare handle reads better than a full URL. */
  instanceLabel?: string;
  /** Stores available to switch between. One or none hides the picker. */
  productStores?: any[];
  /** Which of `productStores` is active. */
  currentProductStoreId?: string;
  /** The user's configured timezone. When omitted, resolves from accxuiConfig. */
  timeZone?: string;
  /** Colors the timezone danger. When omitted, derived by comparing against browser timezone. */
  timeZoneMismatched?: boolean;
  /** Current time in `timeZone`. When omitted, driven by an internal 10s clock when mismatched. */
  zoneTime?: string;
  /** Overrides the picker's label. */
  selectLabel?: string;
}>(), {
  instanceLabel: '',
  productStores: () => [],
  currentProductStoreId: '',
  timeZone: '',
  timeZoneMismatched: undefined,
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
  const stores = props.productStores || [];
  const current = stores.find((store: any) => storeId(store) === props.currentProductStoreId)
    || (stores.length === 1 ? stores[0] : null);
  return current ? storeLabel(current) : '';
});

const displayInstanceLabel = computed(() => {
  if (props.instanceLabel) return props.instanceLabel;
  const url = (commonUtil as any)?.getMaargURL?.() || (commonUtil as any)?.getOmsURL?.() || '';
  if (!url) return '';
  const host = url.replace(/^https?:\/\//, '').split('/')[0];
  return host.endsWith(HOTWAX_HOST_SUFFIX) ? host.slice(0, -HOTWAX_HOST_SUFFIX.length) : host;
});

const browserTimeZone = typeof Intl !== 'undefined' && Intl.DateTimeFormat
  ? Intl.DateTimeFormat().resolvedOptions().timeZone
  : '';

const displayTimeZone = computed(() => {
  if (props.timeZone) return props.timeZone;
  return accxuiConfig.value?.current?.timeZone || '';
});

const isTimeZoneMismatched = computed(() => {
  if (props.timeZoneMismatched !== undefined) {
    return props.timeZoneMismatched;
  }
  return !!displayTimeZone.value && !!browserTimeZone && displayTimeZone.value !== browserTimeZone;
});

const selectedZoneTime = ref('');
const displayZoneTime = computed(() => props.zoneTime || selectedZoneTime.value);
let clockTimer: ReturnType<typeof setInterval> | undefined;

function refreshSelectedZoneTime() {
  if (props.zoneTime) {
    selectedZoneTime.value = props.zoneTime;
    return;
  }
  if (!displayTimeZone.value || !isTimeZoneMismatched.value) {
    selectedZoneTime.value = '';
    return;
  }
  if (commonUtil && typeof commonUtil.getCurrentTime === 'function') {
    selectedZoneTime.value = commonUtil.getCurrentTime(displayTimeZone.value, 't');
  }
}

watch([displayTimeZone, isTimeZoneMismatched], refreshSelectedZoneTime);

onMounted(() => {
  refreshSelectedZoneTime();
  clockTimer = setInterval(refreshSelectedZoneTime, 10000);
});

onUnmounted(() => {
  if (clockTimer) clearInterval(clockTimer);
});
</script>
