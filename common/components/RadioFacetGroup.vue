<template>
  <ion-radio-group :value="modelValue" @ionChange="onChange">
    <div class="radio-facets">
      <ion-item lines="none" v-for="opt in options" :key="opt.value">
        <ion-radio :value="opt.value" :label-placement="labelPlacement" :disabled="opt.disabled">
          <slot name="option" :option="opt">
            <ion-label class="ion-text-wrap">
              {{ opt.primary }}
              <p v-if="opt.secondary">{{ opt.secondary }}</p>
              <p v-if="opt.meta" class="meta">{{ opt.meta }}</p>
            </ion-label>
          </slot>
        </ion-radio>
      </ion-item>
    </div>
  </ion-radio-group>
</template>

<script lang="ts" setup>
import { IonItem, IonLabel, IonRadio, IonRadioGroup } from '@ionic/vue';
import type { PropType } from 'vue';
import { defineEmits, defineProps } from 'vue';

type LabelPlacement = 'end' | 'fixed' | 'start' | 'stacked';

interface RadioFacetOption {
  value: string | number;
  primary: string;
  secondary?: string;
  meta?: string;
  disabled?: boolean;
}

const props = defineProps({
  modelValue: {
    type: [String, Number],
    default: ''
  },
  options: {
    type: Array as () => RadioFacetOption[],
    default: () => []
  },
  labelPlacement: {
    type: String as PropType<LabelPlacement>,
    default: 'end'
  }
});

const emit = defineEmits(['update:modelValue', 'change']);

const onChange = (event: CustomEvent) => {
  const value = event.detail.value;
  emit('update:modelValue', value);
  emit('change', value);
};
</script>

<style scoped>
.radio-facets {
  display: flex;
  flex-wrap: nowrap;
  overflow-x: scroll;
  gap: var(--spacer-xs);
  margin: 8px 0 6px;
}

.radio-facets > ion-item {
  flex: 1 0 100%;
  max-width: fit-content;
  border: var(--border-medium);
  border-radius: 10px;
}

.radio-facets ion-item:first-child {
  margin-left: var(--spacer-sm);
}

.radio-facets ion-item:last-child {
  margin-right: var(--spacer-sm);
}

.meta {
  opacity: 0.6;
}
</style>
