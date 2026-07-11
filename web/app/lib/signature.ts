import type { SignatureFont } from './types';

/**
 * Internal e-signature — a DISPLAY layer only, NOT a legally-binding e-sign.
 * Maps each SignatureFont enum value to the CSS variable set up in layout.tsx
 * (via next/font, so the font is self-hosted and renders in print-to-PDF too).
 */
export const SIGNATURE_FONT_VAR: Record<SignatureFont, string> = {
  DANCING_SCRIPT: 'var(--font-signature-dancing-script)',
  CAVEAT: 'var(--font-signature-caveat)',
  PACIFICO: 'var(--font-signature-pacifico)',
  GREAT_VIBES: 'var(--font-signature-great-vibes)',
};

/** Human-readable labels for the font picker. */
export const SIGNATURE_FONT_LABEL: Record<SignatureFont, string> = {
  DANCING_SCRIPT: 'Dancing Script',
  CAVEAT: 'Caveat',
  PACIFICO: 'Pacifico',
  GREAT_VIBES: 'Great Vibes',
};

export const SIGNATURE_FONTS: SignatureFont[] = [
  'DANCING_SCRIPT',
  'CAVEAT',
  'PACIFICO',
  'GREAT_VIBES',
];

/** The inline style to render `text` in a given signature font. */
export function signatureStyle(
  font: SignatureFont | null | undefined,
): React.CSSProperties {
  return {
    fontFamily: font ? SIGNATURE_FONT_VAR[font] : undefined,
  };
}
