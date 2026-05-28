// src/composables/useBatchAnimator.ts
// Bridges simulationStore.batchProgress[i].events into the animationQueue state machine
// and drives a TICK_MS-cadence tick loop (one phase per tick, two phases per order).
// One instance per mounted SimulationStage.
import { computed, onUnmounted, ref, watch, watchEffect } from "vue";
import { simulationStore } from "@/store/simulationStore";
import { initAnimState, enqueueNew, tick, TICK_MS } from "@/util/animationQueue";

export function useBatchAnimator(batchIndex: number) {
  const sim = simulationStore();
  const state = ref(initAnimState());

  // Pull any events present at mount, then any future updates. The events array reference
  // changes on each mergeEvents call in the store, so a shallow watch is sufficient.
  watch(
    () => sim.batchProgress[batchIndex]?.events ?? [],
    (events) => { state.value = enqueueNew(state.value, events); },
    { immediate: true }
  );

  // Run the tick driver while the batch is doing something (running or backlog to drain).
  // Stops cleanly once the run is over AND the queue has been drained to idle.
  let intervalId: ReturnType<typeof setInterval> | null = null;
  const shouldTick = computed(
    () => sim.isRunning || state.value.queue.length > 0 || state.value.current !== null
  );

  watchEffect(() => {
    if (shouldTick.value && intervalId === null) {
      intervalId = setInterval(() => { state.value = tick(state.value); }, TICK_MS);
    } else if (!shouldTick.value && intervalId !== null) {
      clearInterval(intervalId);
      intervalId = null;
    }
  });

  onUnmounted(() => { if (intervalId !== null) clearInterval(intervalId); });

  return {
    // While the run is in progress, an empty queue means "between bursts" — the backend is
    // still processing but we haven't received the next event yet. Promote `idle` to
    // `searching` so the character stays visibly alive instead of going dead between polls.
    // Once the run ends and the queue drains, we fall back to a true `idle`.
    pose: computed(() => {
      const p = state.value.pose;
      return p === "idle" && sim.isRunning ? "searching" : p;
    }),
    currentOrder: computed(() => state.value.current),
    stores: computed(() => state.value.stores),
    unfilled: computed(() => state.value.unfilled),
    log: computed(() => state.value.log),
  };
}
