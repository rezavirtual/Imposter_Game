/**
 * ENVIRONMENT SAFETY CHECKS
 * -------------------------
 * Pure functions, no connection, no side effects — so they can be tested
 * without a database and reused by any build-time check.
 *
 * Their job is to make one specific catastrophe impossible: shipping a key
 * that bypasses database security to every player's phone.
 */

/**
 * Recognises a Supabase SECRET key in either naming scheme.
 *
 * Secret keys bypass Row Level Security entirely. In a browser that would
 * expose every player's role, secret word and vote to anyone who opens the
 * developer tools.
 */
export function looksLikeSecretKey(key: string): boolean {
  if (key.startsWith('sb_secret_')) return true;

  // Older keys are JWTs. The middle section decodes to JSON naming the role.
  const parts = key.split('.');
  if (parts.length === 3 && parts[1]) {
    try {
      const payload = atob(parts[1].replace(/-/g, '+').replace(/_/g, '/'));
      if (payload.includes('"service_role"')) return true;
    } catch {
      // Not decodable, so not a JWT we need to worry about.
    }
  }

  return false;
}

export function looksLikeSupabaseUrl(url: string): boolean {
  return /^https:\/\/[a-z0-9-]+\.supabase\.co\/?$/i.test(url);
}

export interface EnvironmentInput {
  url: string | undefined;
  key: string | undefined;
}

export type EnvironmentCheck =
  | { ok: true; url: string; key: string }
  | { ok: false; message: string };

/**
 * Validates the two values the app needs, returning a message written for
 * somebody who has never edited a configuration file before.
 */
export function checkEnvironment(input: EnvironmentInput): EnvironmentCheck {
  if (input.key && looksLikeSecretKey(input.key)) {
    return {
      ok: false,
      message:
        'SECURITY STOP\n\n' +
        'The key in VITE_SUPABASE_PUBLISHABLE_KEY is a SECRET key.\n' +
        'Secret keys bypass all database security and must never be used in a browser.\n\n' +
        'Fix: open the Supabase dashboard, go to Project Settings then API Keys,\n' +
        'and copy the key labelled "publishable" or "anon" instead.\n' +
        'Then restart the dev server.',
    };
  }

  const problems: string[] = [];

  if (!input.url) {
    problems.push('VITE_SUPABASE_URL is missing.');
  } else if (!looksLikeSupabaseUrl(input.url)) {
    problems.push(`VITE_SUPABASE_URL does not look right: "${input.url}"`);
  }

  if (!input.key) {
    problems.push('VITE_SUPABASE_PUBLISHABLE_KEY is missing.');
  }

  if (problems.length > 0) {
    return {
      ok: false,
      message:
        'Supabase is not configured yet.\n\n' +
        problems.map((p) => `  - ${p}`).join('\n') +
        '\n\nFix: create a file named ".env" in the project folder containing:\n\n' +
        '  VITE_SUPABASE_URL=https://your-project-ref.supabase.co\n' +
        '  VITE_SUPABASE_PUBLISHABLE_KEY=your-publishable-key\n\n' +
        'Then restart the dev server (stop it and start it again).',
    };
  }

  return { ok: true, url: input.url!.replace(/\/$/, ''), key: input.key! };
}
