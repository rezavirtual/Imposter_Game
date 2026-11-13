import { describe, it, expect } from 'vitest';
import { looksLikeSecretKey, looksLikeSupabaseUrl, checkEnvironment } from './envGuards';

function jwtWithRole(role: string): string {
  const header = btoa(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const payload = btoa(JSON.stringify({ role, iss: 'supabase' }));
  return `${header}.${payload}.signature`;
}

/**
 * The single worst mistake this project could make is shipping a key that
 * bypasses database security to players' phones. These tests make that
 * mistake impossible to commit unnoticed.
 */
describe('secret key detection', () => {
  it('detects a new-style secret key', () => {
    expect(looksLikeSecretKey('sb_secret_abc123def456')).toBe(true);
  });

  it('allows a new-style publishable key', () => {
    expect(looksLikeSecretKey('sb_publishable_abc123def456')).toBe(false);
  });

  it('detects an old-style service_role JWT', () => {
    expect(looksLikeSecretKey(jwtWithRole('service_role'))).toBe(true);
  });

  it('allows an old-style anon JWT', () => {
    expect(looksLikeSecretKey(jwtWithRole('anon'))).toBe(false);
  });

  it('does not crash on nonsense input', () => {
    expect(looksLikeSecretKey('')).toBe(false);
    expect(looksLikeSecretKey('not.a.jwt')).toBe(false);
    expect(looksLikeSecretKey('!!!.!!!.!!!')).toBe(false);
  });
});

describe('url validation', () => {
  it('accepts a real Supabase url', () => {
    expect(looksLikeSupabaseUrl('https://abcdefghijklmnop.supabase.co')).toBe(true);
  });

  it('rejects an insecure http url', () => {
    expect(looksLikeSupabaseUrl('http://abcdefghijklmnop.supabase.co')).toBe(false);
  });

  it('rejects a placeholder that was never filled in', () => {
    expect(looksLikeSupabaseUrl('https://your-project-ref.supabase.co')).toBe(true);
    expect(looksLikeSupabaseUrl('YOUR_URL_HERE')).toBe(false);
  });
});

describe('environment check messages', () => {
  it('refuses a secret key with a loud, specific explanation', () => {
    const result = checkEnvironment({
      url: 'https://abc.supabase.co',
      key: 'sb_secret_xyz',
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message).toMatch(/SECURITY STOP/);
      expect(result.message).toMatch(/publishable/i);
    }
  });

  it('prioritises the security warning over a missing url', () => {
    const result = checkEnvironment({ url: undefined, key: 'sb_secret_xyz' });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toMatch(/SECURITY STOP/);
  });

  it('explains a missing .env file in plain language', () => {
    const result = checkEnvironment({ url: undefined, key: undefined });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message).toMatch(/\.env/);
      expect(result.message).toMatch(/restart/i);
    }
  });

  it('accepts a correct configuration', () => {
    const result = checkEnvironment({
      url: 'https://abcdefghijklmnop.supabase.co',
      key: 'sb_publishable_realkey',
    });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.url).toBe('https://abcdefghijklmnop.supabase.co');
  });

  it('tolerates a trailing slash on the url', () => {
    const result = checkEnvironment({
      url: 'https://abc.supabase.co/',
      key: 'sb_publishable_realkey',
    });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.url).toBe('https://abc.supabase.co');
  });
});
