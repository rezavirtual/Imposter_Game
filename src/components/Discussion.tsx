import { useState } from 'react';
import { startVoting } from '../lib/clueService';
import type { PublicPlayer } from '../game/types';

interface DiscussionProps {
  roomId: string;
  isHost: boolean;
  players: PublicPlayer[];
}

export function Discussion({ roomId, isHost, players }: DiscussionProps) {
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleStartVoting = async () => {
    setSubmitting(true);
    setError(null);
    try {
      await startVoting(roomId);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to start voting');
      setSubmitting(false);
    }
  };

  return (
    <main className="mx-auto flex min-h-full w-full max-w-md flex-col justify-between px-5 py-8">
      {/* Header */}
      <header className="text-center">
        <span className="rounded-full bg-accent/20 px-3 py-1 text-xs font-bold tracking-wider uppercase text-accent">
          Face-to-Face Discussion
        </span>
        <h1 className="mt-2 text-3xl font-black text-text">Debate & Interrogate</h1>
        <p className="mt-1 text-xs text-muted">All clues have been spoken</p>
      </header>

      {/* Main Discussion Card */}
      <div className="my-auto flex flex-col gap-6">
        <section className="rounded-3xl border border-border bg-surface p-6 text-center shadow-xl">
          <span className="text-4xl">🗣️</span>
          <h2 className="mt-3 text-lg font-bold text-text">Who is the Imposter?</h2>
          <p className="mt-2 text-sm text-muted">
            Question any clue that seemed too vague, hesitant, or completely off-topic.
          </p>

          <div className="mt-5 rounded-2xl bg-surface-raised p-4 text-left">
            <p className="text-xs font-bold tracking-wider uppercase text-muted">Active Players</p>
            <div className="mt-2 flex flex-wrap gap-2">
              {players.map((p) => (
                <span
                  key={p.id}
                  className="rounded-lg bg-surface px-2.5 py-1 text-xs font-semibold text-text"
                >
                  {p.nickname}
                </span>
              ))}
            </div>
          </div>
        </section>

        {error && (
          <div className="rounded-xl border border-danger/40 bg-danger/10 p-3 text-center text-xs font-semibold text-danger">
            {error}
          </div>
        )}

        {/* Voting Trigger */}
        {isHost ? (
          <div className="flex flex-col gap-2">
            <button
              type="button"
              onClick={handleStartVoting}
              disabled={submitting}
              className="min-h-16 w-full rounded-2xl bg-accent text-base font-bold text-accent-contrast shadow-xl active:scale-[0.98] disabled:opacity-50"
            >
              {submitting ? 'Opening Ballots...' : 'Open Voting Now'}
            </button>
            <p className="text-center text-xs text-muted">
              Press when the room is ready to cast private votes.
            </p>
          </div>
        ) : (
          <div className="rounded-2xl border border-border bg-surface p-5 text-center">
            <p className="text-sm font-semibold text-text">Discuss openly with the group</p>
            <p className="mt-1 text-xs text-muted">The host will open secret voting shortly.</p>
          </div>
        )}
      </div>

      <footer className="text-center">
        <p className="text-xs text-muted">Trust your instincts. Voting is simultaneous & private.</p>
      </footer>
    </main>
  );
}
