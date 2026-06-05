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
    >
      <polyline :points="polylinePoints" />
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
  }
});

// Maps each value to viewBox coordinates: x spreads evenly across 0..100,
// y is normalized to the data range and inverted (SVG y grows downward),
// with a small vertical inset so the stroke isn't clipped at the edges.
const polylinePoints = computed(() => {
  const values = props.points;
  if (!values.length) return '';

  const max = Math.max(...values);
  const min = Math.min(...values);
  const range = max - min || 1;

  const inset = props.strokeWidth;
  const usableHeight = props.height - inset * 2;
  const lastIndex = values.length - 1 || 1;

  return values
    .map((value, i) => {
      const x = (i / lastIndex) * 100;
      const y = inset + (1 - (value - min) / range) * usableHeight;
      return `${x},${y}`;
    })
    .join(' ');
});
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
