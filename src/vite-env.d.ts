/// <reference types="vite/client" />

/**
 * Describes the settings the app reads from the .env file.
 *
 * Anything starting with VITE_ is compiled into the browser bundle and is
 * therefore PUBLIC. Never add a secret here.
 */
interface ImportMetaEnv {
  /** The project URL, e.g. https://abcdefghijkl.supabase.co */
  readonly VITE_SUPABASE_URL: string;
  /** The publishable / anon key. Safe for browsers. NEVER the secret key. */
  readonly VITE_SUPABASE_PUBLISHABLE_KEY: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
