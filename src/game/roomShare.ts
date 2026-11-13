import { normalizeRoomCodeInput } from './roomCode';

export function createRoomShareUrl(roomCode: string, currentUrl: string): string {
  const url = new URL(currentUrl);
  url.searchParams.set('room', normalizeRoomCodeInput(roomCode));
  return url.toString();
}

export function getRoomCodeFromUrl(currentUrl: string): string | null {
  const roomCode = new URL(currentUrl).searchParams.get('room');
  return roomCode ? normalizeRoomCodeInput(roomCode) : null;
}
