/**
 * MATCH SERVICE
 * -------------
 * Server-authoritative match starting and private role fetching.
 */

import { supabase } from './supabaseClient';
import type { PrivateRole } from '../game/types';

/**
 * Host action to start a round.
 * Generates an idempotency key to prevent double clicks from creating multiple rounds.
 */
export async function startMatch(roomId: string): Promise<void> {
  const idempotencyKey = `start_${roomId}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

  const { error } = await supabase.rpc('start_match', {
    p_room_id: roomId,
    p_idempotency_key: idempotencyKey,
  });

  if (error) {
    throw new Error(error.message);
  }
}

/**
 * Fetches the caller's private role for the current round.
 * Row Level Security ensures callers only ever receive their own row.
 */
export async function getMyPrivateRole(
  roundId: string,
  playerId: string,
): Promise<PrivateRole | null> {
  const { data, error } = await supabase
    .from('round_roles')
    .select('round_id, player_id, role, secret_word, category, instruction')
    .eq('round_id', roundId)
    .eq('player_id', playerId)
    .maybeSingle();

  if (error || !data) {
    return null;
  }

  return {
    roundId: data.round_id,
    playerId: data.player_id,
    role: data.role as 'regular' | 'imposter',
    secretWord: data.secret_word,
    category: data.category,
    instruction: data.instruction,
  };
}

/**
 * Player acknowledges they have seen their role.
 * When all players have acknowledged, the server advances to clue turns.
 */
export async function acknowledgeRole(roundId: string, playerId: string): Promise<boolean> {
  const { data, error } = await supabase.rpc('acknowledge_role', {
    p_round_id: roundId,
    p_player_id: playerId,
  });

  if (error) {
    throw new Error(error.message);
  }

  return !!data?.allAcknowledged;
}
