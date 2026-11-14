import { useEffect, useState } from 'react';
import { getRoundResult, returnToLobby, type RoundResultSummary } from '../lib/voteService';
import { startMatch } from '../lib/matchService';
import type { PublicPlayer } from '../game/types';

interface RoundResultProps {
  roomId: string;
  roundId: string;
  isHost: boolean;
  players: PublicPlayer[];
  onPlayAgain: () => void;
}

export function RoundResult({
  roomId,
  roundId,
  isHost,
  players,
  onPlayAgain,
}: RoundResultProps) {
  const [result, setResult] = useState<RoundResultSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [countdown, setCountdown] = useState<number | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const data = await getRoundResult(roundId);
        if (!cancelled && data) {
          setResult(data);
          setCountdown(5);
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Failed to load round results');
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    load();

    return () => {
      cancelled = true;
    };
  }, [roundId]);

  useEffect(() => {
    if (countdown === null) return;

    const timer = window.setTimeout(() => {
      setCountdown((remaining) =>
        remaining === null || remaining <= 1 ? null : remaining - 1,
      );
    }, 1000);

    return () => window.clearTimeout(timer);
  }, [countdown]);

  if (loading) {
    return (
      <main className="mx-auto flex min-h-full w-full max-w-md flex-col items-center justify-center px-5 py-8 text-center">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-accent border-t-transparent" />
        <p className="mt-4 text-sm text-muted">Calculating round results...</p>
      </main>
    );
  }

  if (error || !result) {
    return (
      <main className="mx-auto flex min-h-full w-full max-w-md flex-col items-center justify-center px-5 py-8 text-center">
        <p className="text-sm font-semibold text-danger">{error ?? 'Unable to find round results.'}</p>
      </main>
    );
  }

  const eliminatedPlayer = players.find((p) => p.id === result.eliminatedPlayerId);
  const imposterNicknames = players
    .filter((p) => result.imposterPlayerIds.includes(p.id))
    .map((p) => p.nickname)
    .join(', ');

  if (countdown !== null) {
    return (
      <main
        aria-live="assertive"
        aria-label={`The imposter will be revealed in ${countdown} seconds`}
        className="mx-auto flex min-h-full w-full max-w-md flex-col items-center justify-center px-5 py-8 text-center"
      >
        <p className="text-sm font-bold tracking-[0.3em] uppercase text-danger">
          The votes are in
        </p>
        <div className="relative mt-8 grid h-64 w-64 place-items-center rounded-full border-2 border-danger/50 bg-danger/10 shadow-[0_0_70px_var(--color-danger)]">
          <div className="absolute inset-3 rounded-full border border-danger/30" />
          <span key={countdown} className="animate-pulse font-mono text-8xl font-black text-text">
            {countdown}
          </span>
        </div>
        <h1 className="mt-8 text-3xl font-black tracking-wider text-text">
          IMPOSTER REVEAL
        </h1>
        <p className="mt-2 text-sm text-muted">The truth comes out in...</p>
      </main>
    );
  }

  const handleNextRound = async () => {
    setSubmitting(true);
    try {
      await startMatch(roomId);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to start next round');
      setSubmitting(false);
    }
  };

  const handleReturnToLobby = async () => {
    setSubmitting(true);
    try {
      await returnToLobby(roomId);
      onPlayAgain();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to return to lobby');
      setSubmitting(false);
    }
  };

  return (
    <main className="mx-auto flex min-h-full w-full max-w-md flex-col justify-between px-5 py-8">
      {/* Header */}
      <header className="text-center">
        <span className="rounded-full bg-accent/20 px-3 py-1 text-xs font-bold tracking-wider uppercase text-accent">
          Round Over
        </span>
        <h1 className="mt-2 text-3xl font-black text-text">Results & Scoring</h1>
      </header>

      {/* Main Results Card */}
      <div className="my-auto flex flex-col gap-5 py-4">
        <section className="relative overflow-hidden rounded-3xl border-2 border-danger/50 bg-gradient-to-br from-danger/20 via-surface to-surface p-6 text-center shadow-[0_0_40px_var(--color-danger)]">
          <p className="text-xs font-black tracking-[0.3em] uppercase text-danger">
            The mask comes off
          </p>
          <h2 className="mt-3 text-sm font-bold tracking-widest text-muted">
            {result.imposterPlayerIds.length > 1 ? 'THE IMPOSTERS WERE' : 'THE IMPOSTER WAS'}
          </h2>
          <p className="mt-2 break-words text-4xl font-black tracking-wide text-text">
            {imposterNicknames || 'No Imposter'}
          </p>
        </section>

        {/* The Secret Word Reveal */}
        <div className="rounded-3xl border border-border bg-surface p-5 text-center shadow-xl">
          <p className="text-xs font-bold tracking-wider uppercase text-muted">The Secret Word Was</p>
          <p className="mt-1 text-3xl font-black tracking-wide text-text">{result.secretWord}</p>

          <div className="mt-4 flex flex-col gap-1.5 border-t border-border pt-3 text-xs">
            <div className="flex justify-between">
              <span className="text-muted">Imposter(s):</span>
              <span className="font-bold text-danger">{imposterNicknames || 'None'}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted">Eliminated by Vote:</span>
              <span className="font-bold text-text">
                {eliminatedPlayer?.nickname ?? 'Nobody (Tie)'}
              </span>
            </div>
            {result.finalGuessCorrect !== null && (
              <div className="flex justify-between">
                <span className="text-muted">Imposter Final Guess:</span>
                <span
                  className={`font-bold ${
                    result.finalGuessCorrect ? 'text-positive' : 'text-danger'
                  }`}
                >
                  {result.finalGuessCorrect ? '✓ Correct (+2 pts)' : '✕ Incorrect (0 pts)'}
                </span>
              </div>
            )}
          </div>
        </div>

        {/* Score Breakdown for This Round */}
        <section className="rounded-2xl border border-border bg-surface p-4">
          <h2 className="text-xs font-bold tracking-wider uppercase text-muted">
            Round Points Awarded
          </h2>
          <ul className="mt-3 flex flex-col gap-2">
            {result.scoreLines.map((line) => (
              <li
                key={line.playerId}
                className="flex flex-col gap-1 rounded-xl bg-surface-raised p-3 text-xs"
              >
                <div className="flex items-center justify-between">
                  <span className="font-bold text-text">{line.nickname}</span>
                  <span className="font-mono text-sm font-black text-accent">
                    +{line.points} pts
                  </span>
                </div>
                {line.reasons.length > 0 ? (
                  <p className="text-[11px] text-muted">{line.reasons.join(' • ')}</p>
                ) : (
                  <p className="text-[11px] text-muted">No points scored this round</p>
                )}
              </li>
            ))}
          </ul>
        </section>

        {/* Current Match Standings */}
        <section className="rounded-2xl border border-border bg-surface p-4">
          <h2 className="text-xs font-bold tracking-wider uppercase text-muted">
            Total Match Leaderboard
          </h2>
          <div className="mt-2 flex flex-col gap-1.5">
            {[...players]
              .sort((a, b) => b.score - a.score)
              .map((p, idx) => (
                <div
                  key={p.id}
                  className="flex items-center justify-between rounded-lg px-2 py-1 text-xs"
                >
                  <div className="flex items-center gap-2">
                    <span className="font-mono font-bold text-muted">#{idx + 1}</span>
                    <span className="font-semibold text-text">{p.nickname}</span>
                  </div>
                  <span className="font-mono font-bold text-text">{p.score} pts</span>
                </div>
              ))}
          </div>
        </section>

        {/* Host Controls */}
        {isHost ? (
          <div className="flex flex-col gap-2">
            <button
              type="button"
              onClick={handleNextRound}
              disabled={submitting}
              className="min-h-14 rounded-2xl bg-accent text-base font-bold text-accent-contrast shadow-xl active:scale-[0.98] disabled:opacity-40"
            >
              {submitting ? 'Starting...' : 'Start Next Round'}
            </button>
            <button
              type="button"
              onClick={handleReturnToLobby}
              disabled={submitting}
              className="min-h-12 rounded-xl border border-border bg-surface text-xs font-semibold text-text hover:bg-surface-raised"
            >
              Return to Lobby
            </button>
          </div>
        ) : (
          <div className="rounded-xl border border-border bg-surface p-3 text-center text-xs text-muted">
            Waiting for the host to start the next round...
          </div>
        )}
      </div>

      <footer className="text-center">
        <p className="text-xs text-muted">Scores persist across rounds in the same room.</p>
      </footer>
    </main>
  );
}
