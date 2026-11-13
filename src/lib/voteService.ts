/**
 * VOTE SERVICE
 * ------------
 * Client interface for secret voting, final guess judging, and results.
 */

import { supabase } from './supabaseClient';

export interface CastVoteResult {
  ok: boolean;
  allLocked?: boolean;
  tied?: boolean;
  revote?: boolean;
  lockedCount?: number;
  eligibleCount?: number;
}

export interface RoundResultSummary {
  roundId: string;
  secretWord: string;
  eliminatedPlayerId: string | null;
  eliminatedWasImposter: boolean;
  finalGuessCorrect: boolean | null;
  imposterPlayerIds: string[];
  tallies: Array<{ targetId: string | null; isNoImposter: boolean; count: number }>;
  scoreLines: Array<{
    playerId: string;
    nickname: string;
    points: number;
    reasons: string[];
  }>;
}

/**
 * Casts a private, simultaneous vote.
 */
export async function castVote(
  roundId: string,
  voterId: string,
  targetId: string | null,
  isNoImposter: boolean = false,
): Promise<CastVoteResult> {
  const idempotencyKey = `vote_${roundId}_${voterId}_${Date.now()}`;

  const { data, error } = await supabase.rpc('cast_vote', {
    p_round_id: roundId,
    p_voter_id: voterId,
    p_target_id: targetId,
    p_is_no_imposter: isNoImposter,
    p_idempotency_key: idempotencyKey,
  });

  if (error) {
    throw new Error(error.message);
  }

  return data as CastVoteResult;
}

/**
 * Host judges the spoken final guess of the caught imposter.
 */
export async function judgeFinalGuess(
  roundId: string,
  guessCorrect: boolean,
): Promise<void> {
  const idempotencyKey = `judge_${roundId}_${Date.now()}`;

  const { error } = await supabase.rpc('judge_final_guess', {
    p_round_id: roundId,
    p_guess_correct: guessCorrect,
    p_idempotency_key: idempotencyKey,
  });

  if (error) {
    throw new Error(error.message);
  }
}

/**
 * Loads the finalized round result (only visible once phase is round_result).
 */
export async function getRoundResult(roundId: string): Promise<RoundResultSummary | null> {
  const { data, error } = await supabase
    .from('round_results')
    .select('round_id, secret_word, eliminated_player_id, eliminated_was_imposter, final_guess_correct, imposter_player_ids, tallies, score_lines')
    .eq('round_id', roundId)
    .maybeSingle();

  if (error || !data) return null;

  return {
    roundId: data.round_id,
    secretWord: data.secret_word,
    eliminatedPlayerId: data.eliminated_player_id,
    eliminatedWasImposter: data.eliminated_was_imposter,
    finalGuessCorrect: data.final_guess_correct,
    imposterPlayerIds: data.imposter_player_ids ?? [],
    tallies: data.tallies ?? [],
    scoreLines: data.score_lines ?? [],
  };
}

/**
 * Host resets room back to lobby for the next match.
 */
export async function returnToLobby(roomId: string): Promise<void> {
  const { error } = await supabase.rpc('return_to_lobby', {
    p_room_id: roomId,
  });

  if (error) {
    throw new Error(error.message);
  }
}
