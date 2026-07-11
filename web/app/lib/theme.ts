/**
 * Single source of truth for swappable branding. The company name isn't
 * finalized (Axentria Dynamics vs. Phaze Dynamics), so nothing hardcodes it
 * — the app name, tagline, and logo glyph all read from here, and the color
 * accent lives in app/globals.css (the `--primary` / `--ring` tokens).
 *
 * To rebrand later: change APP_NAME/APP_TAGLINE/logo here and the `--primary`
 * HSL in globals.css. That's the whole change — no component edits.
 */
export const BRAND = {
  /** Shown in the top bar and browser title. */
  appName: 'WorkCore',
  tagline: 'HR & Sales',
  /**
   * Logo is a placeholder glyph (a lucide icon name) until a real logo asset
   * exists — swap for an <Image> in the AppTopBar when branding is finalized.
   */
  logoGlyph: 'Hexagon' as const,
} as const;

/**
 * Company letterhead for outward-facing documents (bid proposals, and any
 * future printable PDF). Placeholder values until real branding/registration
 * details are finalized — change them ONLY here; every printed document reads
 * from this one object. `addressLines` renders one line each in the header.
 */
export const COMPANY = {
  name: 'Phaze Dynamics Inc.',
  addressLines: [
    '[Company Address Line 1]',
    '[City, State, PIN]',
    '[Country]',
  ],
  /** Optional contact line under the address; leave '' to omit. */
  contact: '[Phone] · [Email] · [Website]',
  /** Optional tax/registration identifier shown in the letterhead. */
  gstin: '[Company GSTIN]',
} as const;
