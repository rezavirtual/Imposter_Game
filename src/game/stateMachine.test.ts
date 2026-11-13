import { describe, it, expect } from 'vitest';
import {
  PHASES,
  TRANSITIONS,
  TERMINAL_PHASES,
  evaluateTransition,
  allowedIntents,
  phaseOnReconnect,
  isStaleRequest,
  type Phase,
} from './stateMachine';

describe('phase list', () => {
  it('contains all 15 phases from the specification', () => {
    expect(PHASES).toHaveLength(15);
    for (const phase of [
      'lobby',
      'configuring',
      'assigning_roles',
      'private_role_reveal',
      'clue_turn',
      'discussion',
      'voting',
      'tied_revote',
      'vote_result',
      'imposter_final_guess',
      'round_result',
      'scoreboard',
      'next_round',
      'match_result',
      'room_closed',
    ]) {
      expect(PHASES).toContain(phase);
    }
  });
});

describe('transition table integrity', () => {
  it('only references phases that exist', () => {
    for (const t of TRANSITIONS) {
      expect(PHASES).toContain(t.from);
      expect(PHASES).toContain(t.to);
    }
  });

  it('documents a condition for every transition', () => {
    for (const t of TRANSITIONS) {
      expect(t.condition.length).toBeGreaterThan(10);
    }
  });

  it('never leaves a terminal phase', () => {
    for (const t of TRANSITIONS) {
      expect(TERMINAL_PHASES).not.toContain(t.from);
    }
  });

  it('has no duplicate from+intent+actor rows', () => {
    const keys = TRANSITIONS.map((t) => `${t.from}|${t.intent}|${t.actor}`);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('can reach every non-lobby phase from somewhere', () => {
    const reachable = new Set(TRANSITIONS.map((t) => t.to));
    for (const phase of PHASES) {
      if (phase === 'lobby') continue;
      expect(reachable).toContain(phase);
    }
  });
});

describe('the happy path of a standard match', () => {
  it('walks lobby to scoreboard using only legal transitions', () => {
    const path: Array<[Phase, Parameters<typeof evaluateTransition>[0]['intent'], Parameters<typeof evaluateTransition>[0]['actor'], Phase]> = [
      ['lobby', 'start_match', 'host', 'assigning_roles'],
      ['assigning_roles', 'roles_assigned', 'system', 'private_role_reveal'],
      ['private_role_reveal', 'all_roles_acknowledged', 'system', 'clue_turn'],
      ['clue_turn', 'all_clues_given', 'system', 'discussion'],
      ['discussion', 'start_voting', 'host', 'voting'],
      ['voting', 'all_votes_locked', 'system', 'vote_result'],
      ['vote_result', 'require_final_guess', 'system', 'imposter_final_guess'],
      ['imposter_final_guess', 'judge_final_guess', 'host', 'round_result'],
      ['round_result', 'show_scoreboard', 'system', 'scoreboard'],
      ['scoreboard', 'start_next_round', 'host', 'next_round'],
      ['next_round', 'roles_assigned', 'system', 'private_role_reveal'],
    ];

    for (const [from, intent, actor, expected] of path) {
      const result = evaluateTransition({ from, intent, actor, mode: 'standard' });
      expect(result.ok, `${from} --${intent}--> expected ${expected}`).toBe(true);
      if (result.ok) expect(result.to).toBe(expected);
    }
  });

  it('walks the tie path', () => {
    const tie = evaluateTransition({
      from: 'voting',
      intent: 'resolve_tie',
      actor: 'system',
      mode: 'standard',
    });
    expect(tie.ok && tie.to).toBe('tied_revote');

    const resolved = evaluateTransition({
      from: 'tied_revote',
      intent: 'revote_resolved',
      actor: 'system',
      mode: 'standard',
    });
    expect(resolved.ok && resolved.to).toBe('vote_result');
  });

  it('skips the final guess when no imposter was caught', () => {
    const result = evaluateTransition({
      from: 'vote_result',
      intent: 'skip_final_guess',
      actor: 'system',
      mode: 'standard',
    });
    expect(result.ok && result.to).toBe('round_result');
  });
});

describe('a client can never set a phase directly', () => {
  it('rejects a regular player trying to start the match', () => {
    const result = evaluateTransition({
      from: 'lobby',
      intent: 'start_match',
      actor: 'eligible_player',
      mode: 'standard',
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('wrong_actor');
  });

  it('rejects a player trying to open voting instead of the host', () => {
    const result = evaluateTransition({
      from: 'discussion',
      intent: 'start_voting',
      actor: 'eligible_player',
      mode: 'standard',
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('wrong_actor');
  });

  it('rejects a player impersonating the system', () => {
    const result = evaluateTransition({
      from: 'voting',
      intent: 'all_votes_locked',
      actor: 'eligible_player',
      mode: 'standard',
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('wrong_actor');
  });

  it('rejects a player judging the imposter final guess', () => {
    const result = evaluateTransition({
      from: 'imposter_final_guess',
      intent: 'judge_final_guess',
      actor: 'eligible_player',
      mode: 'standard',
    });
    expect(result.ok).toBe(false);
  });

  it('rejects jumping straight from the lobby to voting', () => {
    const result = evaluateTransition({
      from: 'lobby',
      intent: 'start_voting',
      actor: 'host',
      mode: 'standard',
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('unknown_transition');
  });

  it('rejects giving a clue during voting', () => {
    const result = evaluateTransition({
      from: 'voting',
      intent: 'give_clue',
      actor: 'active_player',
      mode: 'standard',
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('unknown_transition');
  });
});

describe('closed rooms are final', () => {
  it('rejects every intent once the room is closed', () => {
    for (const t of TRANSITIONS) {
      const result = evaluateTransition({
        from: 'room_closed',
        intent: t.intent,
        actor: t.actor,
        mode: 'standard',
      });
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.reason).toBe('terminal_phase');
    }
  });

  it('lets the host close the room from any active phase', () => {
    for (const phase of PHASES) {
      if (TERMINAL_PHASES.includes(phase)) continue;
      if (phase === 'assigning_roles' || phase === 'next_round') continue; // momentary system phases
      const result = evaluateTransition({
        from: phase,
        intent: 'close_room',
        actor: 'host',
        mode: 'standard',
      });
      expect(result.ok, `host should be able to close from ${phase}`).toBe(true);
    }
  });
});

describe('allowedIntents', () => {
  it('tells the host what they may do in the lobby', () => {
    const intents = allowedIntents('lobby', 'host', 'standard');
    expect(intents).toContain('start_match');
    expect(intents).toContain('open_settings');
    expect(intents).toContain('close_room');
  });

  it('gives a regular player nothing to do during discussion', () => {
    expect(allowedIntents('discussion', 'eligible_player', 'standard')).toEqual([]);
  });

  it('gives nothing at all in a closed room', () => {
    expect(allowedIntents('room_closed', 'host', 'standard')).toEqual([]);
  });
});

describe('reconnection', () => {
  it('never changes the phase', () => {
    for (const phase of PHASES) {
      expect(phaseOnReconnect(phase)).toBe(phase);
    }
  });
});

describe('stale request rejection', () => {
  it('rejects a client that is behind the server', () => {
    expect(isStaleRequest(4, 7)).toBe(true);
  });

  it('accepts a client that is up to date', () => {
    expect(isStaleRequest(7, 7)).toBe(false);
  });

  it('accepts a client that is somehow ahead rather than deadlocking it', () => {
    expect(isStaleRequest(8, 7)).toBe(false);
  });
});

describe('all three game modes share the core machine', () => {
  it('supports the same core path in standard, three-player and double agent', () => {
    for (const mode of ['standard', 'three_player', 'double_agent'] as const) {
      const result = evaluateTransition({
        from: 'discussion',
        intent: 'start_voting',
        actor: 'host',
        mode,
      });
      expect(result.ok, `start_voting should work in ${mode}`).toBe(true);
    }
  });
});
