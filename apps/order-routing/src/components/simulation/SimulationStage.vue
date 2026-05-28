<template>
  <div class="stage-wrapper">
    <!-- ASCII stage: bordered monospace box. aria-hidden because the log below is the SR source. -->
    <div class="stage" aria-hidden="true">
      <pre class="character" :data-pose="pose" :key="currentOrder?.seq ?? 'idle'">{{ glyphFor(pose) }}</pre>
      <p class="thought">
        <span v-if="currentOrder">…thinking order <strong>{{ currentOrder.orderId }}</strong></span>
        <span v-else class="dim">…waiting for orders</span>
      </p>
      <pre class="connector" :key="`c-${currentOrder?.seq ?? 'idle'}`">{{ connectorFor(currentOrder) }}</pre>

      <div class="tiles">
        <transition-group name="popin" tag="div" class="tiles-row">
          <div v-for="[fid, count] in storeEntries" :key="fid" class="tile">
            <div class="tile-name">[🏪 {{ fid }}]</div>
            <div class="tile-count" :key="`${fid}-${count}`">×{{ count }}</div>
          </div>
          <div v-if="unfilled > 0" key="__unfilled" class="tile tile-unfilled">
            <div class="tile-name">[📦 unfilled]</div>
            <div class="tile-count" :key="`unfilled-${unfilled}`">×{{ unfilled }}</div>
          </div>
        </transition-group>
      </div>
    </div>

    <!-- Log: SR-readable, newest first. -->
    <ul class="log" aria-live="polite">
      <li v-for="ev in log" :key="ev.seq" :class="logClassFor(ev)">
        &gt; {{ ev.orderId }} → {{ ev.facilityId ?? translate("unfilled") }}
        {{ glyphForReason(ev) }} {{ ev.finalReason }}
      </li>
      <li v-if="!log.length" class="dim">{{ translate("No orders yet.") }}</li>
    </ul>
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { translate } from "@common";
import { useBatchAnimator } from "@/composables/useBatchAnimator";
import type { OrderEvent } from "@/types/simulation";
import type { Pose } from "@/util/animationQueue";

const props = defineProps<{ batchIndex: number }>();

const { pose, currentOrder, stores, unfilled, log } = useBatchAnimator(props.batchIndex);

// Map → entries for stable rendering order (Map preserves insertion order).
const storeEntries = computed(() => Array.from(stores.value.entries()));

const IDLE_GLYPH = "  (•_•)  \n <(   )> \n  /   \\  ";
const ROUTING_GLYPH = "  (o_o)  \n <( ▸ )> \n  /   \\  ";
const SAD_GLYPH = "  (˘_˘)  \n <(   )> \n  /   \\  ";

function glyphFor(p: Pose): string {
  if (p === "routing") return ROUTING_GLYPH;
  if (p === "sad") return SAD_GLYPH;
  return IDLE_GLYPH;
}

function connectorFor(ev: OrderEvent | null): string {
  if (!ev) return "";
  if (ev.facilityId) return `   │\n   └──▶ [🏪 ${ev.facilityId}]`;
  return "   │\n   └──▶ [📦 unfilled]";
}

function logClassFor(ev: OrderEvent): string {
  if (ev.facilityId && (ev.finalReason === "FULLY_BROKERED" || ev.finalReason === "PARTIALLY_BROKERED")) return "ok";
  if (ev.finalReason === "QUEUED") return "muted";
  return "warn";
}

function glyphForReason(ev: OrderEvent): string {
  if (ev.facilityId && (ev.finalReason === "FULLY_BROKERED" || ev.finalReason === "PARTIALLY_BROKERED")) return "✓";
  if (ev.finalReason === "QUEUED") return "⊙";
  return "✗";
}
</script>

<style scoped>
.stage-wrapper { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 13px; }
.stage {
  border: 1px solid var(--ion-color-medium-shade);
  border-radius: 6px;
  padding: 10px 12px;
  background: var(--ion-color-light);
  margin-bottom: 8px;
}
.character {
  margin: 0;
  font-family: inherit;
  white-space: pre;
  line-height: 1.1;
  animation: think-then-pose 400ms ease-out;
}
@keyframes think-then-pose {
  0%   { opacity: 0.4; transform: translateY(-2px); }
  40%  { opacity: 1;   transform: translateY(0); }
  100% { opacity: 1;   transform: translateY(0); }
}
.thought { margin: 4px 0 6px; font-family: inherit; }
.thought .dim { color: var(--ion-color-medium); }
.connector {
  margin: 0 0 10px;
  font-family: inherit;
  white-space: pre;
  line-height: 1.1;
  min-height: 2.2em;
  animation: connector-draw 400ms ease-out;
}
@keyframes connector-draw {
  0%   { clip-path: inset(0 100% 0 0); }
  40%  { clip-path: inset(0 100% 0 0); }
  100% { clip-path: inset(0 0 0 0); }
}
.tiles-row { display: flex; gap: 10px; flex-wrap: wrap; }
.tile {
  border: 1px solid var(--ion-color-medium-tint);
  border-radius: 4px;
  padding: 6px 8px;
  background: var(--ion-background-color);
  min-width: 110px;
  text-align: center;
}
.tile-unfilled { border-color: var(--ion-color-warning); }
.tile-name { font-family: inherit; }
.tile-count { font-family: inherit; color: var(--ion-color-medium); animation: count-bump 250ms ease-out; }
@keyframes count-bump {
  0%   { transform: scale(1); }
  50%  { transform: scale(1.25); }
  100% { transform: scale(1); }
}
.popin-enter-active { animation: pop-in 250ms ease-out; }
@keyframes pop-in {
  0%   { opacity: 0; transform: scale(0.6); }
  100% { opacity: 1; transform: scale(1); }
}
.log {
  margin: 0;
  padding: 6px 8px;
  list-style: none;
  font-family: inherit;
  max-height: 240px;
  overflow-y: auto;
  border: 1px solid var(--ion-color-light-shade);
  border-radius: 4px;
}
.log li { padding: 2px 0; }
.dim  { color: var(--ion-color-medium); }
.ok   { color: var(--ion-color-success); }
.muted { color: var(--ion-color-medium); }
.warn { color: var(--ion-color-warning-shade); }
@media (prefers-reduced-motion: reduce) {
  .character, .connector, .tile-count, .popin-enter-active { animation: none !important; }
}
</style>
