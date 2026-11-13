import { useState } from 'react';
import type { PublicPlayer } from '../game/types';
import { castVote } from '../lib/voteService';

interface VotingBallotProps {
  roundId: string;
  playerId: string;
  isRevote: boolean;
  players: PublicPlayer[];
  allowNoImposter?: boolean;
}

export function VotingBallot({
  roundId,
  playerId,
  isRevote,
  players,
  allowNoImposter = false,
}: VotingBallotProps) {
  const [selectedTargetId, setSelectedTargetId] = useState<string | null>(null);
  const [selectedNoImposter, setSelectedNoImposter] = useState(false);
  const [locked, setLocked] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Exclude self from voting targets
  const eligibleTargets = players.filter((p) => p.id !== playerId && !p.isEliminated);

  const handleLockVote = async () => {
    if (!selectedTargetId && !selectedNoImposter) {
      setError('Please select a player to vote for.');
      return;
    }

    setSubmitting(true);
    setError(null);
    try {
      await castVote(roundId, playerId, selectedTargetId, selectedNoImposter);
      setLocked(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to cast vote');
      setSubmitting(false);
    }
  };

  return (
    <main className="mx-auto flex min-h-full w-full max-w-md flex-col justify-between px-5 py-8">
      {/* Header */}
      <header className="text-center">
        <span
          className={`rounded-full px-3 py-1 text-xs font-bold tracking-wider uppercase ${
            isRevote ? 'bg-warning/20 text-warning' : 'bg-surface-raised text-muted'
          }`}
        >
          {isRevote ? '⚠️ Tied Revote' : 'Secret Ballot'}
        </span>
        <h1 className="mt-2 text-3xl font-black text-text">
          {isRevote ? 'Revote: Break the Tie' : 'Cast Your Vote'}
        </h1>
        <p className="mt-1 text-xs text-muted">
          {isRevote
            ? 'Vote only among the tied suspects.'
            : 'Who do you suspect is the Imposter?'}
        </p>
      </header>

      {/* Ballot Area */}
      <div className="my-auto flex flex-col gap-4">
        {error && (
          <div className="rounded-xl border border-danger/40 bg-danger/10 p-3 text-center text-xs font-semibold text-danger">
            {error}
          </div>
        )}

        {!locked ? (
          <div className="flex flex-col gap-2.5">
            {eligibleTargets.map((target) => {
              const isSelected = selectedTargetId === target.id && !selectedNoImposter;
              return (
                <button
                  key={target.id}
                  type="button"
                  onClick={() => {
                    setSelectedTargetId(target.id);
                    setSelectedNoImposter(false);
                  }}
                  className={`flex min-h-14 items-center justify-between rounded-2xl border px-4 py-3 text-left transition-all ${
                    isSelected
                      ? 'border-accent bg-accent/15 text-text scale-[1.01]'
                      : 'border-border bg-surface text-text hover:border-muted active:scale-[0.99]'
                  }`}
                >
                  <span className="text-base font-semibold">{target.nickname}</span>
                  <div
                    className={`flex h-5 w-5 items-center justify-center rounded-full border ${
                      isSelected ? 'border-accent bg-accent text-accent-contrast' : 'border-border'
                    }`}
                  >
                    {isSelected && '✓'}
                  </div>
                </button>
              );
            })}

            {/* Double Agent Mode Option */}
            {allowNoImposter && (
              <button
                type="button"
                onClick={() => {
                  setSelectedNoImposter(true);
                  setSelectedTargetId(null);
                }}
                className={`flex min-h-14 items-center justify-between rounded-2xl border px-4 py-3 text-left transition-all ${
                  selectedNoImposter
                    ? 'border-warning bg-warning/15 text-text scale-[1.01]'
                    : 'border-border bg-surface text-text hover:border-muted active:scale-[0.99]'
                }`}
              >
                <div>
                  <span className="text-base font-semibold">No Imposter</span>
                  <p className="text-[11px] text-muted">Claim that both players are innocent</p>
                </div>
                <div
                  className={`flex h-5 w-5 items-center justify-center rounded-full border ${
                    selectedNoImposter ? 'border-warning bg-warning text-accent-contrast' : 'border-border'
                  }`}
                >
                  {selectedNoImposter && '✓'}
                </div>
              </button>
            )}

            <button
              type="button"
              onClick={handleLockVote}
              disabled={submitting || (!selectedTargetId && !selectedNoImposter)}
              className="mt-4 min-h-16 rounded-2xl bg-accent text-base font-bold text-accent-contrast shadow-xl active:scale-[0.98] disabled:opacity-40"
            >
              {submitting ? 'Locking in...' : 'Lock In Vote'}
            </button>
            <p className="text-center text-xs text-muted">
              Once locked, your vote cannot be changed.
            </p>
          </div>
        ) : (
          <div className="rounded-3xl border border-positive/30 bg-surface p-6 text-center shadow-xl">
            <span className="text-4xl">🔒</span>
            <h2 className="mt-3 text-lg font-bold text-positive">Vote Locked In</h2>
            <p className="mt-2 text-sm text-muted">
              Your ballot has been securely submitted.
            </p>
            <div className="mt-4 rounded-xl bg-surface-raised p-3 text-xs font-medium text-muted">
              Waiting for all players to lock in their votes...
            </div>
          </div>
        )}
      </div>

      <footer className="text-center">
        <p className="text-xs text-muted">Votes are private and simultaneous.</p>
      </footer>
    </main>
  );
}
