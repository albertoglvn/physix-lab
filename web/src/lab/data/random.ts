/**
 * Seeded random numbers for synthetic repeats. A stream depends only on its seed and keys,
 * never on call order across streams, so results do not depend on worker scheduling.
 */

export type Random = () => number;

/** Largest seed a user can type; seeds are unsigned 32-bit integers. */
export const MAX_SEED = 0xffffffff;

/** Mixes integers into one 32-bit seed (a splitmix32-style finaliser per key). */
export function hashSeed(...keys: number[]): number {
  let hash = 0x9e3779b9;
  for (const key of keys) {
    if (!Number.isInteger(key))
      throw new Error("Random keys must be integers.");
    hash = Math.imul(hash ^ (key >>> 0), 0x85ebca6b);
    hash ^= hash >>> 13;
    hash = Math.imul(hash, 0xc2b2ae35);
    hash ^= hash >>> 16;
    hash = (hash + 0x6d2b79f5) | 0;
  }
  return hash >>> 0;
}

/** mulberry32: uniform numbers in [0, 1) from a 32-bit seed. */
export function mulberry32(seed: number): Random {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A stream keyed by a seed and extra integers, such as a point and a repeat index. */
export const stream = (seed: number, ...keys: number[]): Random =>
  mulberry32(hashSeed(seed, ...keys));

/** One standard normal draw by the Box–Muller transform. */
export function gaussian(random: Random): number {
  const u = 1 - random(); // in (0, 1], so the logarithm is finite
  const v = random();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

/** A seed for a new sweep, from the platform's generator when there is one. */
export function freshSeed(): number {
  const crypto = globalThis.crypto;
  if (crypto?.getRandomValues)
    return crypto.getRandomValues(new Uint32Array(1))[0];
  return Math.floor(Math.random() * MAX_SEED);
}
