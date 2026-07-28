import test from "node:test";
import assert from "node:assert/strict";

import { createSampleWorkspace, SAMPLE_ATTRIBUTES } from "../src/samples.js";
import { createClient } from "../src/sdk.js";

const NOW = Date.parse("2026-10-28T10:00:00Z");
const makeClient = (context = SAMPLE_ATTRIBUTES) =>
  createClient(createSampleWorkspace({ now: NOW }), { now: () => NOW, context });

test("evaluate and getValue return flag values", () => {
  const client = makeClient();
  assert.equal(client.getValue("new-checkout", false), true);
  assert.equal(client.getValue("legacy-banner", true), false);
  assert.equal(client.getValue("search-v2", "fallback"), "control");
  assert.equal(client.getValue("does-not-exist", "fallback"), "fallback");
  assert.equal(client.evaluate("does-not-exist").reason, "not_found");
});

test("attributes passed to evaluate override the client context", () => {
  const client = makeClient();
  assert.equal(client.getValue("search-v2"), "control");
  assert.equal(client.getValue("search-v2", "control", { device: "mobile", country: "NP" }), "v2");
});

test("all() evaluates every flag for one context", () => {
  const client = makeClient();
  const values = client.all();
  assert.deepEqual(Object.keys(values).sort(), ["legacy-banner", "new-checkout", "search-v2", "weekly-digest"]);
  assert.equal(values["new-checkout"], true);
});

test("subscribe fires on flag updates and unsubscribe stops it", () => {
  const client = makeClient();
  const events = [];
  const unsubscribe = client.subscribe((event) => events.push(event));
  const flag = client.getFlag("new-checkout");
  client.updateFlag({ ...flag, enabled: false });

  assert.equal(events.length, 1);
  assert.equal(events[0].type, "flag-updated");
  assert.equal(events[0].key, "new-checkout");
  assert.equal(client.evaluate("new-checkout").reason, "disabled");

  unsubscribe();
  client.updateFlag({ ...flag, enabled: true });
  assert.equal(events.length, 1);
});

test("updateFlag can add a new flag", () => {
  const client = makeClient();
  client.updateFlag({ key: "brand-new", name: "New", enabled: true, onValue: "on", offValue: "off", rollout: 100, rules: [] });
  assert.equal(client.getValue("brand-new"), "on");
  assert.equal(client.getFlags().length, 5);
});

test("a throwing subscriber does not break the others", () => {
  const client = makeClient();
  const seen = [];
  client.subscribe(() => { throw new Error("boom"); });
  client.subscribe((event) => seen.push(event.type));
  assert.doesNotThrow(() => client.setContext({ plan: "enterprise" }));
  assert.deepEqual(seen, ["context-updated"]);
});

test("setContext changes subsequent evaluations", () => {
  const client = makeClient();
  assert.equal(client.getValue("search-v2"), "control");
  client.setContext({ plan: "enterprise", country: "NP" });
  assert.equal(client.getValue("search-v2"), "v2");
  assert.equal(client.getContext().plan, "enterprise");
});

test("returned flags and snapshots are copies", () => {
  const client = makeClient();
  const flag = client.getFlag("new-checkout");
  flag.enabled = false;
  assert.equal(client.getFlag("new-checkout").enabled, true);

  const snapshot = client.snapshot();
  snapshot.flags[0].enabled = false;
  assert.equal(client.snapshot().flags[0].enabled, true);
});

test("subscribing requires a function", () => {
  const client = makeClient();
  assert.throws(() => client.subscribe("nope"), /expects a function/);
  assert.throws(() => client.updateFlag({}), /needs a key/);
});
