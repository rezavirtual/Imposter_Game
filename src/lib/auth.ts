/**
 * AUTHENTICATION SERVICE
 * ----------------------
 * Ensures every device has an anonymous Supabase user session.
 * Reconnect tokens are tied directly to this session's UID.
 */

import { supabase } from './supabaseClient';

export interface AuthSession {
  userId: string;
}

/**
 * Retrieves the current session or signs in anonymously.
 * Safe to call on every screen mount.
 */
export async function ensureAnonymousSession(): Promise<AuthSession> {
  const { data: existing } = await supabase.auth.getSession();
  if (existing?.session?.user) {
    return { userId: existing.session.user.id };
  }

  const { data, error } = await supabase.auth.signInAnonymously();
  if (error || !data.user) {
    throw new Error(error?.message ?? 'Failed to create anonymous session');
  }

  return { userId: data.user.id };
}

/**
 * Returns the current authenticated UID, or null if not yet signed in.
 */
export async function getCurrentUserId(): Promise<string | null> {
  const { data } = await supabase.auth.getSession();
  return data?.session?.user?.id ?? null;
}
