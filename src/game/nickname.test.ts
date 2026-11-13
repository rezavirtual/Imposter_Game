import { describe, it, expect } from 'vitest';
import { checkNickname, normalizeNickname, nicknameComparisonKey } from './nickname';

describe('normalizeNickname', () => {
  it('trims and collapses whitespace but keeps the chosen capitalisation', () => {
    expect(normalizeNickname('  Sam   Smith ')).toBe('Sam Smith');
  });

  it('strips invisible characters used to fake a duplicate name', () => {
    expect(normalizeNickname('Sam\u200B')).toBe('Sam');
  });

  it('strips right-to-left override characters', () => {
    expect(normalizeNickname('\u202ESam')).toBe('Sam');
  });
});

describe('duplicate detection', () => {
  it('treats different capitalisation as the same name', () => {
    expect(nicknameComparisonKey('SAM')).toBe(nicknameComparisonKey('sam'));
  });

  it('treats spaced-out names as the same name', () => {
    expect(nicknameComparisonKey('S a m')).toBe(nicknameComparisonKey('Sam'));
  });

  it('rejects a duplicate instead of renaming it', () => {
    const result = checkNickname('sam', ['Sam']);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe('already_taken');
      expect(result.message).toMatch(/already used/i);
    }
  });

  it('accepts a genuinely different name', () => {
    const result = checkNickname('Alex', ['Sam']);
    expect(result).toEqual({ ok: true, nickname: 'Alex' });
  });
});

describe('host renaming a player', () => {
  it('does not block a player from keeping their own name', () => {
    const result = checkNickname('Sam', ['Sam', 'Alex'], 'Sam');
    expect(result.ok).toBe(true);
  });

  it('still blocks renaming onto somebody else name', () => {
    const result = checkNickname('Alex', ['Sam', 'Alex'], 'Sam');
    expect(result.ok).toBe(false);
  });
});

describe('length and content rules', () => {
  it('rejects an empty nickname', () => {
    const result = checkNickname('   ', []);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('empty');
  });

  it('rejects a single character', () => {
    const result = checkNickname('S', []);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('too_short');
  });

  it('rejects an overly long nickname', () => {
    const result = checkNickname('a'.repeat(17), []);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('too_long');
  });

  it('rejects punctuation with no letters or numbers', () => {
    const result = checkNickname('!!!', []);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('no_letters_or_numbers');
  });

  it('accepts non-Latin alphabets', () => {
    expect(checkNickname('さくら', []).ok).toBe(true);
    expect(checkNickname('Ñoño', []).ok).toBe(true);
  });

  it('accepts emoji as long as a letter or number is present', () => {
    expect(checkNickname('Sam 🎩', []).ok).toBe(true);
  });
});
