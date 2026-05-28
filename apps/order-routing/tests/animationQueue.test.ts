import assert from "assert";
import { initAnimState, enqueueNew, LOG_CAP } from "../src/util/animationQueue";
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

console.log("animationQueue init/enqueue tests passed");
