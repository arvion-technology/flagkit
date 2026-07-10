// Validation for flag workspaces.
//
// A flag with a typo in an operator silently evaluates to false, which looks
// exactly like a deliberate rollout. Configuration is therefore validated up
// front and the errors are returned together, the same style as a form.
import { OPERATORS } from "./evaluate.js";

const isObject = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const isPercentage = (value) => typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 100;

function validateWhen(when, path, errors, segments) {
  if (when === undefined || when === null) return;
  if (Array.isArray(when)) {
    when.forEach((entry, index) => validateWhen(entry, `${path}[${index}]`, errors, segments));
    return;
  }
  if (!isObject(when)) {
    errors.push({ path, message: "condition group must be an object" });
    return;
  }
  if (when.segment !== undefined) {
    if (typeof when.segment !== "string") errors.push({ path: `${path}.segment`, message: "segment name must be a string" });
    else if (segments && !segments[when.segment]) errors.push({ path: `${path}.segment`, message: `unknown segment "${when.segment}"` });
    return;
  }
  if (when.attribute !== undefined) {
    if (typeof when.attribute !== "string" || !when.attribute) errors.push({ path: `${path}.attribute`, message: "attribute must be a non-empty string" });
    if (!OPERATORS[when.operator]) errors.push({ path: `${path}.operator`, message: `unknown operator "${when.operator}"` });
    return;
  }
  if (when.not !== undefined) {
    validateWhen(when.not, `${path}.not`, errors, segments);
    return;
  }
  for (const logic of ["all", "any"]) {
    if (when[logic] !== undefined) {
      if (!Array.isArray(when[logic])) errors.push({ path: `${path}.${logic}`, message: `${logic} must be an array` });
      else if (!when[logic].length) errors.push({ path: `${path}.${logic}`, message: `${logic} must not be empty` });
      else when[logic].forEach((entry, index) => validateWhen(entry, `${path}.${logic}[${index}]`, errors, segments));
      return;
    }
  }
  errors.push({ path, message: "condition must use attribute, segment, all, any or not" });
}

export function validateFlag(flag, index = 0) {
  const errors = [];
  if (!isObject(flag)) return [{ path: `flags[${index}]`, message: "flag must be an object" }];
  if (typeof flag.key !== "string" || !/^[a-z0-9][a-z0-9._-]*$/.test(flag.key)) {
    errors.push({ path: `flags[${index}].key`, message: "key must be lower-case letters, digits, dot, dash or underscore" });
  }
  if (typeof flag.enabled !== "boolean") errors.push({ path: `flags[${index}].enabled`, message: "enabled must be a boolean" });
  if (flag.rollout !== undefined && !isPercentage(flag.rollout)) {
    errors.push({ path: `flags[${index}].rollout`, message: "rollout must be a number between 0 and 100" });
  }
  if (flag.schedule !== undefined && flag.schedule !== null) {
    const { start, end } = flag.schedule;
    for (const [field, value] of [["start", start], ["end", end]]) {
      if (value !== undefined && Number.isNaN(Date.parse(value))) {
        errors.push({ path: `flags[${index}].schedule.${field}`, message: "must be an ISO date-time" });
      }
    }
    if (start && end && Date.parse(start) >= Date.parse(end)) {
      errors.push({ path: `flags[${index}].schedule`, message: "start must be before end" });
    }
  }
  const segments = isObject(flag.segments) ? flag.segments : {};
  for (const [name, when] of Object.entries(segments)) {
    validateWhen(when, `flags[${index}].segments.${name}`, errors, null);
  }
  if (flag.rules !== undefined && !Array.isArray(flag.rules)) {
    errors.push({ path: `flags[${index}].rules`, message: "rules must be an array" });
  }
  const seenRules = new Set();
  (Array.isArray(flag.rules) ? flag.rules : []).forEach((rule, ruleIndex) => {
    const path = `flags[${index}].rules[${ruleIndex}]`;
    if (!isObject(rule)) {
      errors.push({ path, message: "rule must be an object" });
      return;
    }
    if (typeof rule.id !== "string" || !rule.id) errors.push({ path: `${path}.id`, message: "rule id is required" });
    else if (seenRules.has(rule.id)) errors.push({ path: `${path}.id`, message: `duplicate rule id "${rule.id}"` });
    else seenRules.add(rule.id);
    if (rule.percentage !== undefined && !isPercentage(rule.percentage)) {
      errors.push({ path: `${path}.percentage`, message: "percentage must be between 0 and 100" });
    }
    validateWhen(rule.when, `${path}.when`, errors, segments);
  });
  return errors;
}

export function validateWorkspace(workspace) {
  if (!isObject(workspace) || !Array.isArray(workspace.flags)) {
    return [{ path: "workspace", message: "workspace must have a flags array" }];
  }
  const errors = [];
  const keys = new Set();
  workspace.flags.forEach((flag, index) => {
    if (isObject(flag) && typeof flag.key === "string") {
      if (keys.has(flag.key)) errors.push({ path: `flags[${index}].key`, message: `duplicate flag key "${flag.key}"` });
      keys.add(flag.key);
    }
    errors.push(...validateFlag(flag, index));
  });
  return errors;
}
