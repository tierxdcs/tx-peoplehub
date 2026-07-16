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
 * Company letterhead + document config for outward-facing documents (the
 * Techno Commercial Proposal, order confirmation sheets, and any future
 * printable PDF). Change these ONLY here; every printed document reads from
 * this one object. `addressLines`/`contact`/`gstin` remain for the order
 * confirmation sheet; the proposal uses the logo/wordmark + footer blocks.
 */
export const COMPANY = {
  name: 'Phaze Dynamics',
  /**
   * Registered legal entity — used where a signed commercial document must
   * name the actual company (proposal closing), distinct from the `name`
   * wordmark/display name.
   */
  legalEntityName: 'Phaze Dynamics India Pvt Ltd',
  /** "Get in touch" block on the proposal header (top-right). */
  contactEmail: 'info@phaze-dynamics.com',
  website: 'www.phaze-dynamics.com',
  /**
   * Letterhead logo (a full logo+wordmark lockup for a light/white page).
   * Path is relative to web/public; set to '' to fall back to the plain
   * wordmark text.
   */
  logoPath: '/phaze-3b-logo-white.png',
  addressLines: [
    '[Company Address Line 1]',
    '[City, State, PIN]',
    '[Country]',
  ],
  /** Optional contact line under the address; leave '' to omit. */
  contact: '[Phone] · [Email] · [Website]',
  /** Optional tax/registration identifier shown in the letterhead. */
  gstin: '[Company GSTIN]',
  /** Footer address blocks for the Techno Commercial Proposal (§7). */
  headquarters: {
    label: 'Headquarters',
    lines: ['18 King Street East', 'Toronto, ON, Canada M5C 1C'],
  },
  manufacturingCenter: {
    label: 'Global Manufacturing & Engineering Center',
    lines: [
      '173, Industrial Suburb, 2nd Stage',
      'Yeshwanthpur, Bengaluru, Karnataka, India 560 022',
    ],
  },
  /** Confidentiality line shown above the page number in document footers. */
  confidentialityLine:
    'Confidential — prepared exclusively for the named recipient.',
} as const;

/**
 * General Terms & Conditions for the Techno Commercial Proposal (§6). A fixed,
 * config-driven template — consistent across every proposal and never editable
 * per-bid. To change the terms, edit this array here (same static-config
 * pattern as the letterhead above). Rendered as a numbered list.
 */
/**
 * Fixed payment-terms summary shown in the Commercial Proposal detail block
 * (§5). Kept in sync with Terms & Conditions #2; edited here in code.
 */
export const PROPOSAL_PAYMENT_TERMS = '100% advance against PI invoice';

export const PROPOSAL_TERMS: readonly string[] = [
  'This quotation is valid for 30 days only from the date of submission.',
  'Payment terms: 100% advance against PI invoice.',
  'Taxes and duties: all applicable taxes, customs duties, import levies, and any other charges in the destination country/state are the sole responsibility of the buyer.',
  'Inspection: the buyer may inspect the goods at our premises before dispatch. Once goods leave our factory, they are deemed to be accepted in good condition.',
  'Warranty: a standard one-year manufacturing warranty applies to all products, covering defects in materials and workmanship. This warranty does not cover damage due to misuse, improper installation, or normal wear and tear.',
  'Transport charges will be extra, or to-pay basis.',
] as const;
