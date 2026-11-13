import { describe, it, expect } from 'vitest';
import { defaultHostSettings, reconcileSettings, CLUE_TIMER_CHOICES, FIXED_ROUND_CHOICES } from './settings';

describe('specification defaults', () => {
  const settings = defaultHostSettings(6);

  it('defaults to 5 fixed rounds', () => {
    expect(settings.matchEndMode).toBe('fixed_rounds');
    expect(settings.fixedRounds).toBe(5);
  });

  it('defaults to automatic imposter count', () => {
    expect(settings.imposterCountMode).toBe('automatic');
  });

  it('defaults to medium difficulty, Family age group and Global region', () => {
    expect(settings.difficulty).toBe('medium');
    expect(settings.ageGroup).toBe('family');
    expect(settings.region).toBe('global');
  });

  it('defaults to a 30-second guidance timer', () => {
    expect(settings.clueTimerSeconds).toBe(30);
  });

  it('allows the imposter to start by default', () => {
    expect(settings.allowImposterFirst).toBe(true);
  });

  it('defaults to the Dark Spy theme', () => {
    expect(settings.themeId).toBe('dark-spy');
  });

  it('allows vote reveal by default', () => {
    expect(settings.allowVoteReveal).toBe(true);
  });
});

describe('imposter information default depends on player count', () => {
  it('uses Category Hint for three players', () => {
    expect(defaultHostSettings(3).imposterInfo).toBe('category_hint');
  });

  it('uses No Word for four or more players', () => {
    for (let n = 4; n <= 10; n += 1) {
      expect(defaultHostSettings(n).imposterInfo).toBe('no_word');
    }
  });
});

describe('available choices', () => {
  it('offers exactly the specified round counts', () => {
    expect(FIXED_ROUND_CHOICES).toEqual([3, 5, 7, 10]);
  });

  it('offers off plus the specified timer lengths', () => {
    expect(CLUE_TIMER_CHOICES).toEqual([null, 15, 20, 30, 45, 60]);
  });
});

describe('reconciling after the player count changes', () => {
  it('repairs an imposter count that became impossible', () => {
    const settings = { ...defaultHostSettings(9), imposterCountMode: 'manual' as const, manualImposterCount: 3 };
    const result = reconcileSettings(settings, 5);
    expect(result.settings.manualImposterCount).toBe(1);
    expect(result.notes[0]).toMatch(/changed to 1/i);
  });

  it('leaves a still-valid manual count alone', () => {
    const settings = { ...defaultHostSettings(8), imposterCountMode: 'manual' as const, manualImposterCount: 2 };
    const result = reconcileSettings(settings, 7);
    expect(result.settings.manualImposterCount).toBe(2);
    expect(result.notes).toEqual([]);
  });

  it('suggests Category Hint when a room shrinks to three players', () => {
    const settings = { ...defaultHostSettings(6) };
    const result = reconcileSettings(settings, 3);
    expect(result.notes.some((n) => /category hint/i.test(n))).toBe(true);
  });

  it('never mutates the settings it was given', () => {
    const settings = { ...defaultHostSettings(9), imposterCountMode: 'manual' as const, manualImposterCount: 3 };
    const snapshot = { ...settings };
    reconcileSettings(settings, 4);
    expect(settings).toEqual(snapshot);
  });
});
