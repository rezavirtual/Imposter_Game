import { describe, expect, it } from 'vitest';
import { createRoomShareUrl, getRoomCodeFromUrl } from './roomShare';

describe('room share links', () => {
  it('adds the room code while preserving the app URL', () => {
    expect(createRoomShareUrl('kxq7', 'https://game.example/play?theme=dark')).toBe(
      'https://game.example/play?theme=dark&room=KXQ7',
    );
  });

  it('reads and normalizes a room code from a scanned link', () => {
    expect(getRoomCodeFromUrl('https://game.example/?room=kxq7')).toBe('KXQ7');
  });

  it('returns null when the link does not contain a room code', () => {
    expect(getRoomCodeFromUrl('https://game.example/')).toBeNull();
  });
});
