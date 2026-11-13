/**
 * ROOM SERVICE
 * ------------
 * Client-side interface to the server-authoritative room RPCs.
 */

import { supabase } from './supabaseClient';
import { ensureAnonymousSession } from './auth';
import type { HostSettings } from '../game/types';
import { defaultHostSettings } from '../game/settings';

export interface RoomJoinResult {
  roomId: string;
  playerId: string;
  code: string;
  isHost: boolean;
  reconnected: boolean;
}

/**
 * Creates a brand new room. The creator automatically becomes the host.
 */
export async function createRoom(
  nickname: string,
  settings?: Partial<HostSettings>,
): Promise<RoomJoinResult> {
  await ensureAnonymousSession();

  const finalSettings = {
    ...defaultHostSettings(4),
    ...settings,
  };

  const { data, error } = await supabase.rpc('create_room', {
    p_nickname: nickname,
    p_settings: finalSettings,
  });

  if (error) {
    throw new Error(error.message);
  }

  return {
    roomId: data.roomId,
    playerId: data.playerId,
    code: data.code,
    isHost: true,
    reconnected: false,
  };
}

/**
 * Joins an existing room using its 4-character code and player nickname.
 */
export async function joinRoom(code: string, nickname: string): Promise<RoomJoinResult> {
  await ensureAnonymousSession();

  const { data, error } = await supabase.rpc('join_room', {
    p_code: code.trim().toUpperCase(),
    p_nickname: nickname.trim(),
  });

  if (error) {
    throw new Error(error.message);
  }

  return {
    roomId: data.roomId,
    playerId: data.playerId,
    code: data.code,
    isHost: data.isHost,
    reconnected: data.reconnected,
  };
}

/**
 * Sends a lightweight heartbeat to keep the player marked as 'connected'.
 */
export async function sendHeartbeat(playerId: string): Promise<void> {
  await supabase.rpc('player_heartbeat', { p_player_id: playerId });
}
