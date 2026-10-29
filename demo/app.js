// FlagKit demo application.
//
// createClient, evaluateFlag and the hash come from ../src. The demo only
// collects attributes, evaluates the selected flag and renders the trace.
import { createClient } from "../src/sdk.js";
import { createSampleWorkspace, SAMPLE_ATTRIBUTES } from "../src/samples.js";
import { explain, subjectFor } from "../src/evaluate.js";
import { bucket } from "../src/hash.js";

const { el, $, toast } = A;

const NOW = Date.now();
const state = {
  workspace: createSampleWorkspace({ now: NOW }),
  client: null,
  flagKey: "new-checkout",
  attributes: { ...SAMPLE_ATTRIBUTES },
  evaluations: 0,
};

const REASON_LABEL = {
  rule: "matched rule",
  "rule-rollout": "rule + rollout",
  "rule-rollout-miss": "matched, rolled out",
  rollout: "fallback rollout",
  "rollout-miss": "fallback miss",
  disabled: "kill switch",
  scheduled: "not started",
  expired: "schedule ended",
  default: "default value",
  not_found: "flag missing",
};

/* ------------------------------------------------------------------ views */

function renderFlagList() {
  const flags = state.client.getFlags();
  $("#flag-count").textContent = `${flags.length} flags`;
  $("#flag-list").replaceChildren(...flags.map((flag) => {
    const item = el("div", {
      class: "flag-item" + (flag.key === state.flagKey ? " active" : ""),
      role: "button",
      tabindex: "0",
      "aria-pressed": String(flag.key === state.flagKey),
      onclick: () => selectFlag(flag.key),
      onkeydown: (event) => { if (event.key === "Enter" || event.key === " ") selectFlag(flag.key); },
    },
    el("span", { class: "flag-state" + (flag.enabled ? " on" : "") }),
    el("span", {},
      el("span", { class: "flag-name", text: flag.name }),
      el("span", { class: "flag-key mono", text: flag.key })),
    el("span", { class: "flag-meta", text: `${flag.rules?.length || 0} rules` }));
    const toggle = el("span", {
      class: "switch",
      role: "switch",
      "aria-checked": String(flag.enabled),
      title: flag.enabled ? "Disable flag" : "Enable flag",
      onclick: (event) => {
        event.stopPropagation();
        toggleFlag(flag.key);
      },
    });
    // Replace the metadata column with the switch; keep the rule count in the
    // title so the switch has room without widening the card.
    item.replaceChild(toggle, item.lastElementChild);
    item.title = `${flag.rules?.length || 0} targeting rules`;
    return item;
  }));
}

function renderContextForm() {
  $("#attr-userId").value = state.attributes.userId;
  $("#attr-email").value = state.attributes.email;
  $("#attr-plan").value = state.attributes.plan;
  $("#attr-country").value = state.attributes.country;
  $("#attr-device").value = state.attributes.device;
  $("#attr-ltv").value = state.attributes.ltv;
  $("#subject").textContent = subjectFor(state.attributes);
}

function traceLeaf(leaf) {
  return el("div", { class: "trace-cond" + (leaf.ok ? "" : " no") },
    el("span", { class: "mark", text: leaf.ok ? "✓" : "✗" }),
    el("span", { class: "mono", text: leaf.label }),
    el("span", { class: "actual", text: leaf.actual }));
}

function traceRow({ index, id, description, matched, percentage, leaves, fallback }) {
  const row = el("div", { class: "trace-row " + (matched ? "matched" : "skipped") + (fallback ? " fallback" : "") },
    el("div", { class: "trace-head" },
      index !== undefined ? el("span", { class: "trace-index", text: String(index + 1) }) : null,
      el("span", { class: "trace-id", text: id }),
      el("span", { class: "spacer" }),
      percentage !== null && percentage !== undefined ? el("span", { class: "badge gold", text: `${percentage}%` }) : null,
      el("span", { class: "badge " + (matched ? "green" : ""), text: matched ? "matched" : "skipped" })));
  if (description) row.append(el("div", { class: "trace-desc", text: description }));
  for (const leaf of leaves || []) row.append(traceLeaf(leaf));
  return row;
}

function renderEvaluation() {
  state.evaluations += 1;
  $("#eval-counter").textContent = `${state.evaluations} evaluation${state.evaluations === 1 ? "" : "s"}`;

  const flag = state.client.getFlag(state.flagKey);
  if (!flag) return;
  const result = state.client.evaluate(state.flagKey, state.attributes);
  const subject = subjectFor(state.attributes);
  const bucketValue = bucket(subject, { namespace: `flag:${flag.key}`, buckets: 100 });

  $("#eval-name").textContent = flag.name;
  $("#eval-key").textContent = flag.key;

  const value = $("#eval-value");
  value.className = "eval-value " + (typeof result.value === "boolean" ? (result.value ? "on" : "off") : "variant");
  value.textContent = typeof result.value === "string" ? `"${result.value}"` : result.value ? "ON" : "OFF";

  $("#eval-why").textContent = explain(result);
  $("#eval-reason").textContent = REASON_LABEL[result.reason] || result.reason;
  $("#eval-reason").className = "badge " + (result.reason.startsWith("rule") || result.reason === "rollout" ? "green" : result.reason === "disabled" ? "red" : "");

  const ruleBadge = $("#eval-rule");
  ruleBadge.textContent = result.ruleId || "no rule matched";
  ruleBadge.className = "badge " + (result.ruleId ? "gold" : "");

  const scheduleBadge = $("#eval-schedule");
  const schedule = result.schedule;
  if (schedule && schedule.state !== "none") {
    scheduleBadge.hidden = false;
    scheduleBadge.textContent = `schedule ${schedule.state}`;
    scheduleBadge.className = "badge " + (schedule.state === "active" ? "green" : "red");
  } else {
    scheduleBadge.hidden = true;
  }

  $("#bucket-fill").style.width = `${bucketValue}%`;
  $("#bucket-value").textContent = `${bucketValue}/100`;
  $("#subject").textContent = subject;

  renderBucketStrip(flag, bucketValue);

  const rollout = flag.rollout ?? 0;
  $("#rollout").value = String(rollout);
  $("#rollout-value").textContent = `${rollout}%`;

  renderTrace(flag, result);
}

function renderBucketStrip(flag, currentBucket) {
  const rollout = flag.rollout ?? 0;
  $("#buckets-rollout").textContent = `${rollout}% rollout`;
  const blocks = 20;
  const cells = Array.from({ length: blocks }, (_, index) => {
    const start = index * (100 / blocks);
    const className = "bucket-strip-cell";
    const inside = start < rollout;
    const current = currentBucket >= start && currentBucket < start + 100 / blocks;
    return el("i", {
      class: (inside ? "on" : "") + (current ? " current" : ""),
      title: `buckets ${start}, ${start + 100 / blocks - 1}`,
    });
  });
  $("#bucket-strip").replaceChildren(...cells);
  $("#bucket-caption").textContent = `${currentBucket < rollout ? "Inside" : "Outside"} the ${rollout}% rollout, this subject hashes to bucket ${currentBucket}.`;
}

function renderTrace(flag, result) {
  const rows = [];

  if (flag.schedule) {
    const schedule = result.schedule;
    const detail = schedule.active
      ? `active now (${A.fmt.date(schedule.start)} → ${A.fmt.date(schedule.end)})`
      : schedule.state === "before" ? "starts in the future" : "window has ended";
    rows.push(el("div", { class: "trace-row fallback" },
      el("div", { class: "trace-head" },
        el("span", { class: "trace-id", text: "schedule" }),
        el("span", { class: "spacer" }),
        el("span", { class: "badge " + (schedule.active ? "green" : "red"), text: schedule.state })),
      el("div", { class: "trace-desc", text: detail })));
  }

  if (flag.enabled === false) {
    rows.push(el("div", { class: "trace-row matched" },
      el("div", { class: "trace-head" },
        el("span", { class: "trace-id", text: "kill switch" }),
        el("span", { class: "spacer" }),
        el("span", { class: "badge red", text: "flag disabled" })),
      el("div", { class: "trace-desc", text: "Evaluation stops here and the off value is served." })));
  }

  const matchedRuleId = result.reason.startsWith("rule") || result.reason === "rule-rollout-miss" ? result.ruleId : null;
  for (const entry of result.trace) {
    rows.push(traceRow({
      index: entry.index,
      id: entry.ruleId,
      description: entry.description,
      matched: entry.ruleId === matchedRuleId,
      percentage: entry.percentage,
      leaves: entry.leaves,
    }));
  }

  if (!flag.rules?.length) {
    rows.push(el("div", { class: "trace-empty", text: "This flag has no targeting rules." }));
  }

  const ruleChosen = result.reason.startsWith("rule");
  const fallbackActive = ["rollout", "rollout-miss", "default"].includes(result.reason) && flag.enabled !== false;
  if (ruleChosen) {
    rows.push(el("div", { class: "trace-row fallback skipped" },
      el("div", { class: "trace-head" },
        el("span", { class: "trace-id", text: `fallback · rollout ${flag.rollout ?? 0}%` }),
        el("span", { class: "spacer" }),
        el("span", { class: "badge", text: "not reached" })),
      el("div", { class: "trace-desc", text: "Never evaluated: a rule above returned a value first." })));
  } else {
    rows.push(traceRow({
      id: `fallback · rollout ${flag.rollout ?? 0}%`,
      description: "Applied when no targeting rule matches.",
      matched: flag.enabled !== false,
      percentage: null,
      leaves: [{ ok: fallbackActive, label: `bucket ${bucket(subjectFor(state.attributes), { namespace: `flag:${flag.key}` })} < ${flag.rollout ?? 0}`, actual: fallbackActive ? "inside rollout" : "outside rollout" }],
      fallback: true,
    }));
  }

  $("#trace").replaceChildren(...rows);
}

/* --------------------------------------------------------------- actions */

function selectFlag(key) {
  state.flagKey = key;
  renderFlagList();
  renderEvaluation();
  history.replaceState(null, "", `#${key}`);
}

function toggleFlag(key) {
  const flag = state.client.getFlag(key);
  if (!flag) return;
  state.client.updateFlag({ ...flag, enabled: !flag.enabled });
  renderFlagList();
  renderEvaluation();
  toast(`${flag.name} ${flag.enabled ? "disabled" : "enabled"}`, flag.enabled ? "info" : "success");
}

function readContext() {
  state.attributes = {
    userId: $("#attr-userId").value.trim() || "anonymous",
    email: $("#attr-email").value.trim(),
    plan: $("#attr-plan").value,
    country: $("#attr-country").value,
    device: $("#attr-device").value,
    ltv: Number($("#attr-ltv").value) || 0,
  };
  state.evaluations = 0;
  renderEvaluation();
}

function applyHash() {
  const hash = location.hash.replace("#", "");
  if (!hash) return;
  const keys = state.client.getFlags().map((flag) => flag.key);
  if (keys.includes(hash)) {
    state.flagKey = hash;
    return;
  }
  const match = keys.find((key) => hash.startsWith(`${key}-`));
  if (!match) return;
  state.flagKey = match;
  const preset = hash.slice(match.length + 1);
  if (preset === "mobile") state.attributes = { ...SAMPLE_ATTRIBUTES, device: "mobile", country: "NP", plan: "free" };
  if (preset === "staff") state.attributes = { ...SAMPLE_ATTRIBUTES, email: "nima@arviontech.net" };
  if (preset === "enterprise") state.attributes = { ...SAMPLE_ATTRIBUTES, plan: "enterprise", country: "US", email: "sam@example.com" };
}

function bindEvents() {
  for (const id of ["attr-userId", "attr-email", "attr-plan", "attr-country", "attr-device", "attr-ltv"]) {
    $(`#${id}`).addEventListener("input", A.debounce(readContext, 120));
    $(`#${id}`).addEventListener("change", readContext);
  }
  $("#randomize").addEventListener("click", () => {
    state.attributes.userId = `user_${Math.floor(Math.random() * 100000)}`;
    $("#attr-userId").value = state.attributes.userId;
    readContext();
  });
  $("#rollout").addEventListener("input", (event) => {
    const flag = state.client.getFlag(state.flagKey);
    if (!flag) return;
    const rollout = Number(event.target.value);
    state.client.updateFlag({ ...flag, rollout });
    $("#rollout-value").textContent = `${rollout}%`;
    renderFlagList();
    renderEvaluation();
  });
}

function init() {
  state.client = createClient(state.workspace, { now: () => NOW });
  applyHash();
  $("#workspace-version").textContent = `workspace v${state.workspace.version}`;
  bindEvents();
  renderFlagList();
  renderContextForm();
  renderEvaluation();
}

init();
