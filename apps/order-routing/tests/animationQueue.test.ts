import assert from "assert";
import { initAnimState, enqueueNew, tick, LOG_CAP } from "../src/util/animationQueue";
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

// tick on empty queue: idles, returns equal state when already idle
{
  const s = initAnimState();
  const t = tick(s);
  assert.strictEqual(t, s, "already-idle returns the same state ref");
  assert.strictEqual(t.current, null);
  assert.strictEqual(t.pose, "idle");
  assert.strictEqual(t.queue.length, 0);
}

// tick with brokered order: pose=routing, store count bumps, log gets newest-first entry
{
  let s = enqueueNew(initAnimState(), [ev(1, "STORE_42"), ev(2, "STORE_42"), ev(3, "WH_WEST")]);
  s = tick(s);
  assert.strictEqual(s.current?.seq, 1);
  assert.strictEqual(s.pose, "routing");
  assert.strictEqual(s.stores.get("STORE_42"), 1);
  assert.strictEqual(s.unfilled, 0);
  assert.deepStrictEqual(s.log.map((e) => e.seq), [1]);

  s = tick(s);
  assert.strictEqual(s.current?.seq, 2);
  assert.strictEqual(s.stores.get("STORE_42"), 2, "repeat facility bumps count");
  assert.deepStrictEqual(s.log.map((e) => e.seq), [2, 1], "log is newest-first");

  s = tick(s);
  assert.strictEqual(s.current?.seq, 3);
  assert.strictEqual(s.stores.get("WH_WEST"), 1, "new facility appears");
  assert.strictEqual(s.stores.size, 2);
}

// tick with null-facility order: pose=sad, unfilled bumps
{
  let s = enqueueNew(initAnimState(), [ev(1, null), ev(2, null)]);
  s = tick(s);
  assert.strictEqual(s.pose, "sad");
  assert.strictEqual(s.unfilled, 1);
  assert.strictEqual(s.stores.size, 0);
  s = tick(s);
  assert.strictEqual(s.unfilled, 2);
}

// tick after queue empties: pose returns to idle, current becomes null
{
  let s = enqueueNew(initAnimState(), [ev(1, "STORE_42")]);
  s = tick(s); // process the single event
  assert.strictEqual(s.pose, "routing");
  assert.strictEqual(s.current?.seq, 1);
  s = tick(s); // queue empty now
  assert.strictEqual(s.current, null);
  assert.strictEqual(s.pose, "idle");
  assert.strictEqual(s.stores.get("STORE_42"), 1, "stores persist across idle");
}

// log caps at LOG_CAP, keeping newest
{
  const seqs = Array.from({ length: LOG_CAP + 5 }, (_, i) => i + 1);
  let s = enqueueNew(initAnimState(), seqs.map((n) => ev(n, "STORE_42")));
  for (const _ of seqs) s = tick(s);
  assert.strictEqual(s.log.length, LOG_CAP, "log capped at LOG_CAP");
  assert.strictEqual(s.log[0].seq, seqs[seqs.length - 1], "newest first");
  assert.strictEqual(s.log[s.log.length - 1].seq, seqs[seqs.length - LOG_CAP], "oldest kept is LOG_CAP-back");
}

console.log("animationQueue tests passed");
