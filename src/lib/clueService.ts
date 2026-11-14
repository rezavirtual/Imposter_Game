/**
 * CLUE SERVICE
 * ------------
 * Handles clue turn progression and discussion -> voting trigger.
 */

import { supabase } from './supabaseClient';
import { clueRoundCountFromSettings } from '../game/settings';
import type { ClueRoundCount } from '../game/types';

export interface RoundInfo {
  id: string;
  roundNumber: number;
  clueOrder: string[];
  currentTurnIndex: number;
  clueRoundCount: ClueRoundCount;
}

/**
 * Fetches the public round info (clue order, current turn index).
 */
export async function getRoundInfo(roundId: string): Promise<RoundInfo | null> {
  const { data, error } = await supabase
    .from('rounds')
    .select('id, room_id, round_number, clue_order, current_turn_index')
    .eq('id', roundId)
    .maybeSingle();

  if (error) throw new Error(error.message);
  if (!data) return null;

  const { data: room, error: roomError } = await supabase
    .from('rooms')
    .select('settings')
    .eq('id', data.room_id)
    .maybeSingle();

  if (roomError) throw new Error(roomError.message);
  if (!room) return null;

  return {
    id: data.id,
    roundNumber: data.round_number,
    clueOrder: data.clue_order ?? [],
    currentTurnIndex: data.current_turn_index,
    clueRoundCount: clueRoundCountFromSettings(room.settings),
  };
}

/**
 * Active player signals they have spoken their clue.
 */
export async function giveClue(
  roundId: string,
  playerId: string,
  expectedIndex: number,
): Promise<{ nextIndex: number; isComplete: boolean }> {
  const idempotencyKey = `clue_${roundId}_${expectedIndex}_${Date.now()}`;

  const { data, error } = await supabase.rpc('give_clue', {
    p_round_id: roundId,
    p_player_id: playerId,
    p_expected_index: expectedIndex,
    p_idempotency_key: idempotencyKey,
  });

  if (error) {
    throw new Error(error.message);
  }

  return {
    nextIndex: data.nextIndex,
    isComplete: data.isComplete,
  };
}

/**
 * Host advances turn for an unresponsive or disconnected player.
 */
export async function advanceTurnByHost(
  roundId: string,
  expectedIndex: number,
): Promise<{ nextIndex: number; isComplete: boolean }> {
  const idempotencyKey = `host_adv_${roundId}_${expectedIndex}_${Date.now()}`;

  const { data, error } = await supabase.rpc('advance_turn_by_host', {
    p_round_id: roundId,
    p_expected_index: expectedIndex,
    p_idempotency_key: idempotencyKey,
  });

  if (error) {
    throw new Error(error.message);
  }

  return {
    nextIndex: data.nextIndex,
    isComplete: data.isComplete,
  };
}

/**
 * Host ends discussion and starts voting.
 */
export async function startVoting(roomId: string): Promise<void> {
  const idempotencyKey = `vote_start_${roomId}_${Date.now()}`;

  const { error } = await supabase.rpc('start_voting', {
    p_room_id: roomId,
    p_idempotency_key: idempotencyKey,
  });

  if (error) {
    throw new Error(error.message);
  }
}
