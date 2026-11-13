import { lazy, Suspense, useEffect, useState } from 'react';
import { supabase } from '../lib/supabaseClient';
import { sendHeartbeat } from '../lib/roomService';
import { startMatch } from '../lib/matchService';
import { createRoomShareUrl } from '../game/roomShare';
import type { PublicPlayer } from '../game/types';

const QRCodeSVG = lazy(() =>
  import('qrcode.react').then(({ QRCodeSVG: QRCode }) => ({ default: QRCode })),
);

interface LobbyProps {
  roomId: string;
  playerId: string;
  roomCode: string;
  isHost: boolean;
  nickname: string;
  onMatchStarted: (roundId: string, roundNumber: number) => void;
  onLeave: () => void;
}

export function Lobby({
  roomId,
  playerId,
  roomCode,
  isHost,
  onMatchStarted,
  onLeave,
}: LobbyProps) {
  const [players, setPlayers] = useState<PublicPlayer[]>([]);
  const [copied, setCopied] = useState(false);
  const [shareCopied, setShareCopied] = useState(false);
  const [shareError, setShareError] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const [startError, setStartError] = useState<string | null>(null);
  const shareUrl = createRoomShareUrl(roomCode, window.location.href);

  // Heartbeat every 25 seconds to maintain active status
  useEffect(() => {
    sendHeartbeat(playerId);
    const interval = setInterval(() => {
      sendHeartbeat(playerId);
    }, 25_000);
    return () => clearInterval(interval);
  }, [playerId]);

  // Load players and subscribe to real-time room changes
  useEffect(() => {
    let cancelled = false;

    async function fetchPlayers() {
      const { data } = await supabase
        .from('players')
        .select('id, nickname, is_host, connection, score, joined_at, is_eliminated')
        .eq('room_id', roomId)
        .is('removed_at', null)
        .order('joined_at', { ascending: true });

      if (data && !cancelled) {
        setPlayers(
          data.map((p) => ({
            id: p.id,
            nickname: p.nickname,
            isHost: p.is_host,
            connection: p.connection,
            score: p.score,
            joinedAt: p.joined_at,
            hasLockedVote: false,
            isEliminated: p.is_eliminated,
          })),
        );
      }
    }

    fetchPlayers();

    // Check current room phase immediately
    async function checkRoomPhase() {
      const { data } = await supabase
        .from('rooms')
        .select('phase, current_round_id, round_number')
        .eq('id', roomId)
        .maybeSingle();

      if (data && data.phase === 'private_role_reveal' && data.current_round_id && !cancelled) {
        onMatchStarted(data.current_round_id, data.round_number);
      }
    }

    checkRoomPhase();

    // Realtime channel for both players and room phase transitions
    const channel = supabase
      .channel(`room:${roomId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'players', filter: `room_id=eq.${roomId}` },
        () => {
          fetchPlayers();
        },
      )
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'rooms', filter: `id=eq.${roomId}` },
        (payload) => {
          const updated = payload.new as {
            phase: string;
            current_round_id: string | null;
            round_number: number;
          };
          if (updated.phase === 'private_role_reveal' && updated.current_round_id) {
            onMatchStarted(updated.current_round_id, updated.round_number);
          }
        },
      )
      .subscribe();

    return () => {
      cancelled = true;
      supabase.removeChannel(channel);
    };
  }, [roomId, onMatchStarted]);

  const handleStart = async () => {
    setStarting(true);
    setStartError(null);
    try {
      await startMatch(roomId);
    } catch (err) {
      setStartError(err instanceof Error ? err.message : 'Failed to start match');
      setStarting(false);
    }
  };

  const copyCode = async () => {
    try {
      await navigator.clipboard.writeText(roomCode);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Fallback
    }
  };

  const copyShareUrl = async () => {
    setShareError(null);
    try {
      await navigator.clipboard.writeText(shareUrl);
      setShareCopied(true);
      setTimeout(() => setShareCopied(false), 2000);
    } catch {
      setShareError('Could not copy the invite link. Players can scan the QR code or enter the room code.');
    }
  };

  return (
    <main className="mx-auto flex min-h-full w-full max-w-md flex-col justify-between px-5 py-8">
      {/* Header */}
      <header className="flex items-center justify-between">
        <button
          type="button"
          onClick={onLeave}
          className="text-xs font-semibold text-muted hover:text-text"
        >
          ← Leave Room
        </button>
        <span className="rounded-full bg-surface-raised px-3 py-1 text-xs font-medium text-muted">
          {players.length} / 10 Players
        </span>
      </header>

      {/* Room Code Card */}
      <div className="my-auto flex flex-col gap-6">
        <div className="text-center">
          <p className="text-xs font-semibold tracking-wider uppercase text-muted">Room Code</p>
          <div className="mt-2 flex items-center justify-center gap-3">
            <span className="font-mono text-5xl font-black tracking-widest text-text">
              {roomCode}
            </span>
            <button
              type="button"
              onClick={copyCode}
              aria-label="Copy room code"
              className="rounded-xl border border-border bg-surface p-2.5 text-text active:scale-95"
            >
              {copied ? '✓' : '📋'}
            </button>
          </div>
          <p className="mt-2 text-xs text-muted">Share this code with players at your table</p>
        </div>

        {isHost && (
          <section className="flex flex-col items-center gap-3 rounded-2xl border border-border bg-surface p-5 text-center">
            <h2 className="text-xs font-bold tracking-wider uppercase text-muted">Invite Players</h2>
            <div className="rounded-xl bg-white p-2">
              <Suspense fallback={<div className="h-[200px] w-[200px]" aria-label="Loading QR code" />}>
                <QRCodeSVG value={shareUrl} size={184} level="M" includeMargin />
              </Suspense>
            </div>
            <p className="text-xs text-muted">Scan to open the join form with this room code filled in.</p>
            <button
              type="button"
              onClick={copyShareUrl}
              className="min-h-11 w-full rounded-xl border border-border bg-surface-raised px-4 text-sm font-semibold text-text active:opacity-75"
            >
              {shareCopied ? 'Invite Link Copied' : 'Copy Invite Link'}
            </button>
            {shareError && <p role="alert" className="text-xs text-danger">{shareError}</p>}
            <p className="break-all text-[10px] text-muted">{shareUrl}</p>
            <p className="text-xs text-muted">
              For Internet play, open this app from its public HTTPS address before sharing.
            </p>
          </section>
        )}

        {/* Players List */}
        <section className="rounded-2xl border border-border bg-surface p-5">
          <h2 className="text-xs font-bold tracking-wider uppercase text-muted">
            Players in Lobby
          </h2>
          <ul className="mt-3 flex flex-col gap-2">
            {players.map((p) => (
              <li
                key={p.id}
                className="flex items-center justify-between rounded-xl bg-surface-raised px-4 py-3"
              >
                <div className="flex items-center gap-2">
                  <span className="text-sm font-semibold text-text">{p.nickname}</span>
                  {p.id === playerId && (
                    <span className="rounded-md bg-accent/20 px-1.5 py-0.5 text-[10px] font-bold text-accent">
                      YOU
                    </span>
                  )}
                </div>
                {p.isHost && (
                  <span className="rounded-full bg-warning/20 px-2 py-0.5 text-[10px] font-bold text-warning">
                    HOST
                  </span>
                )}
              </li>
            ))}
          </ul>
        </section>

        {/* Action Button */}
        {isHost ? (
          <div className="flex flex-col gap-2">
            {startError && (
              <p className="rounded-xl bg-danger/10 p-2.5 text-center text-xs font-semibold text-danger">
                {startError}
              </p>
            )}
            <button
              type="button"
              onClick={handleStart}
              disabled={players.length < 2 || starting}
              className="min-h-14 rounded-2xl bg-accent text-base font-bold text-accent-contrast shadow-lg disabled:opacity-40"
            >
              {starting
                ? 'Assigning Secret Roles...'
                : players.length < 2
                  ? 'Waiting for players (min 2)...'
                  : 'Start Match'}
            </button>
            {players.length < 2 && (
              <p className="text-center text-xs text-muted">
                Need at least 2 players to start a game.
              </p>
            )}
          </div>
        ) : (
          <div className="rounded-2xl border border-border bg-surface p-4 text-center">
            <p className="text-sm font-medium text-text">Waiting for host to start...</p>
            <p className="mt-1 text-xs text-muted">Sit back and keep this screen open.</p>
          </div>
        )}
      </div>

      <footer className="text-center">
        <p className="text-xs text-muted">Conversation & clue-giving happen face-to-face.</p>
      </footer>
    </main>
  );
}
