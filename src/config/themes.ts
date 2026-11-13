/**
 * CENTRAL THEME FILE
 * ------------------
 * Every colour in the game is defined here as a CSS variable set. Components
 * never hard-code a colour; they use Tailwind classes that point at these
 * variables (for example `bg-surface` or `text-accent`).
 *
 * Adding a new theme = adding one entry to THEMES. Nothing else changes.
 */

export type ThemeId = 'dark-spy' | 'light-paper' | 'high-contrast';

export interface ThemeTokens {
  /** Page background. */
  '--color-bg': string;
  /** Cards, panels, raised surfaces. */
  '--color-surface': string;
  /** A surface sitting on top of another surface. */
  '--color-surface-raised': string;
  /** Hairlines and dividers. */
  '--color-border': string;
  /** Primary readable text. */
  '--color-text': string;
  /** Secondary / supporting text. */
  '--color-text-muted': string;
  /** Main brand accent, used for primary buttons. */
  '--color-accent': string;
  /** Text placed on top of the accent colour. */
  '--color-accent-contrast': string;
  /** Success / correct / regular-player colour. */
  '--color-positive': string;
  /** Danger / imposter / destructive colour. */
  '--color-danger': string;
  /** Warning and "unbalanced setting" colour. */
  '--color-warning': string;
  /** Opaque cover drawn over private information. Must NOT be translucent. */
  '--color-secrecy-cover': string;
}

export interface Theme {
  id: ThemeId;
  /** Shown in the host's theme picker. */
  label: string;
  /** Drives the browser UI colour on mobile. */
  themeColor: string;
  tokens: ThemeTokens;
}

export const THEMES: Record<ThemeId, Theme> = {
  'dark-spy': {
    id: 'dark-spy',
    label: 'Dark Spy',
    themeColor: '#0b1020',
    tokens: {
      '--color-bg': '#0b1020',
      '--color-surface': '#151b2e',
      '--color-surface-raised': '#1e2640',
      '--color-border': '#2c3553',
      '--color-text': '#f2f5ff',
      '--color-text-muted': '#9aa5c4',
      '--color-accent': '#6c8cff',
      '--color-accent-contrast': '#06091a',
      '--color-positive': '#3ddc97',
      '--color-danger': '#ff5c7a',
      '--color-warning': '#ffb340',
      '--color-secrecy-cover': '#0b1020',
    },
  },
  'light-paper': {
    id: 'light-paper',
    label: 'Light Paper',
    themeColor: '#f7f5ef',
    tokens: {
      '--color-bg': '#f7f5ef',
      '--color-surface': '#ffffff',
      '--color-surface-raised': '#efece3',
      '--color-border': '#d9d4c7',
      '--color-text': '#1b1a17',
      '--color-text-muted': '#5d5a51',
      '--color-accent': '#2f5bd7',
      '--color-accent-contrast': '#ffffff',
      '--color-positive': '#1a7f4f',
      '--color-danger': '#c22a45',
      '--color-warning': '#9a6200',
      '--color-secrecy-cover': '#efece3',
    },
  },
  'high-contrast': {
    id: 'high-contrast',
    label: 'High Contrast',
    themeColor: '#000000',
    tokens: {
      '--color-bg': '#000000',
      '--color-surface': '#000000',
      '--color-surface-raised': '#1a1a1a',
      '--color-border': '#ffffff',
      '--color-text': '#ffffff',
      '--color-text-muted': '#e0e0e0',
      '--color-accent': '#ffe000',
      '--color-accent-contrast': '#000000',
      '--color-positive': '#00ff95',
      '--color-danger': '#ff6b6b',
      '--color-warning': '#ffb340',
      '--color-secrecy-cover': '#000000',
    },
  },
};

/** Used when the host has not chosen anything, per the spec. */
export const DEFAULT_THEME_ID: ThemeId = 'dark-spy';

export const THEME_LIST: Theme[] = Object.values(THEMES);
