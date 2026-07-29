import test from "node:test";
import assert from "node:assert/strict";

import { createSampleWorkspace } from "../src/samples.js";
import { validateWorkspace, validateFlag } from "../src/validate.js";

const baseFlag = () => ({
  key: "demo-flag",
  name: "Demo",
  enabled: true,
  rollout: 50,
  rules: [{ id: "r1", when: { attribute: "plan", operator: "eq", value: "pro" }, value: true }],
});

test("the sample workspace is valid", () => {
  assert.deepEqual(validateWorkspace(createSampleWorkspace()), []);
});

test("flag keys are required, unique and URL-friendly", () => {
  const workspace = { flags: [{ ...baseFlag(), key: "Bad Key!" }, baseFlag(), baseFlag()] };
  const errors = validateWorkspace(workspace);
  assert.ok(errors.some((error) => /key must be lower-case/.test(error.message)));
  assert.ok(errors.some((error) => /duplicate flag key/.test(error.message)));
});

test("rollout and percentage must be between 0 and 100", () => {
  const flag = baseFlag();
  flag.rollout = 140;
  flag.rules[0].percentage = -5;
  const errors = validateFlag(flag);
  assert.deepEqual(errors.map((error) => error.path), ["flags[0].rollout", "flags[0].rules[0].percentage"]);
});

test("unknown operators are rejected instead of silently failing", () => {
  const flag = baseFlag();
  flag.rules[0].when.operator = "matches_regex";
  const errors = validateFlag(flag);
  assert.equal(errors[0].path, "flags[0].rules[0].when.operator");
  assert.match(errors[0].message, /unknown operator/);
});

test("duplicate rule ids are rejected", () => {
  const flag = baseFlag();
  flag.rules.push({ id: "r1", when: { attribute: "country", operator: "eq", value: "NP" }, value: false });
  const errors = validateFlag(flag);
  assert.match(errors[0].message, /duplicate rule id/);
});

test("segment references must exist", () => {
  const flag = baseFlag();
  flag.rules = [{ id: "r1", when: { segment: "beta" }, value: true }];
  const errors = validateFlag(flag);
  assert.match(errors[0].message, /unknown segment/);

  flag.segments = { beta: { all: [{ attribute: "plan", operator: "eq", value: "enterprise" }] } };
  assert.deepEqual(validateFlag(flag), []);
});

test("condition groups must be structurally sound", () => {
  const flag = baseFlag();
  flag.rules = [
    { id: "empty-any", when: { any: [] }, value: true },
    { id: "nothing", when: {}, value: true },
    { id: "not-object", when: "plan eq pro", value: true },
  ];
  const errors = validateFlag(flag);
  assert.equal(errors.length, 3);
  assert.ok(errors.some((error) => /must not be empty/.test(error.message)));
  assert.ok(errors.some((error) => /must use attribute/.test(error.message)));
});

test("schedule windows must parse and be ordered", () => {
  const flag = baseFlag();
  flag.schedule = { start: "2026-01-01T00:00:00Z", end: "2025-01-01T00:00:00Z" };
  const errors = validateFlag(flag);
  assert.match(errors[0].message, /start must be before end/);

  flag.schedule = { start: "not-a-date" };
  assert.match(validateFlag(flag)[0].message, /ISO date-time/);
});

test("workspaces must carry a flags array", () => {
  assert.equal(validateWorkspace(null)[0].path, "workspace");
  assert.equal(validateWorkspace({ flags: [] }).length, 0);
});
