// src/util/animationQueue.ts
// Pure state-machine helper for the per-batch routing animation. No Vue / no DOM imports
// so this module is safe to import from tests run with `npx tsx`. Mirrors the shape of
// progressBuffer.ts (a pure peer in the same simulation pipeline).
import type { OrderEvent } from "../types/simulation";

export type Pose = "idle" | "searching" | "thinking" | "routing" | "sad";

export interface AnimState {
  queue: OrderEvent[];              // FIFO, enqueued from batchProgress.events
  current: OrderEvent | null;       // the event being animated this tick (thinking or routing/sad)
  pose: Pose;
  stores: Map<string, number>;      // facilityId → lifetime count for this batch
  unfilled: number;                 // lifetime null-facility count for this batch
  log: OrderEvent[];                // rolling last LOG_CAP, newest-first
  lastSeq: number;                  // dedup cursor against batchProgress.events
}

/** How many recent events to keep in the on-stage scrolling log. */
export const LOG_CAP = 20;

/** Animator tick cadence in ms (one PHASE per tick — each order takes two phases:
 *  thinking → routing/sad — so total per-order time is 2 × TICK_MS).
 *  Tuned for a calm, "live" feel rather than to keep up with polling bursts (the
 *  user explicitly chose steady pace over fast-forward; counters above the stage
 *  are authoritative for real progress). */
export const TICK_MS = 1000;

export function initAnimState(): AnimState {
  return {
    queue: [],
    current: null,
    pose: "idle",
    stores: new Map(),
    unfilled: 0,
    log: [],
    lastSeq: 0,
  };
}

/** Append fresh events (`seq > state.lastSeq`) to the queue in seq order. Returns a new state
 *  object so Vue ref-style reactivity triggers; returns the same ref for empty/no-op inputs. */
export function enqueueNew(state: AnimState, events: OrderEvent[]): AnimState {
  if (!events || events.length === 0) return state;
  const fresh = events.filter((e) => e.seq > state.lastSeq);
  if (fresh.length === 0) return state;
  fresh.sort((a, b) => a.seq - b.seq);
  return {
    ...state,
    queue: [...state.queue, ...fresh],
    lastSeq: fresh[fresh.length - 1].seq,
  };
}

/** Advance the animator by one phase. Each order takes TWO ticks:
 *   1. THINKING — dequeue head, set `current = head`, `pose = "thinking"`; stores / log unchanged.
 *   2. ROUTING or SAD — keep `current`, bump store count (or `unfilled`), append to log,
 *      set `pose = "routing"` (or `"sad"`).
 *  On a third tick with an empty queue, settles to idle (`current = null`, `pose = "idle"`).
 *  Returns a new state object so Vue refs detect the change; returns the same ref when
 *  already idle to avoid spurious reactive cycles. */
export function tick(state: AnimState): AnimState {
  // Phase 2 — previous tick set `thinking`; now commit the decision.
  if (state.pose === "thinking" && state.current !== null) {
    const head = state.current;
    const stores = new Map(state.stores);
    let unfilled = state.unfilled;
    let pose: Pose;
    // UNFILLABLE_PARKING shows up two ways in the feed:
    //   (a) finalReason === "UNFILLABLE_PARKING" — the rule decided it was unfillable.
    //   (b) facilityId === "UNFILLABLE_PARKING"  — the order was "routed" to the parking
    //       facility (the give-up bin). The backend will often report finalReason as
    //       FULLY_BROKERED for these because routing succeeded into the parking facility,
    //       but for the user it's still a failure outcome.
    // Either signal → unfilled bucket + sad pose; no storefront tile for the parking facility.
    const unfillable =
      head.finalReason === "UNFILLABLE_PARKING" || head.facilityId === "UNFILLABLE_PARKING";
    if (head.facilityId && !unfillable) {
      stores.set(head.facilityId, (stores.get(head.facilityId) ?? 0) + 1);
      pose = "routing";
    } else {
      unfilled += 1;
      pose = "sad";
    }
    const log = [head, ...state.log].slice(0, LOG_CAP);
    return { ...state, pose, stores, unfilled, log };
  }

  // Otherwise: dequeue next order into thinking, or settle to idle if empty.
  if (state.queue.length === 0) {
    if (state.current === null && state.pose === "idle") return state;
    return { ...state, current: null, pose: "idle" };
  }
  const [head, ...rest] = state.queue;
  return { ...state, queue: rest, current: head, pose: "thinking" };
}
