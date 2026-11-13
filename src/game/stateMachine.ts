/**
 * THE GAME STATE MACHINE
 * ----------------------
 * This file is the single source of truth for "what is allowed to happen next".
 *
 * It is a PURE module: it does no networking and touches no database. That
 * matters because the identical rules are mirrored in the database functions,
 * and pure code can be exhaustively tested.
 *
 * GOLDEN RULE
 * A client never sets a phase. A client sends an INTENT ("I gave my clue"),
 * and the authoritative side decides whether that intent produces a transition.
 */

import type { GameMode } from './types';

// ---------------------------------------------------------------------------
// Phases
// ---------------------------------------------------------------------------

export const PHASES = [
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
] as const;

export type Phase = (typeof PHASES)[number];

/** Who is permitted to trigger a given transition. */
export type Actor =
  /** The room host only. */
  | 'host'
  /** The player whose clue turn it currently is. */
  | 'active_player'
  /** Any connected, non-eliminated player. */
  | 'eligible_player'
  /**
   * No human. The authoritative side fires this itself once a condition is
   * met (for example: the last clue was given, or every vote is locked).
   */
  | 'system';

// ---------------------------------------------------------------------------
// Intents
// ---------------------------------------------------------------------------

/**
 * Every action a client may REQUEST. This list is closed: anything not named
 * here cannot change the game.
 */
export const INTENTS = [
  'open_settings',
  'close_settings',
  'start_match',
  'roles_assigned',
  'acknowledge_role',
  'all_roles_acknowledged',
  'give_clue',
  'advance_turn_by_host',
  'all_clues_given',
  'start_voting',
  'lock_vote',
  'all_votes_locked',
  'resolve_tie',
  'revote_resolved',
  'reveal_result',
  'require_final_guess',
  'judge_final_guess',
  'skip_final_guess',
  'show_scoreboard',
  'start_next_round',
  'end_match',
  'close_room',
] as const;

export type Intent = (typeof INTENTS)[number];

// ---------------------------------------------------------------------------
// Transition table
// ---------------------------------------------------------------------------

export interface Transition {
  from: Phase;
  intent: Intent;
  to: Phase;
  /** Who may trigger it. */
  actor: Actor;
  /** Plain-language description of the guard the server must check. */
  condition: string;
  /** Which game modes this transition exists in. */
  modes: readonly GameMode[];
}

const ALL_MODES: readonly GameMode[] = ['standard', 'three_player', 'double_agent'];

/**
 * The complete legal transition table.
 *
 * Anything NOT in this table is illegal and must be rejected by both the
 * client and the authoritative side.
 */
export const TRANSITIONS: readonly Transition[] = [
  // --- Setting up -----------------------------------------------------------
  {
    from: 'lobby',
    intent: 'open_settings',
    to: 'configuring',
    actor: 'host',
    condition: 'Room is not locked into a running match.',
    modes: ALL_MODES,
  },
  {
    from: 'configuring',
    intent: 'close_settings',
    to: 'lobby',
    actor: 'host',
    condition: 'Settings validate against the current player count.',
    modes: ALL_MODES,
  },
  {
    from: 'lobby',
    intent: 'start_match',
    to: 'assigning_roles',
    actor: 'host',
    condition:
      'Player count is within the mode range, all players connected or reconnecting, ' +
      'imposter count is valid, and no round is already in progress (idempotency key required).',
    modes: ALL_MODES,
  },
  {
    from: 'configuring',
    intent: 'start_match',
    to: 'assigning_roles',
    actor: 'host',
    condition: 'Same as from lobby. Settings are saved first.',
    modes: ALL_MODES,
  },

  // --- Roles ----------------------------------------------------------------
  {
    from: 'assigning_roles',
    intent: 'roles_assigned',
    to: 'private_role_reveal',
    actor: 'system',
    condition:
      'Secure random roles, secret word and clue order have been written and committed. ' +
      'Clue order is frozen from this point.',
    modes: ALL_MODES,
  },
  {
    from: 'private_role_reveal',
    intent: 'acknowledge_role',
    to: 'private_role_reveal',
    actor: 'eligible_player',
    condition: 'Self-transition. Records that THIS player has seen their role. Idempotent.',
    modes: ALL_MODES,
  },
  {
    from: 'private_role_reveal',
    intent: 'all_roles_acknowledged',
    to: 'clue_turn',
    actor: 'system',
    condition: 'Every connected player acknowledged, or the host forced the start.',
    modes: ALL_MODES,
  },

  // --- Clues ----------------------------------------------------------------
  {
    from: 'clue_turn',
    intent: 'give_clue',
    to: 'clue_turn',
    actor: 'active_player',
    condition:
      'Requester IS the active player, phase IS clue_turn, and the submitted turn index ' +
      'matches the current turn index. Advances exactly one turn. Stale/duplicate rejected.',
    modes: ALL_MODES,
  },
  {
    from: 'clue_turn',
    intent: 'advance_turn_by_host',
    to: 'clue_turn',
    actor: 'host',
    condition:
      'Used when the active player is disconnected or unresponsive. Same turn-index check.',
    modes: ALL_MODES,
  },
  {
    from: 'clue_turn',
    intent: 'all_clues_given',
    to: 'discussion',
    actor: 'system',
    condition: 'Every eligible player has given a clue. Automatic, not a button.',
    modes: ALL_MODES,
  },

  // --- Discussion and voting ------------------------------------------------
  {
    from: 'discussion',
    intent: 'start_voting',
    to: 'voting',
    actor: 'host',
    condition: 'Host-only Vote Now button. Idempotent.',
    modes: ALL_MODES,
  },
  {
    from: 'voting',
    intent: 'lock_vote',
    to: 'voting',
    actor: 'eligible_player',
    condition:
      'Voter is eligible, not eliminated, has not already locked, and the target is not ' +
      'themselves. Vote is final once locked.',
    modes: ALL_MODES,
  },
  {
    from: 'voting',
    intent: 'all_votes_locked',
    to: 'vote_result',
    actor: 'system',
    condition: 'All eligible votes locked AND there is no tie for the highest total.',
    modes: ALL_MODES,
  },
  {
    from: 'voting',
    intent: 'resolve_tie',
    to: 'tied_revote',
    actor: 'system',
    condition: 'All eligible votes locked AND the highest total is tied.',
    modes: ALL_MODES,
  },
  {
    from: 'tied_revote',
    intent: 'lock_vote',
    to: 'tied_revote',
    actor: 'eligible_player',
    condition: 'Same as lock_vote, but the target must be one of the tied players.',
    modes: ALL_MODES,
  },
  {
    from: 'tied_revote',
    intent: 'revote_resolved',
    to: 'vote_result',
    actor: 'system',
    condition:
      'All revotes locked. If tied again, nobody is eliminated and the imposter survives.',
    modes: ALL_MODES,
  },

  // --- Result ---------------------------------------------------------------
  {
    from: 'vote_result',
    intent: 'require_final_guess',
    to: 'imposter_final_guess',
    actor: 'system',
    condition:
      'An imposter was eliminated. Only the ELIMINATED imposter gets the guess. ' +
      'The secret word is still withheld from them.',
    modes: ALL_MODES,
  },
  {
    from: 'vote_result',
    intent: 'skip_final_guess',
    to: 'round_result',
    actor: 'system',
    condition: 'No imposter was eliminated, so no guess is offered.',
    modes: ALL_MODES,
  },
  {
    from: 'imposter_final_guess',
    intent: 'judge_final_guess',
    to: 'round_result',
    actor: 'host',
    condition:
      'Host marks the spoken guess Correct or Incorrect. Protected against double ' +
      'submission by an idempotency key. The word is revealed to everyone afterwards.',
    modes: ALL_MODES,
  },
  {
    from: 'round_result',
    intent: 'show_scoreboard',
    to: 'scoreboard',
    actor: 'system',
    condition: 'Points have been calculated and written authoritatively.',
    modes: ALL_MODES,
  },

  // --- Between rounds -------------------------------------------------------
  {
    from: 'scoreboard',
    intent: 'start_next_round',
    to: 'next_round',
    actor: 'host',
    condition: 'The match end condition has NOT been met. Idempotent.',
    modes: ALL_MODES,
  },
  {
    from: 'next_round',
    intent: 'roles_assigned',
    to: 'private_role_reveal',
    actor: 'system',
    condition: 'A fresh round row exists with new roles, new word and new clue order.',
    modes: ALL_MODES,
  },
  {
    from: 'scoreboard',
    intent: 'end_match',
    to: 'match_result',
    actor: 'host',
    condition: 'Host ended it manually, or the round/score target was reached.',
    modes: ALL_MODES,
  },

  // --- Closing --------------------------------------------------------------
  { from: 'lobby', intent: 'close_room', to: 'room_closed', actor: 'host', condition: 'Host closes the room.', modes: ALL_MODES },
  { from: 'configuring', intent: 'close_room', to: 'room_closed', actor: 'host', condition: 'Host closes the room.', modes: ALL_MODES },
  { from: 'private_role_reveal', intent: 'close_room', to: 'room_closed', actor: 'host', condition: 'Host closes the room.', modes: ALL_MODES },
  { from: 'clue_turn', intent: 'close_room', to: 'room_closed', actor: 'host', condition: 'Host closes the room.', modes: ALL_MODES },
  { from: 'discussion', intent: 'close_room', to: 'room_closed', actor: 'host', condition: 'Host closes the room.', modes: ALL_MODES },
  { from: 'voting', intent: 'close_room', to: 'room_closed', actor: 'host', condition: 'Host closes the room.', modes: ALL_MODES },
  { from: 'tied_revote', intent: 'close_room', to: 'room_closed', actor: 'host', condition: 'Host closes the room.', modes: ALL_MODES },
  { from: 'vote_result', intent: 'close_room', to: 'room_closed', actor: 'host', condition: 'Host closes the room.', modes: ALL_MODES },
  { from: 'imposter_final_guess', intent: 'close_room', to: 'room_closed', actor: 'host', condition: 'Host closes the room.', modes: ALL_MODES },
  { from: 'round_result', intent: 'close_room', to: 'room_closed', actor: 'host', condition: 'Host closes the room.', modes: ALL_MODES },
  { from: 'scoreboard', intent: 'close_room', to: 'room_closed', actor: 'host', condition: 'Host closes the room.', modes: ALL_MODES },
  { from: 'match_result', intent: 'close_room', to: 'room_closed', actor: 'host', condition: 'Host closes the room.', modes: ALL_MODES },
];

// ---------------------------------------------------------------------------
// Lookups
// ---------------------------------------------------------------------------

/** Phases from which the game can never move on. */
export const TERMINAL_PHASES: readonly Phase[] = ['room_closed'];

export interface TransitionRequest {
  from: Phase;
  intent: Intent;
  actor: Actor;
  mode: GameMode;
}

export type TransitionResult =
  | { ok: true; to: Phase; transition: Transition }
  | { ok: false; reason: TransitionRejection };

export type TransitionRejection =
  | 'terminal_phase'
  | 'unknown_transition'
  | 'wrong_actor'
  | 'mode_not_supported';

/**
 * Decides whether a requested transition is legal.
 *
 * This answers ONLY the structural question ("is this move on the board?").
 * Data guards — is this really the active player, has this vote already been
 * locked, does the turn index match — are enforced separately, and again on
 * the authoritative side.
 */
export function evaluateTransition(request: TransitionRequest): TransitionResult {
  const { from, intent, actor, mode } = request;

  if (TERMINAL_PHASES.includes(from)) {
    return { ok: false, reason: 'terminal_phase' };
  }

  const byPhaseAndIntent = TRANSITIONS.filter((t) => t.from === from && t.intent === intent);

  if (byPhaseAndIntent.length === 0) {
    return { ok: false, reason: 'unknown_transition' };
  }

  const inMode = byPhaseAndIntent.filter((t) => t.modes.includes(mode));
  if (inMode.length === 0) {
    return { ok: false, reason: 'mode_not_supported' };
  }

  // 'system' transitions are fired by the authoritative side and may also be
  // forced by the host; no other actor may impersonate the system.
  const match = inMode.find((t) => t.actor === actor);
  if (!match) {
    return { ok: false, reason: 'wrong_actor' };
  }

  return { ok: true, to: match.to, transition: match };
}

/** Every intent that `actor` could legally send from `phase` in `mode`. */
export function allowedIntents(phase: Phase, actor: Actor, mode: GameMode): Intent[] {
  if (TERMINAL_PHASES.includes(phase)) return [];
  return TRANSITIONS.filter(
    (t) => t.from === phase && t.actor === actor && t.modes.includes(mode),
  ).map((t) => t.intent);
}

/**
 * Where a reconnecting player should land.
 *
 * Reconnection NEVER changes the phase. The player simply rejoins whatever is
 * already happening, with their original seat, role and score intact.
 */
export function phaseOnReconnect(currentPhase: Phase): Phase {
  return currentPhase;
}

/**
 * Guard against stale clients.
 *
 * Every room row carries a version number that increases on each committed
 * change. A client sends the version it believes is current; if it is behind,
 * its request is rejected and it must refresh first.
 */
export function isStaleRequest(clientVersion: number, serverVersion: number): boolean {
  return clientVersion < serverVersion;
}
