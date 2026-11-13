/**
 * ROOM CODES
 * ----------
 * Four characters, read aloud across a table and typed on a phone keyboard.
 *
 * Confusable characters are removed from the alphabet entirely:
 *   O / 0, I / 1, and additionally L (looks like 1), S / 5, Z / 2, B / 8.
 * Removing them is cheaper than handling the support complaints.
 */

import { randomInt, type RandomSource, cryptoRandom } from './random';

/** 24 unambiguous characters. 24^4 = 331,776 possible codes. */
export const ROOM_CODE_ALPHABET = 'ACDEFGHJKMNPQRTUVWXY34679';

export const ROOM_CODE_LENGTH = 4;

/**
 * Characters deliberately kept OUT of the alphabet, each paired with the
 * character it is commonly mistaken for. Used only to write a helpful error
 * message — we never auto-correct, because guessing wrong would send the
 * player into a stranger's room.
 */
const EXCLUDED_CHARACTERS: Record<string, string> = {
  O: 'the digit 0',
  '0': 'the letter O',
  I: 'the digit 1',
  '1': 'the letter I',
  L: 'the digit 1',
  S: 'the digit 5',
  '5': 'the letter S',
  Z: 'the digit 2',
  '2': 'the letter Z',
  B: 'the digit 8',
  '8': 'the letter B',
};

export function generateRoomCode(random: RandomSource = cryptoRandom): string {
  let code = '';
  for (let i = 0; i < ROOM_CODE_LENGTH; i += 1) {
    code += ROOM_CODE_ALPHABET[randomInt(ROOM_CODE_ALPHABET.length, random)]!;
  }
  return code;
}

/**
 * Generates a code that is not already taken by an active room.
 *
 * `isTaken` is supplied by the caller so this stays a pure function and can be
 * tested without a database.
 */
export function generateUniqueRoomCode(
  isTaken: (code: string) => boolean,
  random: RandomSource = cryptoRandom,
  maxAttempts = 50,
): string {
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const code = generateRoomCode(random);
    if (!isTaken(code)) return code;
  }
  throw new Error('Could not generate an unused room code. Too many active rooms.');
}

export function isValidRoomCode(code: string): boolean {
  if (code.length !== ROOM_CODE_LENGTH) return false;
  return [...code].every((character) => ROOM_CODE_ALPHABET.includes(character));
}

/**
 * Cleans up what a player typed: trims surrounding spaces, removes inner
 * spaces and hyphens, and uppercases.
 *
 * It does NOT substitute excluded characters. If someone types "0", we cannot
 * know whether they meant O or genuinely mistyped, and silently guessing could
 * drop them into the wrong room. Validation fails loudly instead.
 */
export function normalizeRoomCodeInput(input: string): string {
  return input.trim().toUpperCase().replace(/[\s-]/g, '');
}

/**
 * Explains, in plain language, why a typed code is not acceptable.
 * Returns `null` when the code is fine.
 */
export function describeRoomCodeProblem(code: string): string | null {
  if (code.length === 0) return 'Enter the 4-character room code.';

  if (code.length !== ROOM_CODE_LENGTH) {
    return `Room codes are 4 characters long. You entered ${code.length}.`;
  }

  for (const character of code) {
    if (ROOM_CODE_ALPHABET.includes(character)) continue;

    const confusedWith = EXCLUDED_CHARACTERS[character];
    if (confusedWith) {
      return `Room codes never contain "${character}", because it looks too much like ${confusedWith}. Please check the code again.`;
    }
    return `"${character}" is not used in room codes. Please check the code again.`;
  }

  return null;
}
