<template>
  <!--
    Reusable stat card: an overline title + a prominent "big number" stat,
    followed by one of three optional follow-ups:
      1. subtitle  — pass the `subtitle` prop (or the #subtitle slot)
      2. trendline — drop a <Sparkline> into the default slot
      3. drilldown — set `button` and drop an <ion-list>/content into the default slot
  -->
  <ion-card :button="button" class="stat-card">
    <ion-card-content>
      <p v-if="title || $slots.title" class="overline">
        <slot name="title">{{ title }}</slot>
      </p>

      <h1 class="stat">
        <slot name="stat">{{ stat }}</slot>
      </h1>

      <p v-if="subtitle || $slots.subtitle" class="stat-subtitle">
        <slot name="subtitle">{{ subtitle }}</slot>
      </p>

      <div v-if="$slots.default" class="stat-followup">
        <slot />
      </div>
    </ion-card-content>
  </ion-card>
</template>

<script lang="ts" setup>
import { IonCard, IonCardContent } from '@ionic/vue';
import { defineProps } from 'vue';

defineProps({
  // Overline label shown above the stat (e.g. "Open Orders").
  title: {
    type: String,
    default: ''
  },
  // The primary value — the "big number".
  stat: {
    type: [String, Number],
    default: ''
  },
  // Optional caption rendered below the stat (follow-up #1).
  subtitle: {
    type: String,
    default: ''
  },
  // Makes the whole card tappable for drilldown navigation.
  button: {
    type: Boolean,
    default: false
  }
});
</script>

<style scoped>
.stat-card {
  margin: 0;
}

.stat {
  margin: var(--spacer-xs) 0;
}

.stat-subtitle {
  margin: 0;
}

.stat-followup {
  margin-top: var(--spacer-sm);
}
</style>
