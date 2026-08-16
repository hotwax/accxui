<template>
  <!--
    Lightweight inline trendline (spark line). Normalizes `points` to the
    viewBox automatically, so callers just pass raw values.
  -->
  <div class="sparkline-container" :style="{ height: `${height}px` }">
    <svg
      class="sparkline"
      :viewBox="`0 0 100 ${height}`"
      width="100%"
      :height="height"
      :stroke="`var(--ion-color-${color})`"
      :stroke-width="strokeWidth"
      fill="none"
      preserveAspectRatio="none"
      :role="label ? 'img' : 'presentation'"
      :aria-label="label || undefined"
      :aria-hidden="label ? undefined : 'true'"
    >
      <!--
        preserveAspectRatio="none" stretches x far more than y, which would
        scale the stroke unevenly; non-scaling-stroke keeps it a constant width.
        A single value has no segment to draw, so it renders as a dot instead.
      -->
      <polyline
        v-if="polylinePoints"
        :points="polylinePoints"
        vector-effect="non-scaling-stroke"
        stroke-linecap="round"
        stroke-linejoin="round"
      />
      <line
        v-else-if="singlePoint"
        :x1="singlePoint.x"
        :y1="singlePoint.y"
        :x2="singlePoint.x"
        :y2="singlePoint.y"
        vector-effect="non-scaling-stroke"
        stroke-linecap="round"
      />
    </svg>
  </div>
</template>

<script lang="ts" setup>
import { computed } from 'vue';

const props = defineProps({
  // Raw data values, plotted left-to-right.
  points: {
    type: Array as () => number[],
    default: () => []
  },
  // Ionic color name, resolved to --ion-color-<color>.
  color: {
    type: String,
    default: 'primary'
  },
  strokeWidth: {
    type: Number,
    default: 2
  },
  height: {
    type: Number,
    default: 30
  },
  // Describes the line for screen readers. Without it the svg is decorative.
  label: {
    type: String,
    default: ''
  }
});

// Coordinates for each value, in viewBox space.
const coordinates = computed(() => {
  const values = props.points;
  if (!values.length) return [];

  const max = Math.max(...values);
  const min = Math.min(...values);
  const range = max - min || 1;

  const inset = props.strokeWidth;
  const usableHeight = props.height - inset * 2;
  const lastIndex = values.length - 1 || 1;

  return values.map((value, i) => ({
    x: (i / lastIndex) * 100,
    y: inset + (1 - (value - min) / range) * usableHeight
  }));
});

const singlePoint = computed(() => (coordinates.value.length === 1 ? coordinates.value[0] : null));

const polylinePoints = computed(() =>
  coordinates.value.length > 1 ? coordinates.value.map(({ x, y }) => `${x},${y}`).join(' ') : ''
);
</script>

<style scoped>
.sparkline-container {
  display: flex;
  align-items: center;
}

.sparkline {
  display: block;
}
</style>
