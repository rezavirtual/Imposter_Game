/**
 * SUPABASE CONNECTION
 * -------------------
 * The single place where the app connects to the database. Every other file
 * imports the client from here, so there is exactly one connection to secure.
 *
 * WHAT IS SAFE TO PUT IN THE .env FILE
 * Both values this file reads are PUBLIC by design. They are compiled into the
 * JavaScript that every player's phone downloads, so anyone can read them.
 * That is expected and fine: on their own they grant nothing, because Row
 * Level Security in the database decides what any request may actually see.
 *
 * WHAT MUST NEVER APPEAR IN THIS PROJECT
 * The key labelled "service_role" (older naming) or "secret" / "sb_secret_..."
 * (newer naming) bypasses Row Level Security completely. It belongs only on a
 * trusted server, never in a browser. checkEnvironment() below refuses to
 * start the app if it ever finds one.
 */

import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { checkEnvironment } from './envGuards';

const result = checkEnvironment({
  url: import.meta.env.VITE_SUPABASE_URL,
  key: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
});

if (!result.ok) {
  throw new Error(result.message);
}

export const supabase: SupabaseClient = createClient(result.url, result.key, {
  auth: {
    // Players have no accounts. We use anonymous sessions, kept alive across
    // a phone locking or the browser being backgrounded.
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: false,
  },
  realtime: {
    params: {
      // A room is at most 10 phones. This cap limits the damage a
      // misbehaving or malicious client can do.
      eventsPerSecond: 10,
    },
  },
  global: {
    headers: { 'x-application-name': 'imposter-secret-signal' },
  },
});
