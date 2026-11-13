/**
 * NICKNAMES
 * ---------
 * Rules from the specification:
 *   - unique within a room, compared case-insensitively
 *   - duplicates are REJECTED, never silently renamed
 *   - the host may rename an inappropriate nickname
 */

export const NICKNAME_MIN_LENGTH = 2;
export const NICKNAME_MAX_LENGTH = 16;

/**
 * Characters that look like ordinary text but are invisible or reorder the
 * display. Two players could otherwise appear to have identical names, or a
 * name could visually overwrite the one next to it.
 */
const INVISIBLE_OR_BIDI =
  /[\u0000-\u001F\u007F-\u009F\u00AD\u200B-\u200F\u202A-\u202E\u2060-\u206F\uFEFF]/g;

/**
 * Tidies raw keyboard input: strips dangerous characters, collapses runs of
 * spaces, and trims the ends. Case is PRESERVED — players keep the
 * capitalisation they chose; only the comparison ignores case.
 */
export function normalizeNickname(input: string): string {
  return input
    .normalize('NFC')
    .replace(INVISIBLE_OR_BIDI, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * The value used for duplicate detection. Case-insensitive, and also
 * whitespace-insensitive so "Sam" and "S a m" do not read as different
 * players across a table.
 */
export function nicknameComparisonKey(nickname: string): string {
  return normalizeNickname(nickname).toLocaleLowerCase().replace(/\s/g, '');
}

export type NicknameRejection =
  | 'empty'
  | 'too_short'
  | 'too_long'
  | 'no_letters_or_numbers'
  | 'already_taken';

export type NicknameCheck =
  | { ok: true; nickname: string }
  | { ok: false; reason: NicknameRejection; message: string };

/**
 * Validates a nickname against the room's existing names.
 *
 * `existingNicknames` is every name currently in the room. When a host is
 * RENAMING an existing player, pass that player's current name as
 * `excludeNickname` so they are not blocked by their own name.
 */
export function checkNickname(
  rawInput: string,
  existingNicknames: readonly string[],
  excludeNickname?: string,
): NicknameCheck {
  const nickname = normalizeNickname(rawInput);

  if (nickname.length === 0) {
    return { ok: false, reason: 'empty', message: 'Please enter a nickname.' };
  }
  if (nickname.length < NICKNAME_MIN_LENGTH) {
    return {
      ok: false,
      reason: 'too_short',
      message: `Nicknames need at least ${NICKNAME_MIN_LENGTH} characters.`,
    };
  }
  if (nickname.length > NICKNAME_MAX_LENGTH) {
    return {
      ok: false,
      reason: 'too_long',
      message: `Nicknames can be at most ${NICKNAME_MAX_LENGTH} characters.`,
    };
  }
  if (!/\p{L}|\p{N}/u.test(nickname)) {
    return {
      ok: false,
      reason: 'no_letters_or_numbers',
      message: 'Nicknames need at least one letter or number.',
    };
  }

  const key = nicknameComparisonKey(nickname);
  const excludedKey = excludeNickname ? nicknameComparisonKey(excludeNickname) : null;

  const clash = existingNicknames.some((existing) => {
    const existingKey = nicknameComparisonKey(existing);
    if (excludedKey !== null && existingKey === excludedKey) return false;
    return existingKey === key;
  });

  if (clash) {
    return {
      ok: false,
      reason: 'already_taken',
      message: `"${nickname}" is already used in this room. Please pick a different name.`,
    };
  }

  return { ok: true, nickname };
}
