// Flag definitions, condition evaluation and scheduling.
//
// The evaluator is deliberately deterministic and side-effect free: given a
// flag, a context and a clock it returns the same decision plus a trace that
// explains it. The trace is what the demo highlights; it is also what makes a
// "why did this user see the old checkout?" question answerable.

import { bucket } from "./hash.js";

export const OPERATORS = Object.freeze({
  eq: (actual, expected) => String(actual) === String(expected),
  neq: (actual, expected) => actual !== undefined && String(actual) !== String(expected),
  in: (actual, expected) => Array.isArray(expected) && expected.map(String).includes(String(actual)),
  not_in: (actual, expected) => actual !== undefined && (!Array.isArray(expected) || !expected.map(String).includes(String(actual))),
  contains: (actual, expected) => (Array.isArray(actual)
    ? actual.map(String).includes(String(expected))
    : actual !== undefined && String(actual).includes(String(expected))),
  starts_with: (actual, expected) => actual !== undefined && String(actual).startsWith(String(expected)),
  ends_with: (actual, expected) => actual !== undefined && String(actual).endsWith(String(expected)),
  gt: (actual, expected) => actual !== undefined && Number(actual) > Number(expected),
  gte: (actual, expected) => actual !== undefined && Number(actual) >= Number(expected),
  lt: (actual, expected) => actual !== undefined && Number(actual) < Number(expected),
  lte: (actual, expected) => actual !== undefined && Number(actual) <= Number(expected),
  exists: (actual, expected) => (actual !== undefined && actual !== null) === (expected !== false),
});

export const OPERATOR_NAMES = Object.keys(OPERATORS);

const scheduleState = (schedule, now) => {
  if (!schedule) return { active: true, state: "none" };
  const start = schedule.start ? Date.parse(schedule.start) : null;
  const end = schedule.end ? Date.parse(schedule.end) : null;
  if (start !== null && now < start) return { active: false, state: "before", start, end };
  if (end !== null && now >= end) return { active: false, state: "after", start, end };
  return { active: true, state: "active", start, end };
};

function describeCondition(condition) {
  if (condition.segment) return `segment "${condition.segment}"`;
  const expected = Array.isArray(condition.value)
    ? `[${condition.value.map((entry) => JSON.stringify(entry)).join(", ")}]`
    : JSON.stringify(condition.value);
  return `${condition.attribute} ${condition.operator.replace(/_/g, " ")} ${expected}`;
}

function conditionResult(condition, context, segments) {
  if (condition.segment) {
    const segment = segments?.[condition.segment];
    if (!segment) return { ok: false, label: `segment "${condition.segment}"`, actual: "(undefined segment)" };
    const result = evaluateWhen(segment, context, segments);
    return { ok: result.ok, label: `segment "${condition.segment}"`, actual: result.ok ? "matched" : "not matched" };
  }
  const actual = context[condition.attribute];
  const operator = OPERATORS[condition.operator];
  return {
    ok: operator ? operator(actual, condition.value) : false,
    label: describeCondition(condition),
    actual: actual === undefined ? "(missing)" : Array.isArray(actual) ? `[${actual.join(", ")}]` : String(actual),
  };
}

/**
 * Evaluate a condition group: `{all: [...]}`, `{any: [...]}`, `{not: ...}`,
 * a bare condition, or an array (treated as `all`).
 */
export function evaluateWhen(when, context = {}, segments = {}) {
  if (!when) return { ok: true, leaves: [] };
  if (Array.isArray(when)) when = { all: when };
  if (when.segment || when.attribute) {
    const leaf = conditionResult(when, context, segments);
    return { ok: leaf.ok, leaves: [leaf] };
  }
  if (when.not) {
    const inner = evaluateWhen(when.not, context, segments);
    return { ok: !inner.ok, leaves: inner.leaves };
  }
  if (when.any) {
    const parts = when.any.map((part) => evaluateWhen(part, context, segments));
    return { ok: parts.some((part) => part.ok), leaves: parts.flatMap((part) => part.leaves) };
  }
  if (when.all) {
    const parts = when.all.map((part) => evaluateWhen(part, context, segments));
    return { ok: parts.every((part) => part.ok), leaves: parts.flatMap((part) => part.leaves) };
  }
  return { ok: false, leaves: [] };
}

/** Subject key used for bucketing; explicit targetingKey wins. */
export function subjectFor(context = {}) {
  return context.targetingKey || context.userId || context.id || context.anonymousId || "anonymous";
}

/**
 * Evaluate one flag.
 * @returns evaluation with `value`, `reason`, `ruleId`, `bucket`, `trace`
 */
export function evaluateFlag(flag, context = {}, { now = Date.now() } = {}) {
  const subject = subjectFor(context);
  if (!flag) {
    return {
      flagKey: undefined,
      value: false,
      subject,
      reason: "not_found",
      ruleId: null,
      ruleIndex: null,
      bucket: null,
      schedule: null,
      trace: [],
    };
  }
  const offValue = flag.offValue ?? false;
  const onValue = flag.onValue ?? true;
  const result = {
    flagKey: flag.key,
    value: offValue,
    subject,
    reason: "default",
    ruleId: null,
    ruleIndex: null,
    bucket: null,
    schedule: null,
    trace: [],
  };

  const schedule = scheduleState(flag.schedule, now);
  result.schedule = schedule;
  if (!schedule.active) {
    return { ...result, reason: schedule.state === "before" ? "scheduled" : "expired" };
  }
  if (flag.enabled === false) return { ...result, reason: "disabled" };

  const segments = flag.segments || {};
  const namespace = `flag:${flag.key}`;
  const rules = Array.isArray(flag.rules) ? flag.rules : [];

  for (const [index, rule] of rules.entries()) {
    const matched = evaluateWhen(rule.when, context, segments);
    const rolloutBucket = rule.percentage !== undefined
      ? bucket(subject, { namespace: `${namespace}:${rule.salt || rule.id}`, buckets: 100 })
      : null;
    result.trace.push({
      ruleId: rule.id,
      index,
      description: rule.description || "",
      matched: matched.ok,
      percentage: rule.percentage ?? null,
      bucket: rolloutBucket,
      leaves: matched.leaves,
    });
    if (!matched.ok) continue;

    if (rule.percentage !== undefined) {
      const hit = rolloutBucket < rule.percentage;
      return {
        ...result,
        value: hit ? (rule.value ?? onValue) : (rule.offValue ?? offValue),
        reason: hit ? "rule-rollout" : "rule-rollout-miss",
        ruleId: rule.id,
        ruleIndex: index,
        bucket: rolloutBucket,
      };
    }
    return {
      ...result,
      value: rule.value ?? onValue,
      reason: "rule",
      ruleId: rule.id,
      ruleIndex: index,
    };
  }

  if (flag.rollout !== undefined && flag.rollout !== null) {
    const rolloutBucket = bucket(subject, { namespace, buckets: 100 });
    const hit = rolloutBucket < flag.rollout;
    return {
      ...result,
      value: hit ? onValue : offValue,
      reason: hit ? "rollout" : "rollout-miss",
      bucket: rolloutBucket,
    };
  }

  return result;
}

/** Human-readable why, used in the demo and handy in logs. */
export function explain(result) {
  switch (result.reason) {
    case "rule": return `matched rule "${result.ruleId}"`;
    case "rule-rollout": return `matched rule "${result.ruleId}", subject landed in bucket ${result.bucket} (< ${result.trace.find((entry) => entry.ruleId === result.ruleId)?.percentage}%)`;
    case "rule-rollout-miss": return `matched rule "${result.ruleId}", but bucket ${result.bucket} is outside ${result.trace.find((entry) => entry.ruleId === result.ruleId)?.percentage}%`;
    case "rollout": return `no rule matched; bucket ${result.bucket} is inside the flag rollout`;
    case "rollout-miss": return `no rule matched; bucket ${result.bucket} is outside the flag rollout`;
    case "disabled": return "the flag is switched off";
    case "scheduled": return "the schedule has not started";
    case "expired": return "the schedule has ended";
    case "not_found": return "no flag with that key exists";
    default: return "no rule matched and there is no rollout";
  }
}
