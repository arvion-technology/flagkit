import test from "node:test";
import assert from "node:assert/strict";

import { murmur3, bucket, inRollout } from "../src/hash.js";

test("murmur3 matches the reference vectors", () => {
  assert.equal(murmur3(""), 0);
  assert.equal(murmur3("hello"), 613153351);
  assert.equal(murmur3("hello").toString(16), "248bfa47");
  assert.equal(murmur3("hello", 1), 3142237357);
});

test("hashing is deterministic and seed-sensitive", () => {
  assert.equal(murmur3("user_4821"), murmur3("user_4821"));
  assert.notEqual(murmur3("user_4821"), murmur3("user_4822"));
  assert.notEqual(murmur3("same", 0), murmur3("same", 7));
});

test("bucket stays inside the requested range and namespace matters", () => {
  for (let index = 0; index < 500; index++) {
    const value = bucket(`subject-${index}`, { namespace: "flag:a", buckets: 100 });
    assert.ok(Number.isInteger(value) && value >= 0 && value < 100, `${value}`);
  }
  const first = bucket("user_4821", { namespace: "flag:a" });
  const second = bucket("user_4821", { namespace: "flag:b" });
  assert.notEqual(first, second);
});

test("100 buckets distribute evenly enough for rollouts", () => {
  const counts = Array.from({ length: 10 }, () => 0);
  const total = 50_000;
  for (let index = 0; index < total; index++) {
    counts[bucket(`user_${index}`, { namespace: "flag:test", buckets: 10 })] += 1;
  }
  for (const count of counts) {
    const share = count / total;
    assert.ok(share > 0.08 && share < 0.12, `bucket share ${share}`);
  }
});

test("inRollout is stable for a subject and lands near the percentage", () => {
  assert.equal(inRollout("user_1", 0), false);
  assert.equal(inRollout("user_1", 100), true);
  assert.equal(inRollout("user_4821", 35, "flag:x"), inRollout("user_4821", 35, "flag:x"));

  let inside = 0;
  const total = 20_000;
  for (let index = 0; index < total; index++) {
    if (inRollout(`user_${index}`, 35, "flag:test")) inside += 1;
  }
  const share = inside / total;
  assert.ok(share > 0.32 && share < 0.38, `rollout share ${share}`);
});
