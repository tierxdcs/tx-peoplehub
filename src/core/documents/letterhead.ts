import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Logger } from '@nestjs/common';

/**
 * Company letterhead for documents the BACKEND renders (currently the Purchase
 * Order PDF that gets emailed to a supplier).
 *
 * ── Keep in step with web/app/lib/theme.ts (`COMPANY`) ──
 * That object is the twin of this one and drives every browser-printed
 * document. They are separate because the two halves of the app are deployed
 * separately and share no bundle; a branding change is two edits, here and
 * there. Nothing else in the backend should hardcode any of these strings.
 *
 * The legal entity name, GSTIN and registered address are NOT here on purpose —
 * those are authoritative in the FinanceCompanySettings row and are passed into
 * the document renderer, so a GST registration change never needs a deploy.
 */
export const LETTERHEAD = {
  name: 'Phaze Dynamics',
  contactEmail: 'info@phaze-dynamics.com',
  website: 'www.phaze-dynamics.com',
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
  confidentialityLine:
    'Confidential — prepared exclusively for the named recipient.',
} as const;

/** The name a rendered document references the logo by (`<img src="...">`). */
export const LETTERHEAD_LOGO_FILENAME = 'letterhead-logo.png';

const logger = new Logger('Letterhead');
/** Read once: the file never changes within a process, and it is only ~10 KB. */
let logoCache: Buffer | null | undefined;

/**
 * The letterhead logo bytes, for upload alongside the document HTML. Returns
 * null when the asset is missing rather than failing the render — a PO without
 * the logo mark still falls back to the wordmark and is a valid document, and
 * an asset-packaging mistake must not stop a supplier being sent their order.
 */
export function letterheadLogo(): Buffer | null {
  if (logoCache !== undefined) return logoCache;
  // `../../assets` resolves to src/assets under ts-jest and dist/assets in the
  // built image — see the `assets` entry in nest-cli.json.
  const path = join(__dirname, '../../assets', LETTERHEAD_LOGO_FILENAME);
  try {
    logoCache = readFileSync(path);
  } catch {
    logger.warn(
      `Letterhead logo not found at ${path} — documents will use the wordmark instead.`,
    );
    logoCache = null;
  }
  return logoCache;
}
