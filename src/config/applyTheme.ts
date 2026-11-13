import { DEFAULT_THEME_ID, THEMES, type ThemeId } from './themes';
import { BRANDING } from './branding';

/**
 * Writes a theme's colours onto the <html> element as CSS variables.
 * Every component picks the change up instantly because they all read the
 * same variables through Tailwind.
 */
export function applyTheme(themeId: ThemeId = DEFAULT_THEME_ID): void {
  const theme = THEMES[themeId] ?? THEMES[DEFAULT_THEME_ID];
  const root = document.documentElement;

  for (const [token, value] of Object.entries(theme.tokens)) {
    root.style.setProperty(token, value);
  }

  root.className = `theme-${theme.id}`;

  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', theme.themeColor);
}

/** Keeps the browser tab title in sync with the central branding file. */
export function setDocumentTitle(): void {
  document.title = BRANDING.documentTitle;
}
