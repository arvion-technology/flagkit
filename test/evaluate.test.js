import test from "node:test";
import assert from "node:assert/strict";

import { createSampleWorkspace, SAMPLE_ATTRIBUTES } from "../src/samples.js";
import { evaluateFlag, evaluateWhen, explain, subjectFor } from "../src/evaluate.js";

const NOW = Date.parse("2026-10-28T10:00:00Z");
const workspace = createSampleWorkspace({ now: NOW });
const flagByKey = (key) => workspace.flags.find((flag) => flag.key === key);

test("first matching rule wins even when a later rule would also match", () => {
  const flag = flagByKey("new-checkout");
  const result = evaluateFlag(flag, { ...SAMPLE_ATTRIBUTES, email: "nima@arviontech.net" });
  assert.equal(result.value, false);
  assert.equal(result.reason, "rule");
  assert.equal(result.ruleId, "staff-holdback");
  assert.equal(result.trace[0].matched, true);
});

test("a rule without a percentage serves its value directly", () => {
  const result = evaluateFlag(flagByKey("new-checkout"), SAMPLE_ATTRIBUTES);
  assert.equal(result.value, true);
  assert.equal(result.ruleId, "nepal-paid");
  assert.equal(result.ruleIndex, 1);
  assert.equal(result.trace.length, 2);
});

test("percentage rules use a stable bucket for the subject", () => {
  const flag = flagByKey("new-checkout");
  const context = { ...SAMPLE_ATTRIBUTES, email: "someone@example.com", country: "US" };
  const first = evaluateFlag(flag, context);
  const second = evaluateFlag(flag, context);
  assert.equal(first.ruleId, "paid-rollout");
  assert.equal(first.bucket, second.bucket);
  assert.equal(first.value, second.value);
  assert.ok(first.bucket >= 0 && first.bucket < 100);
  assert.ok(["rule-rollout", "rule-rollout-miss"].includes(first.reason));
});

test("a rollout miss serves the off value but still explains the match", () => {
  const flag = flagByKey("new-checkout");
  let result;
  for (let index = 0; index < 5000; index++) {
    const attempt = evaluateFlag(flag, { plan: "pro", country: "US", email: "a@b.co", userId: `user_${index}` });
    if (attempt.reason === "rule-rollout-miss") { result = attempt; break; }
  }
  assert.ok(result, "expected at least one subject outside the 35% bucket");
  assert.equal(result.value, false);
  assert.match(explain(result), /outside 35%/);
});

test("segments and any/all groups compose", () => {
  const result = evaluateFlag(flagByKey("search-v2"), { plan: "enterprise", country: "NP", device: "desktop" });
  assert.equal(result.value, "v2");
  assert.equal(result.ruleId, "beta-testers");

  const mobile = evaluateFlag(flagByKey("search-v2"), { plan: "free", country: "NP", device: "mobile" });
  assert.equal(mobile.value, "v2");
  assert.equal(mobile.ruleId, "mobile-nepal");

  const neither = evaluateFlag(flagByKey("search-v2"), { plan: "free", country: "US", device: "desktop" });
  assert.equal(neither.value, "control");
  assert.equal(neither.reason, "rollout-miss");
});

test("condition operators behave as documented", () => {
  const context = { plan: "pro", tags: ["beta", "internal"], ltv: 640, email: "nima@example.com" };
  const check = (when) => evaluateWhen(when, context).ok;
  assert.equal(check({ attribute: "plan", operator: "eq", value: "pro" }), true);
  assert.equal(check({ attribute: "plan", operator: "neq", value: "free" }), true);
  assert.equal(check({ attribute: "plan", operator: "in", value: ["pro", "enterprise"] }), true);
  assert.equal(check({ attribute: "plan", operator: "not_in", value: ["free"] }), true);
  assert.equal(check({ attribute: "tags", operator: "contains", value: "beta" }), true);
  assert.equal(check({ attribute: "email", operator: "ends_with", value: "@example.com" }), true);
  assert.equal(check({ attribute: "email", operator: "starts_with", value: "nima" }), true);
  assert.equal(check({ attribute: "ltv", operator: "gte", value: 500 }), true);
  assert.equal(check({ attribute: "ltv", operator: "lt", value: 500 }), false);
  assert.equal(check({ attribute: "missing", operator: "exists", value: true }), false);
  assert.equal(check({ any: [
    { attribute: "missing", operator: "eq", value: 1 },
    { attribute: "plan", operator: "eq", value: "pro" },
  ] }), true);
  assert.equal(check({ all: [
    { attribute: "plan", operator: "eq", value: "pro" },
    { attribute: "ltv", operator: "gt", value: 1000 },
  ] }), false);
  assert.equal(check({ not: { attribute: "plan", operator: "eq", value: "free" } }), true);
});

test("the schedule gates evaluation before and after the window", () => {
  const flag = flagByKey("weekly-digest");
  assert.equal(evaluateFlag(flag, {}, { now: NOW - 5 * 86_400_000 }).reason, "scheduled");
  assert.equal(evaluateFlag(flag, {}, { now: NOW }).reason, "rollout");
  assert.equal(evaluateFlag(flag, {}, { now: NOW + 20 * 86_400_000 }).reason, "expired");
});

test("a disabled flag is a kill switch, not a rule", () => {
  const result = evaluateFlag(flagByKey("legacy-banner"), SAMPLE_ATTRIBUTES);
  assert.equal(result.value, false);
  assert.equal(result.reason, "disabled");
});

test("unknown flags and missing rule sets fall back cleanly", () => {
  assert.equal(evaluateFlag(undefined).reason, "not_found");
  assert.equal(subjectFor({ userId: "u1", targetingKey: "t1" }), "t1");
  assert.equal(subjectFor({ id: "u2" }), "u2");
  assert.equal(subjectFor({}), "anonymous");

  const bare = { key: "bare", enabled: true, rules: [], rollout: null };
  const result = evaluateFlag(bare, {});
  assert.equal(result.reason, "default");
  assert.equal(result.value, false);
});

test("the trace marks each rule evaluated before the decision", () => {
  const result = evaluateFlag(flagByKey("search-v2"), { plan: "free", country: "US", device: "desktop" });
  assert.equal(result.trace.length, 2);
  assert.deepEqual(result.trace.map((entry) => entry.matched), [false, false]);
  assert.equal(result.trace[0].leaves.length, 2);
});

test("explain produces a sentence for every reason", () => {
  const reasons = [
    evaluateFlag(flagByKey("new-checkout"), SAMPLE_ATTRIBUTES),
    evaluateFlag(flagByKey("legacy-banner"), {}),
    evaluateFlag(undefined),
    evaluateFlag(flagByKey("search-v2"), { plan: "free", country: "US", device: "desktop" }),
  ];
  for (const result of reasons) {
    const text = explain(result);
    assert.ok(text.length > 10, result.reason);
    assert.equal(typeof text, "string");
  }
});
