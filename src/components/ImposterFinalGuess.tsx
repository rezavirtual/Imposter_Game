import { useState } from 'react';
import { judgeFinalGuess } from '../lib/voteService';
import type { PublicPlayer } from '../game/types';

interface ImposterFinalGuessProps {
  roundId: string;
  isHost: boolean;
  playerId: string;
  players: PublicPlayer[];
}

export function ImposterFinalGuess({
  roundId,
  isHost,
}: ImposterFinalGuessProps) {
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleJudge = async (correct: boolean) => {
    setSubmitting(true);
    setError(null);
    try {
      await judgeFinalGuess(roundId, correct);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to record decision');
      setSubmitting(false);
    }
  };

  return (
    <main className="mx-auto flex min-h-full w-full max-w-md flex-col justify-between px-5 py-8">
      {/* Header */}
      <header className="text-center">
        <span className="rounded-full bg-danger/20 px-3 py-1 text-xs font-bold tracking-wider uppercase text-danger">
          Caught Imposter
        </span>
        <h1 className="mt-2 text-3xl font-black text-text">Final Guess</h1>
        <p className="mt-1 text-xs text-muted">
          The eliminated player must guess the secret word out loud.
        </p>
      </header>

      {/* Main Focus */}
      <div className="my-auto flex flex-col gap-6">
        <section className="rounded-3xl border border-danger/30 bg-surface p-6 text-center shadow-xl">
          <span className="text-4xl">🎯</span>
          <h2 className="mt-3 text-xl font-black text-text">Last Chance Escape</h2>
          <p className="mt-2 text-sm text-muted">
            The caught Imposter now speaks their single guess face-to-face.
          </p>
          <div className="mt-4 rounded-xl bg-surface-raised p-3 text-xs font-semibold text-warning">
            +2 Points if correct • 0 Points if incorrect
          </div>
        </section>

        {error && (
          <div className="rounded-xl border border-danger/40 bg-danger/10 p-3 text-center text-xs font-semibold text-danger">
            {error}
          </div>
        )}

        {/* Controls */}
        {isHost ? (
          <div className="flex flex-col gap-3">
            <p className="text-center text-xs font-bold uppercase tracking-wider text-muted">
              Host Decision
            </p>
            <div className="flex gap-3">
              <button
                type="button"
                onClick={() => handleJudge(true)}
                disabled={submitting}
                className="min-h-16 flex-1 rounded-2xl bg-positive text-base font-bold text-accent-contrast shadow-lg active:scale-[0.98] disabled:opacity-40"
              >
                ✓ Correct
              </button>
              <button
                type="button"
                onClick={() => handleJudge(false)}
                disabled={submitting}
                className="min-h-16 flex-1 rounded-2xl bg-danger text-base font-bold text-accent-contrast shadow-lg active:scale-[0.98] disabled:opacity-40"
              >
                ✕ Incorrect
              </button>
            </div>
            <p className="text-center text-xs text-muted">
              Judge based on the word spoken out loud at the table.
            </p>
          </div>
        ) : (
          <div className="rounded-2xl border border-border bg-surface p-5 text-center">
            <p className="text-sm font-semibold text-text">
              Waiting for the host to confirm the guess...
            </p>
            <p className="mt-1 text-xs text-muted">
              Listen to the guess spoken at your table.
            </p>
          </div>
        )}
      </div>

      <footer className="text-center">
        <p className="text-xs text-muted">The secret word will be revealed to everyone next.</p>
      </footer>
    </main>
  );
}
