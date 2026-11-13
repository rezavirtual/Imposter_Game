import { useEffect, useState } from 'react';
import { checkConnection, type ConnectionResult } from '../lib/connectionCheck';

/**
 * Setup diagnostic shown during development.
 *
 * It answers one question in plain language: can this device actually reach
 * the game's database? Every failure it reports names the exact place in the
 * Supabase dashboard to go and fix it.
 */
export function SetupCheck() {
  const [state, setState] = useState<'checking' | ConnectionResult>('checking');

  useEffect(() => {
    let cancelled = false;
    checkConnection().then((result) => {
      if (!cancelled) setState(result);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  if (state === 'checking') {
    return (
      <section className="rounded-2xl border border-border bg-surface p-5">
        <h2 className="text-base font-semibold text-text">Database connection</h2>
        <p className="mt-2 text-sm text-muted">Checking…</p>
      </section>
    );
  }

  if (state.ok) {
    return (
      <section className="rounded-2xl border border-positive bg-surface p-5">
        <h2 className="text-base font-semibold text-positive">✓ Database connected</h2>
        <p className="mt-2 text-sm text-muted">{state.message}</p>
      </section>
    );
  }

  return (
    <section className="rounded-2xl border border-danger bg-surface p-5">
      <h2 className="text-base font-semibold text-danger">Database not connected</h2>
      <p className="mt-3 text-sm text-text">{state.problem}</p>
      <p className="mt-3 text-sm font-semibold text-text">How to fix it</p>
      <p className="mt-1 text-sm text-muted">{state.fix}</p>
    </section>
  );
}
