import { describe, it, expect } from 'vitest';
import {
  ROOM_CODE_ALPHABET,
  ROOM_CODE_LENGTH,
  generateRoomCode,
  generateUniqueRoomCode,
  isValidRoomCode,
  normalizeRoomCodeInput,
  describeRoomCodeProblem,
} from './roomCode';

describe('room code alphabet', () => {
  it('excludes every confusable character', () => {
    for (const banned of ['O', '0', 'I', '1', 'L', 'S', '5', 'Z', '2', 'B', '8']) {
      expect(ROOM_CODE_ALPHABET).not.toContain(banned);
    }
  });

  it('has no duplicate characters', () => {
    expect(new Set(ROOM_CODE_ALPHABET).size).toBe(ROOM_CODE_ALPHABET.length);
  });

  it('is large enough to make guessing another room impractical', () => {
    expect(ROOM_CODE_ALPHABET.length ** ROOM_CODE_LENGTH).toBeGreaterThan(300_000);
  });
});

describe('generateRoomCode', () => {
  it('always produces a valid code', () => {
    for (let i = 0; i < 2000; i += 1) {
      const code = generateRoomCode();
      expect(code).toHaveLength(ROOM_CODE_LENGTH);
      expect(isValidRoomCode(code)).toBe(true);
    }
  });

  it('uses the whole alphabet rather than a narrow slice', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 5000; i += 1) {
      for (const character of generateRoomCode()) seen.add(character);
    }
    expect(seen.size).toBe(ROOM_CODE_ALPHABET.length);
  });
});

describe('generateUniqueRoomCode', () => {
  it('skips codes that are already in use', () => {
    const taken = new Set<string>();
    for (let i = 0; i < 300; i += 1) {
      const code = generateUniqueRoomCode((c) => taken.has(c));
      expect(taken.has(code)).toBe(false);
      taken.add(code);
    }
    expect(taken.size).toBe(300);
  });

  it('gives up with a clear error instead of looping forever', () => {
    expect(() => generateUniqueRoomCode(() => true)).toThrow(/unused room code/i);
  });
});

describe('normalizeRoomCodeInput', () => {
  it('uppercases and removes spaces and hyphens', () => {
    expect(normalizeRoomCodeInput('  kx-q7 ')).toBe('KXQ7');
  });

  it('does not silently convert an excluded character into a valid one', () => {
    // "0" is not a legal character. Turning it into "O" would be wrong too,
    // because "O" is also excluded. The code must simply fail validation.
    const normalized = normalizeRoomCodeInput('K0Q7');
    expect(isValidRoomCode(normalized)).toBe(false);
  });
});

describe('describeRoomCodeProblem', () => {
  it('returns null for a good code', () => {
    expect(describeRoomCodeProblem('KXQ7')).toBeNull();
  });

  it('explains a wrong length in plain language', () => {
    expect(describeRoomCodeProblem('KX')).toMatch(/4 characters/i);
  });

  it('names the specific confusable character the player typed', () => {
    expect(describeRoomCodeProblem('K0Q7')).toMatch(/0/);
    expect(describeRoomCodeProblem('KIQ7')).toMatch(/I/);
  });
});
