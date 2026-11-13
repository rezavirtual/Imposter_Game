/**
 * SECURE RANDOMNESS
 * -----------------
 * Role assignment, word selection and clue order must not be guessable. The
 * ordinary Math.random() is predictable enough that a determined player could
 * in principle infer outcomes, so every game-critical draw goes through here.
 *
 * Everything takes an injectable `RandomSource` so tests can run with a fixed,
 * repeatable sequence while production uses real cryptographic randomness.
 */

/** Returns a float in [0, 1). */
export type RandomSource = () => number;

/**
 * Cryptographically secure source, backed by the browser/Node Web Crypto API.
 * Uses 32 bits of entropy per draw and divides by 2^32 to stay in [0, 1).
 */
export const cryptoRandom: RandomSource = () => {
  const buffer = new Uint32Array(1);
  crypto.getRandomValues(buffer);
  return buffer[0]! / 0x1_0000_0000;
};

/**
 * Random integer in [0, maxExclusive).
 *
 * Uses rejection sampling rather than a plain modulo. A modulo would make the
 * lowest values very slightly more likely ("modulo bias"), which is exactly
 * the kind of tiny unfairness that matters for imposter selection.
 */
export function randomInt(maxExclusive: number, random: RandomSource = cryptoRandom): number {
  if (!Number.isInteger(maxExclusive) || maxExclusive <= 0) {
    throw new Error(`randomInt requires a positive integer bound, received ${maxExclusive}`);
  }
  if (maxExclusive === 1) return 0;

  const limit = Math.floor(0x1_0000_0000 / maxExclusive) * maxExclusive;

  // Bounded so a pathological source can never hang the game.
  for (let attempt = 0; attempt < 1000; attempt += 1) {
    const draw = Math.floor(random() * 0x1_0000_0000);
    if (draw < limit) return draw % maxExclusive;
  }
  return Math.floor(random() * maxExclusive) % maxExclusive;
}

/**
 * Fisher-Yates shuffle, returning a NEW array. The input is never mutated,
 * which keeps callers free of accidental side effects.
 */
export function shuffle<T>(items: readonly T[], random: RandomSource = cryptoRandom): T[] {
  const result = [...items];
  for (let i = result.length - 1; i > 0; i -= 1) {
    const j = randomInt(i + 1, random);
    const a = result[i]!;
    const b = result[j]!;
    result[i] = b;
    result[j] = a;
  }
  return result;
}

/** Picks `count` distinct items uniformly at random. */
export function sampleWithoutReplacement<T>(
  items: readonly T[],
  count: number,
  random: RandomSource = cryptoRandom,
): T[] {
  if (count < 0) throw new Error('count must not be negative');
  if (count > items.length) {
    throw new Error(`Cannot sample ${count} items from a list of ${items.length}`);
  }
  return shuffle(items, random).slice(0, count);
}

export interface Weighted<T> {
  item: T;
  /** Must be greater than zero. Relative, not a probability. */
  weight: number;
}

/**
 * Weighted random selection.
 *
 * Used for the "who gives the first clue" draw, where an imposter carries a
 * deliberately lower weight than a regular player but never a zero chance.
 */
export function weightedPick<T>(
  entries: readonly Weighted<T>[],
  random: RandomSource = cryptoRandom,
): T {
  if (entries.length === 0) throw new Error('weightedPick requires at least one entry');

  let total = 0;
  for (const entry of entries) {
    if (!(entry.weight > 0) || !Number.isFinite(entry.weight)) {
      throw new Error(`Weights must be finite and greater than zero, received ${entry.weight}`);
    }
    total += entry.weight;
  }

  const threshold = random() * total;
  let running = 0;
  for (const entry of entries) {
    running += entry.weight;
    if (threshold < running) return entry.item;
  }

  // Only reachable through floating-point rounding at the very top of the range.
  return entries[entries.length - 1]!.item;
}
