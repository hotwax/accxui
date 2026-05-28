// src/composables/useBatchAnimator.ts
// Bridges simulationStore.batchProgress[i].events into the animationQueue state machine
// and drives a ~400ms tick loop. One instance per mounted SimulationStage.
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
    pose: computed(() => state.value.pose),
    currentOrder: computed(() => state.value.current),
    stores: computed(() => state.value.stores),
    unfilled: computed(() => state.value.unfilled),
    log: computed(() => state.value.log),
  };
}
