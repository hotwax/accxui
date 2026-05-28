// src/util/animationQueue.ts
// Pure state-machine helper for the per-batch routing animation. No Vue / no DOM imports
// so this module is safe to import from tests run with `npx tsx`. Mirrors the shape of
// progressBuffer.ts (a pure peer in the same simulation pipeline).
import type { OrderEvent } from "../types/simulation";

export type Pose = "idle" | "routing" | "sad";

export interface AnimState {
  queue: OrderEvent[];              // FIFO, enqueued from batchProgress.events
  current: OrderEvent | null;       // the event being animated this tick
  pose: Pose;
  stores: Map<string, number>;      // facilityId → lifetime count for this batch
  unfilled: number;                 // lifetime null-facility count for this batch
  log: OrderEvent[];                // rolling last LOG_CAP, newest-first
  lastSeq: number;                  // dedup cursor against batchProgress.events
}

/** How many recent events to keep in the on-stage scrolling log. */
export const LOG_CAP = 20;

/** Animator tick cadence in ms (one order per tick). */
export const TICK_MS = 400;

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

/** Dequeue one order and update derived state. Returns a new state object so Vue refs detect
 *  the change. On empty queue, settles to idle (returns the same ref if already idle to avoid
 *  spurious reactive cycles). */
export function tick(state: AnimState): AnimState {
  if (state.queue.length === 0) {
    if (state.current === null && state.pose === "idle") return state;
    return { ...state, current: null, pose: "idle" };
  }
  const [head, ...rest] = state.queue;
  const stores = new Map(state.stores);
  let unfilled = state.unfilled;
  let pose: Pose;
  if (head.facilityId) {
    stores.set(head.facilityId, (stores.get(head.facilityId) ?? 0) + 1);
    pose = "routing";
  } else {
    unfilled += 1;
    pose = "sad";
  }
  const log = [head, ...state.log].slice(0, LOG_CAP);
  return { ...state, queue: rest, current: head, pose, stores, unfilled, log };
}
