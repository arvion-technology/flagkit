// Client SDK.
//
// The SDK holds a local snapshot of the workspace and evaluates flags in
// memory, so a call is a hash and a few comparisons rather than a network
// round trip. `updateFlag` and `subscribe` are the admin/demo side of the same
// object: a dashboard can change a flag and every subscriber re-renders.
import { evaluateFlag } from "./evaluate.js";

const clone = (value) => (typeof structuredClone === "function" ? structuredClone(value) : JSON.parse(JSON.stringify(value)));

export function createClient(workspace, { now = () => Date.now(), context = {} } = {}) {
  let flags = (workspace?.flags || []).map(clone);
  let baseContext = { ...context };
  const listeners = new Set();

  function emit(event) {
    for (const listener of listeners) {
      try {
        listener(event);
      } catch {
        // A broken subscriber must not break evaluation for everyone else.
      }
    }
  }

  const client = {
    evaluate(key, attributes = {}) {
      const flag = flags.find((entry) => entry.key === key);
      return evaluateFlag(flag, { ...baseContext, ...attributes }, { now: now() });
    },
    getValue(key, fallback = false, attributes = {}) {
      const result = client.evaluate(key, attributes);
      return result.reason === "not_found" ? fallback : result.value;
    },
    /** Every flag's value for one context, the shape a server render needs. */
    all(attributes = {}) {
      return Object.fromEntries(flags.map((flag) => [flag.key, client.getValue(flag.key, false, attributes)]));
    },
    getFlags() {
      return flags.map(clone);
    },
    getFlag(key) {
      const flag = flags.find((entry) => entry.key === key);
      return flag ? clone(flag) : null;
    },
    updateFlag(nextFlag) {
      if (!nextFlag || typeof nextFlag.key !== "string") throw new Error("updateFlag needs a key");
      const next = clone(nextFlag);
      const index = flags.findIndex((entry) => entry.key === next.key);
      if (index === -1) flags.push(next);
      else flags[index] = next;
      emit({ type: "flag-updated", key: next.key, flag: clone(next) });
      return clone(next);
    },
    setContext(patch = {}) {
      baseContext = { ...baseContext, ...patch };
      emit({ type: "context-updated", context: { ...baseContext } });
      return { ...baseContext };
    },
    getContext() {
      return { ...baseContext };
    },
    subscribe(listener) {
      if (typeof listener !== "function") throw new TypeError("subscribe expects a function");
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    snapshot() {
      return { flags: flags.map(clone), context: { ...baseContext } };
    },
  };

  return client;
}
