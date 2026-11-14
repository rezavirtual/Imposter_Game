/**
 * CORE DOMAIN TYPES
 * -----------------
 * The shared vocabulary of the whole game. These types are used by the pure
 * rules engine, by the React screens, and (mirrored) by the database.
 *
 * IMPORTANT SECURITY NOTE
 * There are two different "views" of a player:
 *   - PublicPlayer  : safe to send to every phone in the room.
 *   - PrivateRole   : sent ONLY to the one device it belongs to.
 * Never add a role, secret word or vote target to PublicPlayer. The imposter
 * must not be inferable from anything the whole room can see.
 */

// ---------------------------------------------------------------------------
// Identifiers
// ---------------------------------------------------------------------------

/** A 4-character room code, e.g. "KXQ7". Always stored uppercase. */
export type RoomCode = string;

/** Opaque database id for a player (a UUID). Never encodes the role. */
export type PlayerId = string;

/** Opaque database id for a round. */
export type RoundId = string;

// ---------------------------------------------------------------------------
// Game modes
// ---------------------------------------------------------------------------

/**
 * Game modes are kept strictly separate so that the experimental 2-player
 * rules can never leak into the standard state machine.
 */
export type GameMode =
  /** 4-10 players. The normal game. */
  | 'standard'
  /** Exactly 3 players. Standard rules, different balance advice. */
  | 'three_player'
  /** Exactly 2 players. Experimental. Zero OR one imposter. */
  | 'double_agent';

export const MIN_PLAYERS = 2;
export const MAX_PLAYERS = 10;

// ---------------------------------------------------------------------------
// Roles
// ---------------------------------------------------------------------------

export type Role = 'regular' | 'imposter';

/**
 * What a single device is allowed to know about ITSELF.
 * This object is only ever delivered to the owning player.
 */
export interface PrivateRole {
  playerId: PlayerId;
  roundId: RoundId;
  role: Role;
  /** The secret word. `null` for imposters — always, with no exception. */
  secretWord: string | null;
  /** Regular players see the category; imposters receive it as their clue. */
  category: string | null;
  /** Short plain-language instruction shown under the role. */
  instruction: string;
}

// ---------------------------------------------------------------------------
// Connection
// ---------------------------------------------------------------------------

export type ConnectionStatus =
  /** Device is live and sending heartbeats. */
  | 'connected'
  /** Heartbeat lapsed. Seat, role and score are held for 2 minutes. */
  | 'reconnecting'
  /** Recovery window expired, or the host removed them. */
  | 'disconnected';

// ---------------------------------------------------------------------------
// Players
// ---------------------------------------------------------------------------

/**
 * The ONLY shape of player data that may be broadcast to the whole room.
 * Deliberately contains no role, no word, no vote.
 */
export interface PublicPlayer {
  id: PlayerId;
  nickname: string;
  isHost: boolean;
  connection: ConnectionStatus;
  /** Cumulative standard-mode score across the match. */
  score: number;
  /** Used to pick the longest-connected player for host transfer. */
  joinedAt: string;
  /** True once this player has locked a vote. Which target is NOT revealed. */
  hasLockedVote: boolean;
  /** True if eliminated this round. Does not reveal whether they were imposter. */
  isEliminated: boolean;
}

// ---------------------------------------------------------------------------
// Host settings
// ---------------------------------------------------------------------------

export type MatchEndMode = 'fixed_rounds' | 'target_score' | 'host_manual';
export type FixedRoundCount = 3 | 5 | 7 | 10;
export type ImposterCountMode = 'automatic' | 'manual';
export type Difficulty = 'easy' | 'medium' | 'hard';
export type AgeGroup = 'family' | 'teen' | 'adult';
export type ClueTimerSeconds = 15 | 20 | 30 | 45 | 60;

export interface HostSettings {
  matchEndMode: MatchEndMode;
  /** Used when matchEndMode is 'fixed_rounds'. */
  fixedRounds: FixedRoundCount;
  /** Used when matchEndMode is 'target_score'. */
  targetScore: number;

  imposterCountMode: ImposterCountMode;
  /** Used when imposterCountMode is 'manual'. */
  manualImposterCount: number;

  imposterInfo: 'category_hint';

  /** Word-pack selectors. 'any' means no restriction. */
  category: string;
  difficulty: Difficulty;
  region: string;
  ageGroup: AgeGroup;

  themeId: string;

  /** `null` means the guidance timer is switched off. */
  clueTimerSeconds: ClueTimerSeconds | null;

  /** May an imposter be chosen to give the first clue? */
  allowImposterFirst: boolean;

  /** May the host reveal who voted for whom, AFTER the result is final? */
  allowVoteReveal: boolean;
}

// ---------------------------------------------------------------------------
// Voting
// ---------------------------------------------------------------------------

/**
 * A vote target. In Double Agent Mode a player may instead claim there is no
 * imposter at all, which is why this is not simply a PlayerId.
 */
export type VoteTarget = { kind: 'player'; playerId: PlayerId } | { kind: 'no_imposter' };

/** Public vote progress. Shows HOW MANY have voted, never WHO they picked. */
export interface VoteProgress {
  lockedCount: number;
  eligibleCount: number;
}

/** Per-target totals, published only after the result is finalized. */
export interface VoteTally {
  target: VoteTarget;
  count: number;
}
