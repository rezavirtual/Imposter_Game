import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabaseClient';
import { getRoundInfo, giveClue, advanceTurnByHost, type RoundInfo } from '../lib/clueService';
import { playGentleChime } from '../lib/audio';
import { clueTurnProgress } from '../game/clueOrder';
import type { PublicPlayer } from '../game/types';

interface ClueTurnProps {
  roomId: string;
  roundId: string;
  playerId: string;
  isHost: boolean;
  players: PublicPlayer[];
}

export function ClueTurn({ roundId, playerId, isHost, players }: ClueTurnProps) {
  const [roundInfo, setRoundInfo] = useState<RoundInfo | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [soundEnabled, setSoundEnabled] = useState(true);
  const [timeLeft, setTimeLeft] = useState<number>(30);

  // Load round clue order & turn index
  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const info = await getRoundInfo(roundId);
        if (info && !cancelled) {
          setRoundInfo(info);
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Failed to load clue round');
        }
      }
    }

    load();

    // Subscribe to round changes (turn index advancement)
    const channel = supabase
      .channel(`round:${roundId}`)
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'rounds', filter: `id=eq.${roundId}` },
        (payload) => {
          const updated = payload.new as {
            current_turn_index: number;
            clue_order: string[];
          };
          setRoundInfo((prev) =>
            prev
              ? {
                  ...prev,
                  currentTurnIndex: updated.current_turn_index,
                  clue_order: updated.clue_order ?? prev.clueOrder,
                }
              : null,
          );
          // Reset timer and play subtle chime on next turn
          setTimeLeft(30);
          playGentleChime(soundEnabled);
        },
      )
      .subscribe();

    return () => {
      cancelled = true;
      supabase.removeChannel(channel);
    };
  }, [roundId, soundEnabled]);

  // Guidance timer countdown
  useEffect(() => {
    if (timeLeft <= 0) return;
    const timer = setInterval(() => {
      setTimeLeft((prev) => (prev > 0 ? prev - 1 : 0));
    }, 1000);
    return () => clearInterval(timer);
  }, [timeLeft]);

  if (!roundInfo || roundInfo.clueOrder.length === 0) {
    if (error) {
      return (
        <main className="mx-auto flex min-h-full w-full max-w-md flex-col items-center justify-center px-5 py-8 text-center">
          <p className="text-sm font-semibold text-danger">{error}</p>
        </main>
      );
    }

    return (
      <main className="mx-auto flex min-h-full w-full max-w-md flex-col items-center justify-center px-5 py-8 text-center">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-accent border-t-transparent" />
        <p className="mt-4 text-sm text-muted">Preparing speaking order...</p>
      </main>
    );
  }

  const progress = clueTurnProgress({
    order: roundInfo.clueOrder,
    currentIndex: roundInfo.currentTurnIndex,
    clueRounds: roundInfo.clueRoundCount,
  });
  const activeSpeakerId =
    roundInfo.currentTurnIndex < progress.totalTurns
      ? roundInfo.clueOrder[roundInfo.currentTurnIndex % roundInfo.clueOrder.length]
      : null;
  const isActivePlayer = activeSpeakerId === playerId;
  const activeSpeaker = players.find((p) => p.id === activeSpeakerId);
  const speakerName = activeSpeaker?.nickname ?? 'Player';

  const handleGiveClue = async () => {
    setSubmitting(true);
    setError(null);
    try {
      await giveClue(roundId, playerId, roundInfo.currentTurnIndex);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to advance turn');
      setSubmitting(false);
    }
  };

  const handleHostAdvance = async () => {
    setSubmitting(true);
    setError(null);
    try {
      await advanceTurnByHost(roundId, roundInfo.currentTurnIndex);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to advance turn');
      setSubmitting(false);
    }
  };

  return (
    <main className="mx-auto flex min-h-full w-full max-w-md flex-col justify-between px-5 py-8">
      {/* Header */}
      <header className="flex items-center justify-between">
        <span className="rounded-full bg-surface-raised px-3 py-1 text-xs font-semibold text-muted">
          Clue Round {progress.clueRound} of {roundInfo.clueRoundCount} · Turn{' '}
          {progress.turnInRound} of {progress.playersPerRound}
        </span>
        <button
          type="button"
          onClick={() => setSoundEnabled(!soundEnabled)}
          className="rounded-lg border border-border bg-surface px-2.5 py-1 text-xs text-muted"
        >
          {soundEnabled ? '🔔 Sound On' : '🔕 Muted'}
        </button>
      </header>

      {/* Main Focus Card */}
      <div className="my-auto flex flex-col gap-6">
        <div className="text-center">
          <p className="text-xs font-bold tracking-wider uppercase text-muted">
            {isActivePlayer ? '🎯 Your Turn' : '🎧 Listening Phase'}
          </p>
          <h1 className="mt-2 text-3xl font-black text-text">
            {isActivePlayer ? "It's Your Turn!" : speakerName}
          </h1>
          <p className="mt-2 text-sm text-muted">
            {isActivePlayer
              ? `Give one clue for clue round ${progress.clueRound}.`
              : 'Listen carefully. Do their clues sound genuine?'}
          </p>
        </div>

        {/* Guidance Timer Ring */}
        <div className="flex flex-col items-center">
          <div className="flex h-24 w-24 items-center justify-center rounded-full border-4 border-border bg-surface">
            <span
              className={`font-mono text-3xl font-black ${
                timeLeft <= 5 ? 'text-danger animate-pulse' : 'text-text'
              }`}
            >
              {timeLeft}s
            </span>
          </div>
          <span className="mt-2 text-[11px] text-muted">Guidance timer (face-to-face pace)</span>
        </div>

        {error && (
          <div className="rounded-xl border border-danger/40 bg-danger/10 p-3 text-center text-xs font-semibold text-danger">
            {error}
          </div>
        )}

        {/* Action Controls */}
        {isActivePlayer ? (
          <div className="flex flex-col gap-2">
            <button
              type="button"
              onClick={handleGiveClue}
              disabled={submitting}
              className="min-h-16 w-full rounded-2xl bg-accent text-base font-bold text-accent-contrast shadow-xl active:scale-[0.98] disabled:opacity-50"
            >
              {submitting ? 'Updating...' : "I've Given My Clue"}
            </button>
            <p className="text-center text-xs text-muted">
              Press once you have spoken your clue aloud.
            </p>
          </div>
        ) : (
          <div className="rounded-2xl border border-border bg-surface p-5 text-center">
            <p className="text-sm font-semibold text-text">Waiting for {speakerName} to speak...</p>
            <p className="mt-1 text-xs text-muted">
              Turn advances when {speakerName} taps their screen.
            </p>

            {/* Host rescue control */}
            {isHost && (
              <div className="mt-4 border-t border-border pt-3">
                <button
                  type="button"
                  onClick={handleHostAdvance}
                  disabled={submitting}
                  className="rounded-lg bg-surface-raised px-3 py-1.5 text-xs font-semibold text-warning hover:text-text"
                >
                  Host: Skip / Advance Stuck Turn
                </button>
              </div>
            )}
          </div>
        )}
      </div>

      <footer className="text-center">
        <p className="text-xs text-muted">Clues and deductions happen in person.</p>
      </footer>
    </main>
  );
}
