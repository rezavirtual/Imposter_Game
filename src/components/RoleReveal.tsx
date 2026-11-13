import { useEffect, useState } from 'react';
import type { PrivateRole } from '../game/types';
import { getMyPrivateRole, acknowledgeRole } from '../lib/matchService';

interface RoleRevealProps {
  roundId: string;
  playerId: string;
  roundNumber: number;
  onAllAcknowledged: () => void;
}

export function RoleReveal({
  roundId,
  playerId,
  roundNumber,
  onAllAcknowledged,
}: RoleRevealProps) {
  const [roleData, setRoleData] = useState<PrivateRole | null>(null);
  const [loading, setLoading] = useState(true);
  const [isRevealed, setIsRevealed] = useState(false);
  const [hasAcknowledged, setHasAcknowledged] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Vibration helper if supported
  const triggerHaptic = (ms: number = 20) => {
    if (typeof navigator !== 'undefined' && 'vibrate' in navigator) {
      try {
        navigator.vibrate(ms);
      } catch {
        // Safe fallback
      }
    }
  };

  useEffect(() => {
    let cancelled = false;

    async function loadRole() {
      try {
        const data = await getMyPrivateRole(roundId, playerId);
        if (!cancelled) {
          setRoleData(data);
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Failed to load role');
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    loadRole();

    return () => {
      cancelled = true;
    };
  }, [roundId, playerId]);

  // Press-and-hold handlers
  const handlePressStart = () => {
    setIsRevealed(true);
    triggerHaptic(25);
  };

  const handlePressEnd = () => {
    setIsRevealed(false);
  };

  const handleAcknowledge = async () => {
    setSubmitting(true);
    try {
      const allDone = await acknowledgeRole(roundId, playerId);
      setHasAcknowledged(true);
      if (allDone) {
        onAllAcknowledged();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to acknowledge');
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <main className="mx-auto flex min-h-full w-full max-w-md flex-col items-center justify-center px-5 py-8 text-center">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-accent border-t-transparent" />
        <p className="mt-4 text-sm font-medium text-muted">Assigning secure roles...</p>
      </main>
    );
  }

  if (error || !roleData) {
    return (
      <main className="mx-auto flex min-h-full w-full max-w-md flex-col items-center justify-center px-5 py-8 text-center">
        <p className="text-sm font-semibold text-danger">{error ?? 'Unable to find your role for this round.'}</p>
      </main>
    );
  }

  const isImposter = roleData.role === 'imposter';

  return (
    <main className="secrecy-protected mx-auto flex min-h-full w-full max-w-md flex-col justify-between px-5 py-8">
      {/* Header */}
      <header className="text-center">
        <span className="rounded-full bg-surface-raised px-3 py-1 text-xs font-semibold text-muted">
          Round {roundNumber}
        </span>
        <h1 className="mt-2 text-xl font-bold text-text">Private Role Assignment</h1>
        <p className="mt-1 text-xs text-muted">Keep your screen tilted away from others</p>
      </header>

      {/* Secrecy Card Container */}
      <div className="my-auto flex flex-col items-center gap-6">
        <div className="relative w-full overflow-hidden rounded-3xl border border-border bg-surface p-6 shadow-2xl">
          {/* Secret Content */}
          <div
            className={`flex flex-col items-center text-center transition-opacity duration-150 ${
              isRevealed ? 'opacity-100' : 'pointer-events-none select-none opacity-0'
            }`}
          >
            <span
              className={`rounded-full px-3 py-1 text-xs font-extrabold uppercase tracking-wider ${
                isImposter ? 'bg-danger/20 text-danger' : 'bg-positive/20 text-positive'
              }`}
            >
              {isImposter ? 'Imposter' : 'Regular Player'}
            </span>

            {isImposter ? (
              <div className="my-6 flex flex-col items-center gap-2">
                <span className="text-2xl">🕵️‍♂️</span>
                <p className="text-2xl font-black text-danger">NO SECRET WORD</p>
                {roleData.category ? (
                  <p className="rounded-xl bg-surface-raised px-3 py-1.5 text-xs font-medium text-muted">
                    Category Hint: <span className="font-bold text-text">{roleData.category}</span>
                  </p>
                ) : (
                  <p className="text-xs text-muted">Blend in. Listen to clues to deduce the word.</p>
                )}
              </div>
            ) : (
              <div className="my-6 flex flex-col items-center gap-2">
                <span className="text-xs font-medium uppercase tracking-wider text-muted">
                  Secret Word
                </span>
                <p className="text-3xl font-black tracking-wide text-text">
                  {roleData.secretWord}
                </p>
                {roleData.category && (
                  <p className="rounded-xl bg-surface-raised px-3 py-1.5 text-xs font-medium text-muted">
                    Category: <span className="font-bold text-text">{roleData.category}</span>
                  </p>
                )}
              </div>
            )}

            <p className="text-xs text-muted">{roleData.instruction}</p>
          </div>

          {/* Opaque Secrecy Neutral Cover (visible when not pressing) */}
          {!isRevealed && (
            <div className="absolute inset-0 flex flex-col items-center justify-center bg-surface p-6 text-center">
              <span className="text-3xl">🔒</span>
              <p className="mt-3 text-base font-bold text-text">Information Concealed</p>
              <p className="mt-1 text-xs text-muted">
                Press and hold the button below to view your role
              </p>
            </div>
          )}
        </div>

        {/* Press-and-Hold Button */}
        <div className="flex w-full flex-col gap-3">
          <button
            type="button"
            onPointerDown={handlePressStart}
            onPointerUp={handlePressEnd}
            onPointerCancel={handlePressEnd}
            onPointerLeave={handlePressEnd}
            className={`min-h-16 w-full rounded-2xl text-base font-bold transition-all select-none ${
              isRevealed
                ? 'bg-danger text-accent-contrast scale-[0.98]'
                : 'bg-accent text-accent-contrast active:scale-[0.98]'
            }`}
          >
            {isRevealed ? 'Release to Conceal' : 'Press & Hold to Reveal'}
          </button>

          {isRevealed && (
            <button
              type="button"
              onClick={handlePressEnd}
              className="text-xs font-semibold text-muted hover:text-text"
            >
              Hide immediately
            </button>
          )}
        </div>

        {/* Acknowledge Button */}
        <div className="w-full">
          {!hasAcknowledged ? (
            <button
              type="button"
              onClick={handleAcknowledge}
              disabled={submitting}
              className="min-h-12 w-full rounded-xl border border-border bg-surface text-sm font-semibold text-text active:opacity-75 disabled:opacity-50"
            >
              {submitting ? 'Confirming...' : "I've Memorized My Role"}
            </button>
          ) : (
            <div className="flex items-center justify-center gap-2 rounded-xl bg-positive/10 p-3 text-xs font-semibold text-positive">
              <span>✓ Ready</span>
              <span className="text-muted">• Waiting for others...</span>
            </div>
          )}
        </div>
      </div>

      <footer className="text-center">
        <p className="text-xs text-muted">Do not speak until all players are ready.</p>
      </footer>
    </main>
  );
}
