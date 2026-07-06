// Stable hashing for percentage rollouts.
//
// A rollout must put the same subject in the same bucket on every client and
// every run, otherwise a user flickers between variations. MurmurHash3 (x86,
// 32-bit) gives a good distribution from a short string and is easy to port if
// this ever needs to agree with a server written in another language.

const encoder = new TextEncoder();

export function murmur3(text, seed = 0) {
  const bytes = encoder.encode(String(text));
  const c1 = 0xcc9e2d51;
  const c2 = 0x1b873593;
  let hash = seed >>> 0;
  const blocks = bytes.length >> 2;

  for (let block = 0; block < blocks; block++) {
    const offset = block * 4;
    let word = (bytes[offset] | (bytes[offset + 1] << 8) | (bytes[offset + 2] << 16) | (bytes[offset + 3] << 24)) >>> 0;
    word = Math.imul(word, c1);
    word = (word << 15) | (word >>> 17);
    word = Math.imul(word, c2);
    hash ^= word;
    hash = (hash << 13) | (hash >>> 19);
    hash = (Math.imul(hash, 5) + 0xe6546b64) >>> 0;
  }

  let tail = 0;
  const start = blocks * 4;
  const remainder = bytes.length & 3;
  if (remainder >= 3) tail ^= bytes[start + 2] << 16;
  if (remainder >= 2) tail ^= bytes[start + 1] << 8;
  if (remainder >= 1) {
    tail ^= bytes[start];
    tail = Math.imul(tail, c1);
    tail = (tail << 15) | (tail >>> 17);
    tail = Math.imul(tail, c2);
    hash ^= tail;
  }

  hash ^= bytes.length;
  hash ^= hash >>> 16;
  hash = Math.imul(hash, 0x85ebca6b);
  hash ^= hash >>> 13;
  hash = Math.imul(hash, 0xc2b2ae35);
  hash ^= hash >>> 16;
  return hash >>> 0;
}

/**
 * Bucket a subject into [0, buckets). The namespace should include the flag
 * key and an optional salt so two flags do not partition users identically.
 */
export function bucket(subject, { namespace = "", buckets = 100 } = {}) {
  if (buckets <= 0) throw new Error("buckets must be positive");
  return murmur3(`${namespace}:${subject}`) % buckets;
}

/** Deterministic coin flip: percentage in [0, 100]. */
export function inRollout(subject, percentage, namespace = "") {
  const percent = Number(percentage);
  if (Number.isNaN(percent)) return false;
  if (percent >= 100) return true;
  if (percent <= 0) return false;
  return bucket(subject, { namespace, buckets: 100 }) < percent;
}

export const HASH_VERSION = "murmur3-x86-32";
