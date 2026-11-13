/**
 * CONNECTION CHECK
 * ----------------
 * A one-off diagnostic used during setup, and later by the home screen to
 * tell a player "the game cannot reach the server" instead of silently
 * failing mid-match.
 *
 * It deliberately asks for something harmless: an anonymous session. If that
 * works, the project URL, the publishable key and anonymous sign-in are all
 * correct.
 */

import { supabase } from './supabaseClient';

export type ConnectionResult =
  | { ok: true; message: string }
  | { ok: false; problem: string; fix: string };

export async function checkConnection(): Promise<ConnectionResult> {
  try {
    const { data, error } = await supabase.auth.signInAnonymously();

    if (error) {
      // The most common first-run failure, with the exact dashboard location.
      if (/anonymous/i.test(error.message) || /disabled/i.test(error.message)) {
        return {
          ok: false,
          problem: 'Anonymous sign-in is switched off in Supabase.',
          fix: 'Supabase dashboard, then Authentication, then Sign In / Providers. Turn on "Allow anonymous sign-ins" and save.',
        };
      }
      return {
        ok: false,
        problem: `Supabase refused the connection: ${error.message}`,
        fix: 'Check that the publishable key in the .env file matches the one in the dashboard, then restart the dev server.',
      };
    }

    if (!data.session) {
      return {
        ok: false,
        problem: 'Supabase replied, but did not create a session.',
        fix: 'Check that anonymous sign-ins are enabled in the Authentication settings.',
      };
    }

    return { ok: true, message: 'Connected to Supabase and signed in anonymously.' };
  } catch (cause) {
    return {
      ok: false,
      problem: `Could not reach Supabase at all: ${cause instanceof Error ? cause.message : String(cause)}`,
      fix: 'Check the project URL in the .env file and your internet connection, then restart the dev server.',
    };
  }
}
