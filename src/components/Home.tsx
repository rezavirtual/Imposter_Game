import { useState } from 'react';
import { BRANDING } from '../config/branding';
import { THEME_LIST } from '../config/themes';
import { applyTheme } from '../config/applyTheme';
import { checkNickname } from '../game/nickname';
import { normalizeRoomCodeInput, describeRoomCodeProblem } from '../game/roomCode';
import { getRoomCodeFromUrl } from '../game/roomShare';
import { WORD_CATEGORIES } from '../game/settings';
import { createRoom, joinRoom, type RoomJoinResult } from '../lib/roomService';

interface HomeProps {
  onRoomJoined: (session: RoomJoinResult & { nickname: string }) => void;
}

type Mode = 'idle' | 'host' | 'join';

export function Home({ onRoomJoined }: HomeProps) {
  const [roomFromLink] = useState(() => getRoomCodeFromUrl(window.location.href));
  const [mode, setMode] = useState<Mode>(roomFromLink ? 'join' : 'idle');
  const [nickname, setNickname] = useState('');
  const [category, setCategory] = useState('random');
  const [roomCode, setRoomCode] = useState(roomFromLink ?? '');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [showThemePicker, setShowThemePicker] = useState(false);

  const handleHost = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    const nickCheck = checkNickname(nickname, []);
    if (!nickCheck.ok) {
      setError(nickCheck.message);
      return;
    }

    setLoading(true);
    try {
      const res = await createRoom(nickCheck.nickname, { category });
      onRoomJoined({ ...res, nickname: nickCheck.nickname });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create room');
    } finally {
      setLoading(false);
    }
  };

  const handleJoin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    const cleanedCode = normalizeRoomCodeInput(roomCode);
    const codeProblem = describeRoomCodeProblem(cleanedCode);
    if (codeProblem) {
      setError(codeProblem);
      return;
    }

    const nickCheck = checkNickname(nickname, []);
    if (!nickCheck.ok) {
      setError(nickCheck.message);
      return;
    }

    setLoading(true);
    try {
      const res = await joinRoom(cleanedCode, nickCheck.nickname);
      const currentUrl = new URL(window.location.href);
      currentUrl.searchParams.delete('room');
      window.history.replaceState(window.history.state, '', currentUrl.toString());
      onRoomJoined({ ...res, nickname: nickCheck.nickname });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to join room');
    } finally {
      setLoading(false);
    }
  };

  return (
    <main className="mx-auto flex min-h-full w-full max-w-md flex-col justify-between px-5 py-8">
      {/* Top Bar */}
      <header className="flex items-center justify-between">
        <span className="text-xs font-semibold tracking-wider uppercase text-muted">
          {BRANDING.appShortName}
        </span>
        <button
          type="button"
          onClick={() => setShowThemePicker(!showThemePicker)}
          className="rounded-lg border border-border bg-surface px-2.5 py-1 text-xs font-medium text-text active:opacity-75"
        >
          🎨 Theme
        </button>
      </header>

      {/* Theme Drawer */}
      {showThemePicker && (
        <div className="mt-3 flex gap-2 rounded-xl border border-border bg-surface p-2">
          {THEME_LIST.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => {
                applyTheme(t.id);
                setShowThemePicker(false);
              }}
              className="flex-1 rounded-lg bg-surface-raised py-2 text-xs font-semibold text-text active:opacity-75"
            >
              {t.label}
            </button>
          ))}
        </div>
      )}

      {/* Main Hero */}
      <div className="my-auto flex flex-col gap-6 py-6">
        <div className="text-center">
          <h1 className="text-4xl font-extrabold tracking-tight text-text">
            {BRANDING.appName}
          </h1>
          <p className="mt-2 text-sm text-muted">{BRANDING.tagline}</p>
        </div>

        {error && (
          <div className="rounded-xl border border-danger/50 bg-danger/10 p-3 text-center text-xs font-medium text-danger">
            {error}
          </div>
        )}

        {/* State 1: Choose Action */}
        {mode === 'idle' && (
          <div className="flex flex-col gap-3">
            <button
              type="button"
              onClick={() => {
                setMode('host');
                setError(null);
              }}
              className="min-h-14 rounded-2xl bg-accent text-base font-bold text-accent-contrast shadow-lg transition-transform active:scale-[0.98]"
            >
              Host a Game
            </button>
            <button
              type="button"
              onClick={() => {
                setMode('join');
                setError(null);
              }}
              className="min-h-14 rounded-2xl border border-border bg-surface text-base font-semibold text-text transition-transform active:scale-[0.98]"
            >
              Join with Code
            </button>
          </div>
        )}

        {/* State 2: Host Form */}
        {mode === 'host' && (
          <form onSubmit={handleHost} className="flex flex-col gap-4 rounded-2xl border border-border bg-surface p-5">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-bold text-text">Host New Room</h2>
              <button
                type="button"
                onClick={() => setMode('idle')}
                className="text-xs text-muted hover:text-text"
              >
                Back
              </button>
            </div>

            <div>
              <label htmlFor="host-nickname" className="text-xs font-medium text-muted">
                Your Nickname
              </label>
              <input
                id="host-nickname"
                type="text"
                autoFocus
                maxLength={16}
                value={nickname}
                onChange={(e) => setNickname(e.target.value)}
                placeholder="e.g. Agent 007"
                className="mt-1.5 w-full rounded-xl border border-border bg-surface-raised px-4 py-3 text-base text-text placeholder-muted/60 focus:border-accent focus:outline-none"
              />
            </div>

            <div>
              <label htmlFor="host-category" className="text-xs font-medium text-muted">
                Word Category
              </label>
              <select
                id="host-category"
                value={category}
                onChange={(e) => setCategory(e.target.value)}
                className="mt-1.5 w-full rounded-xl border border-border bg-surface-raised px-4 py-3 text-base text-text focus:border-accent focus:outline-none"
              >
                <option value="random">Random</option>
                {WORD_CATEGORIES.map((wordCategory) => (
                  <option key={wordCategory} value={wordCategory}>
                    {wordCategory}
                  </option>
                ))}
              </select>
              <p className="mt-1 text-xs text-muted">
                Random picks a category for each round. The imposter will receive it as a clue.
              </p>
            </div>

            <button
              type="submit"
              disabled={loading}
              className="mt-2 min-h-12 rounded-xl bg-accent text-sm font-bold text-accent-contrast disabled:opacity-50"
            >
              {loading ? 'Creating room...' : 'Create Room'}
            </button>
          </form>
        )}

        {/* State 3: Join Form */}
        {mode === 'join' && (
          <form onSubmit={handleJoin} className="flex flex-col gap-4 rounded-2xl border border-border bg-surface p-5">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-bold text-text">Join Room</h2>
              <button
                type="button"
                onClick={() => setMode('idle')}
                className="text-xs text-muted hover:text-text"
              >
                Back
              </button>
            </div>

            <div>
              <label htmlFor="join-code" className="text-xs font-medium text-muted">
                4-Character Room Code
              </label>
              <input
                id="join-code"
                type="text"
                autoFocus
                maxLength={4}
                value={roomCode}
                onChange={(e) => setRoomCode(e.target.value.toUpperCase())}
                placeholder="e.g. KXQ7"
                className="mt-1.5 w-full text-center font-mono text-2xl font-bold tracking-widest uppercase rounded-xl border border-border bg-surface-raised px-4 py-3 text-text placeholder-muted/40 focus:border-accent focus:outline-none"
              />
            </div>

            <div>
              <label htmlFor="join-nickname" className="text-xs font-medium text-muted">
                Your Nickname
              </label>
              <input
                id="join-nickname"
                type="text"
                maxLength={16}
                value={nickname}
                onChange={(e) => setNickname(e.target.value)}
                placeholder="e.g. Shadow"
                className="mt-1.5 w-full rounded-xl border border-border bg-surface-raised px-4 py-3 text-base text-text placeholder-muted/60 focus:border-accent focus:outline-none"
              />
            </div>

            <button
              type="submit"
              disabled={loading}
              className="mt-2 min-h-12 rounded-xl bg-accent text-sm font-bold text-accent-contrast disabled:opacity-50"
            >
              {loading ? 'Joining room...' : 'Join Room'}
            </button>
          </form>
        )}
      </div>

      <footer className="text-center">
        <p className="text-xs text-muted">Version {BRANDING.version} • Free & Ad-free</p>
      </footer>
    </main>
  );
}
