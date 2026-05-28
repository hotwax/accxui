import assert from "assert";
import { initAnimState, enqueueNew, tick, LOG_CAP, paceFor } from "../src/util/animationQueue";
import { OrderEvent } from "../src/types/simulation";

const ev = (seq: number, facilityId: string | null = "STORE_42"): OrderEvent => ({
  seq,
  orderId: `O${seq}`,
  facilityId,
  finalReason: facilityId ? "FULLY_BROKERED" : "NO_RULE_MATCH",
});

// initAnimState: clean slate
{
  const s = initAnimState();
  assert.deepStrictEqual(s.queue, []);
  assert.strictEqual(s.current, null);
  assert.strictEqual(s.pose, "idle");
  assert.strictEqual(s.stores.size, 0);
  assert.strictEqual(s.unfilled, 0);
  assert.deepStrictEqual(s.log, []);
  assert.strictEqual(s.lastSeq, 0);
}

// enqueueNew: appends in order and advances lastSeq
{
  const s0 = initAnimState();
  const s1 = enqueueNew(s0, [ev(1), ev(2), ev(3)]);
  assert.deepStrictEqual(s1.queue.map((e) => e.seq), [1, 2, 3], "appends in seq order");
  assert.strictEqual(s1.lastSeq, 3, "lastSeq = max seq appended");
}

// enqueueNew: filters by lastSeq — no duplicates across calls
{
  const s0 = initAnimState();
  const s1 = enqueueNew(s0, [ev(1), ev(2)]);
  const s2 = enqueueNew(s1, [ev(2), ev(3)]); // server cursor would have prevented this, but defend anyway
  assert.deepStrictEqual(s2.queue.map((e) => e.seq), [1, 2, 3], "no duplicate seq=2");
  assert.strictEqual(s2.lastSeq, 3);
}

// enqueueNew: empty input is a no-op
{
  const s0 = enqueueNew(initAnimState(), [ev(1)]);
  const s1 = enqueueNew(s0, []);
  assert.strictEqual(s1, s0, "empty input returns the same state ref (no-op)");
}

// enqueueNew: out-of-order incoming gets sorted by seq
{
  const s = enqueueNew(initAnimState(), [ev(3), ev(1), ev(2)]);
  assert.deepStrictEqual(s.queue.map((e) => e.seq), [1, 2, 3], "sorted by seq");
  assert.strictEqual(s.lastSeq, 3);
}

// LOG_CAP is exported and is a positive integer
assert.ok(Number.isInteger(LOG_CAP) && LOG_CAP > 0, "LOG_CAP exported");

// paceFor: tiered adaptive cadence. Boundaries at 5/15/30; values monotonically decrease.
{
  assert.strictEqual(paceFor(0), 1000, "empty queue → calm");
  assert.strictEqual(paceFor(5), 1000, "5 → calm boundary");
  assert.strictEqual(paceFor(6), 600,  "6 → snappy");
  assert.strictEqual(paceFor(15), 600, "15 → snappy boundary");
  assert.strictEqual(paceFor(16), 300, "16 → quick");
  assert.strictEqual(paceFor(30), 300, "30 → quick boundary");
  assert.strictEqual(paceFor(31), 150, "31 → fast");
  assert.strictEqual(paceFor(500), 150, "huge backlog stays at fast");
}

// tick on empty queue: idles, returns equal state when already idle
{
  const s = initAnimState();
  const t = tick(s);
  assert.strictEqual(t, s, "already-idle returns the same state ref");
  assert.strictEqual(t.current, null);
  assert.strictEqual(t.pose, "idle");
  assert.strictEqual(t.queue.length, 0);
}

// tick two-phase brokered: tick 1 = thinking (no store bump, no log entry),
// tick 2 = routing (store bumps, log entry added). Iterated across multiple orders.
{
  let s = enqueueNew(initAnimState(), [ev(1, "STORE_42"), ev(2, "STORE_42"), ev(3, "WH_WEST")]);

  // Order 1, phase 1: thinking. No commit yet.
  s = tick(s);
  assert.strictEqual(s.current?.seq, 1);
  assert.strictEqual(s.pose, "thinking");
  assert.strictEqual(s.stores.size, 0, "no store bump during thinking");
  assert.strictEqual(s.unfilled, 0);
  assert.deepStrictEqual(s.log, [], "no log entry during thinking");

  // Order 1, phase 2: routing. Now commit.
  s = tick(s);
  assert.strictEqual(s.current?.seq, 1, "current stays during routing");
  assert.strictEqual(s.pose, "routing");
  assert.strictEqual(s.stores.get("STORE_42"), 1);
  assert.deepStrictEqual(s.log.map((e) => e.seq), [1]);

  // Order 2, phase 1: thinking again. Stores unchanged.
  s = tick(s);
  assert.strictEqual(s.current?.seq, 2);
  assert.strictEqual(s.pose, "thinking");
  assert.strictEqual(s.stores.get("STORE_42"), 1, "stores unchanged during thinking");

  // Order 2, phase 2: routing — repeat-facility count bumps, log is newest-first.
  s = tick(s);
  assert.strictEqual(s.pose, "routing");
  assert.strictEqual(s.stores.get("STORE_42"), 2, "repeat facility bumps count");
  assert.deepStrictEqual(s.log.map((e) => e.seq), [2, 1], "log is newest-first");

  // Order 3: thinking, then routing into a new facility.
  s = tick(s); // thinking 3
  assert.strictEqual(s.current?.seq, 3);
  assert.strictEqual(s.pose, "thinking");
  s = tick(s); // routing 3
  assert.strictEqual(s.pose, "routing");
  assert.strictEqual(s.stores.get("WH_WEST"), 1, "new facility appears");
  assert.strictEqual(s.stores.size, 2);
}

// tick two-phase UNFILLABLE_PARKING via finalReason: the rule said unfillable.
{
  const unfillable: OrderEvent = {
    seq: 1, orderId: "O1", facilityId: "STORE_42", finalReason: "UNFILLABLE_PARKING",
  };
  let s = enqueueNew(initAnimState(), [unfillable]);
  s = tick(s); // thinking
  assert.strictEqual(s.pose, "thinking");
  s = tick(s);
  assert.strictEqual(s.pose, "sad", "finalReason=UNFILLABLE_PARKING → sad");
  assert.strictEqual(s.stores.size, 0, "no real-store tile");
  assert.strictEqual(s.unfilled, 1);
}

// tick two-phase UNFILLABLE_PARKING via facilityId: routed to the give-up bin facility
// (finalReason can be FULLY_BROKERED here because routing into parking "succeeded").
{
  const parked: OrderEvent = {
    seq: 1, orderId: "O1", facilityId: "UNFILLABLE_PARKING", finalReason: "FULLY_BROKERED",
  };
  let s = enqueueNew(initAnimState(), [parked]);
  s = tick(s); // thinking
  s = tick(s);
  assert.strictEqual(s.pose, "sad", "facilityId=UNFILLABLE_PARKING → sad regardless of finalReason");
  assert.strictEqual(s.stores.size, 0, "no UNFILLABLE_PARKING storefront tile");
  assert.strictEqual(s.unfilled, 1, "unfilled bucket bumps");
}

// tick two-phase null-facility: tick 1 = thinking, tick 2 = sad + unfilled bumps.
{
  let s = enqueueNew(initAnimState(), [ev(1, null), ev(2, null)]);

  s = tick(s); // thinking 1
  assert.strictEqual(s.pose, "thinking");
  assert.strictEqual(s.unfilled, 0, "no unfilled bump during thinking");

  s = tick(s); // sad 1
  assert.strictEqual(s.pose, "sad");
  assert.strictEqual(s.unfilled, 1);
  assert.strictEqual(s.stores.size, 0);

  s = tick(s); // thinking 2
  assert.strictEqual(s.pose, "thinking");
  assert.strictEqual(s.unfilled, 1, "unfilled unchanged during thinking");

  s = tick(s); // sad 2
  assert.strictEqual(s.pose, "sad");
  assert.strictEqual(s.unfilled, 2);
}

// tick after queue empties: thinking → routing → idle (three ticks for one order).
{
  let s = enqueueNew(initAnimState(), [ev(1, "STORE_42")]);
  s = tick(s); // thinking
  assert.strictEqual(s.pose, "thinking");
  assert.strictEqual(s.current?.seq, 1);
  s = tick(s); // routing
  assert.strictEqual(s.pose, "routing");
  assert.strictEqual(s.current?.seq, 1);
  s = tick(s); // queue empty → idle
  assert.strictEqual(s.current, null);
  assert.strictEqual(s.pose, "idle");
  assert.strictEqual(s.stores.get("STORE_42"), 1, "stores persist across idle");
}

// log caps at LOG_CAP, keeping newest. With two-phase ticks, each order takes 2 ticks.
{
  const seqs = Array.from({ length: LOG_CAP + 5 }, (_, i) => i + 1);
  let s = enqueueNew(initAnimState(), seqs.map((n) => ev(n, "STORE_42")));
  // 2 ticks per order to fully commit; one extra tick at the end to settle to idle.
  for (let i = 0; i < seqs.length * 2; i++) s = tick(s);
  assert.strictEqual(s.log.length, LOG_CAP, "log capped at LOG_CAP");
  assert.strictEqual(s.log[0].seq, seqs[seqs.length - 1], "newest first");
  assert.strictEqual(s.log[s.log.length - 1].seq, seqs[seqs.length - LOG_CAP], "oldest kept is LOG_CAP-back");
}

console.log("animationQueue tests passed");
