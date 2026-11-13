/**
 * CENTRAL BRANDING FILE
 * ---------------------
 * Everything about the product's *name* and *wording* lives here, and nowhere
 * else. When the working title "Imposter: Secret Signal" is replaced, this is
 * the only file that has to change.
 *
 * Rule for the whole codebase: never type the product name as plain text in a
 * component. Always read it from here.
 */

export const BRANDING = {
  /** Full product name, shown on the home screen. */
  appName: 'Imposter: Secret Signal',
  /** Short name for tight spaces such as the header bar. */
  appShortName: 'Secret Signal',
  /** One-line description of what the game is. */
  tagline: 'Find the imposter. Trust no one.',
  /** Shown in the browser tab. Kept in sync with index.html by setDocumentTitle(). */
  documentTitle: 'Imposter: Secret Signal',
  /** Bumped manually; displayed small on the home screen so testers can report it. */
  version: '0.1.0',
} as const;

export type Branding = typeof BRANDING;
