import { VaultFolderType } from '@prisma/client';
import {
  VaultFileTypeCategory,
  VaultFileOrigin,
} from './dto/vault-search-query.dto';

/**
 * Pure helpers behind Vault's browse layer: fuzzy name matching, file-type
 * classification, and origin derivation. No Prisma, no request context — so
 * every rule here is unit-testable and used identically by folder listing,
 * search, and the recent-files view.
 *
 * ## Fuzzy matching
 * Deliberately the SAME ladder as the sidebar's "Jump to" matcher
 * (web/app/lib/nav-search.ts), which itself extends the token-Dice measure of
 * the Customer BOM Intake item search (fuzzyItemScore). Filenames behave like
 * nav labels rather than like BOM descriptions — people type a prefix of one
 * word ("quot" → "RFQ-Quote-2026.pdf"), so whole-token Dice alone is too blunt.
 * Each rung returns a fixed band, so ranking stays explainable:
 * exact > prefix > token-prefix > substring > token overlap > initials > loose
 * subsequence. fuzzyItemScore is left untouched — this is an additional caller-
 * specific scorer, not a replacement.
 */

/** Below this a candidate is noise, not a match (same floor as nav search). */
export const VAULT_SEARCH_MIN_SCORE = 0.2;

/** Lowercase, and collapse every non-alphanumeric run to a single space. */
export function normaliseVaultTerm(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/** Do all query tokens prefix-match distinct target tokens? ("ven nda") */
function coversByPrefix(
  queryTokens: string[],
  targetTokens: string[],
): boolean {
  const used = new Set<number>();
  return queryTokens.every((queryToken) => {
    const index = targetTokens.findIndex(
      (targetToken, at) => !used.has(at) && targetToken.startsWith(queryToken),
    );
    if (index === -1) return false;
    used.add(index);
    return true;
  });
}

/** Token Dice coefficient — the Customer BOM Intake measure, same formula. */
function diceScore(queryTokens: string[], targetTokens: string[]): number {
  const left = new Set(queryTokens);
  const right = new Set(targetTokens);
  if (!left.size || !right.size) return 0;
  let overlap = 0;
  for (const token of left) if (right.has(token)) overlap += 1;
  return (2 * overlap) / (left.size + right.size);
}

/**
 * Are the query's characters present in order? Scored by density, so a match
 * packed into a short span ranks above one scattered across a long filename.
 */
function subsequenceDensity(text: string, query: string): number {
  const haystack = text.replace(/ /g, '');
  const needle = query.replace(/ /g, '');
  if (!needle) return 0;
  let first = -1;
  let at = 0;
  for (
    let index = 0;
    index < haystack.length && at < needle.length;
    index += 1
  ) {
    if (haystack[index] !== needle[at]) continue;
    if (first === -1) first = index;
    at += 1;
    if (at === needle.length) return needle.length / (index - first + 1);
  }
  return 0;
}

/**
 * 0 (no match) … 1 (exact). `normalisedQuery` must already be normalised —
 * the caller normalises once per request instead of once per candidate.
 */
export function vaultFuzzyScore(normalisedQuery: string, text: string): number {
  if (!normalisedQuery) return 0;
  const target = normaliseVaultTerm(text);
  if (!target) return 0;
  if (target === normalisedQuery) return 1;
  if (target.startsWith(normalisedQuery)) return 0.95;

  const queryTokens = normalisedQuery.split(' ');
  const targetTokens = target.split(' ');
  if (coversByPrefix(queryTokens, targetTokens)) return 0.85;
  if (target.includes(normalisedQuery)) return 0.75;

  const dice = diceScore(queryTokens, targetTokens);
  if (dice > 0) return 0.5 + 0.2 * dice;

  const initials = targetTokens.map((token) => token[0]).join('');
  if (initials.startsWith(normalisedQuery.replace(/ /g, ''))) return 0.65;

  const density = subsequenceDensity(target, normalisedQuery);
  return density > 0 ? 0.2 + 0.25 * density : 0;
}

// ---- file type classification ----

/**
 * Extension → category. Extensions are checked BEFORE mimetypes because a
 * browser-declared mimetype is frequently generic (application/octet-stream)
 * or plain wrong, whereas the filename is what the uploader actually chose.
 */
const EXTENSION_CATEGORY: Record<string, VaultFileTypeCategory> = {
  pdf: VaultFileTypeCategory.PDF,

  png: VaultFileTypeCategory.IMAGE,
  jpg: VaultFileTypeCategory.IMAGE,
  jpeg: VaultFileTypeCategory.IMAGE,
  gif: VaultFileTypeCategory.IMAGE,
  webp: VaultFileTypeCategory.IMAGE,
  bmp: VaultFileTypeCategory.IMAGE,
  svg: VaultFileTypeCategory.IMAGE,
  tif: VaultFileTypeCategory.IMAGE,
  tiff: VaultFileTypeCategory.IMAGE,
  heic: VaultFileTypeCategory.IMAGE,

  xls: VaultFileTypeCategory.SPREADSHEET,
  xlsx: VaultFileTypeCategory.SPREADSHEET,
  xlsm: VaultFileTypeCategory.SPREADSHEET,
  csv: VaultFileTypeCategory.SPREADSHEET,
  ods: VaultFileTypeCategory.SPREADSHEET,

  doc: VaultFileTypeCategory.DOCUMENT,
  docx: VaultFileTypeCategory.DOCUMENT,
  odt: VaultFileTypeCategory.DOCUMENT,
  rtf: VaultFileTypeCategory.DOCUMENT,

  ppt: VaultFileTypeCategory.PRESENTATION,
  pptx: VaultFileTypeCategory.PRESENTATION,
  odp: VaultFileTypeCategory.PRESENTATION,

  zip: VaultFileTypeCategory.ARCHIVE,
  rar: VaultFileTypeCategory.ARCHIVE,
  '7z': VaultFileTypeCategory.ARCHIVE,
  gz: VaultFileTypeCategory.ARCHIVE,
  tar: VaultFileTypeCategory.ARCHIVE,

  txt: VaultFileTypeCategory.TEXT,
  md: VaultFileTypeCategory.TEXT,
  log: VaultFileTypeCategory.TEXT,
  json: VaultFileTypeCategory.TEXT,
  xml: VaultFileTypeCategory.TEXT,

  dwg: VaultFileTypeCategory.CAD,
  dxf: VaultFileTypeCategory.CAD,
  step: VaultFileTypeCategory.CAD,
  stp: VaultFileTypeCategory.CAD,
  iges: VaultFileTypeCategory.CAD,
  igs: VaultFileTypeCategory.CAD,
  sldprt: VaultFileTypeCategory.CAD,
  sldasm: VaultFileTypeCategory.CAD,
  stl: VaultFileTypeCategory.CAD,
};

/** Exact mimetype → category, for the types we can name precisely. */
const MIME_CATEGORY: Record<string, VaultFileTypeCategory> = {
  'application/pdf': VaultFileTypeCategory.PDF,
  'text/csv': VaultFileTypeCategory.SPREADSHEET,
  'application/vnd.ms-excel': VaultFileTypeCategory.SPREADSHEET,
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet':
    VaultFileTypeCategory.SPREADSHEET,
  'application/vnd.oasis.opendocument.spreadsheet':
    VaultFileTypeCategory.SPREADSHEET,
  'application/msword': VaultFileTypeCategory.DOCUMENT,
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document':
    VaultFileTypeCategory.DOCUMENT,
  'application/vnd.oasis.opendocument.text': VaultFileTypeCategory.DOCUMENT,
  'application/rtf': VaultFileTypeCategory.DOCUMENT,
  'application/vnd.ms-powerpoint': VaultFileTypeCategory.PRESENTATION,
  'application/vnd.openxmlformats-officedocument.presentationml.presentation':
    VaultFileTypeCategory.PRESENTATION,
  'application/vnd.oasis.opendocument.presentation':
    VaultFileTypeCategory.PRESENTATION,
  'application/zip': VaultFileTypeCategory.ARCHIVE,
  'application/x-zip-compressed': VaultFileTypeCategory.ARCHIVE,
  'application/gzip': VaultFileTypeCategory.ARCHIVE,
  'application/x-tar': VaultFileTypeCategory.ARCHIVE,
  'application/vnd.rar': VaultFileTypeCategory.ARCHIVE,
  'application/x-7z-compressed': VaultFileTypeCategory.ARCHIVE,
};

/**
 * Which bucket a file falls in for the type filter. Real fields only: the
 * filename (always present) and the current version's mimeType (present for
 * every confirmed upload). Extension wins over mimetype (see above); a
 * top-level `image/*` or `text/*` still classifies when the extension is
 * unknown; everything else is OTHER rather than a guess.
 */
export function classifyVaultFileType(
  name: string,
  mimeType: string | null,
): VaultFileTypeCategory {
  const base = name.split('/').pop() ?? name;
  const dot = base.lastIndexOf('.');
  const extension =
    dot > 0 && dot < base.length - 1 ? base.slice(dot + 1).toLowerCase() : '';
  const byExtension = EXTENSION_CATEGORY[extension];
  if (byExtension) return byExtension;

  const mime = (mimeType ?? '').toLowerCase().split(';')[0].trim();
  const byMime = MIME_CATEGORY[mime];
  if (byMime) return byMime;
  if (mime.startsWith('image/')) return VaultFileTypeCategory.IMAGE;
  if (mime.startsWith('text/')) return VaultFileTypeCategory.TEXT;
  return VaultFileTypeCategory.OTHER;
}

/** Stable display order for the TYPE sort (PDFs first, OTHER last). */
export const FILE_TYPE_SORT_ORDER: VaultFileTypeCategory[] = [
  VaultFileTypeCategory.PDF,
  VaultFileTypeCategory.DOCUMENT,
  VaultFileTypeCategory.SPREADSHEET,
  VaultFileTypeCategory.PRESENTATION,
  VaultFileTypeCategory.IMAGE,
  VaultFileTypeCategory.CAD,
  VaultFileTypeCategory.TEXT,
  VaultFileTypeCategory.ARCHIVE,
  VaultFileTypeCategory.OTHER,
];

// ---- origin (which module filed the document) ----

/**
 * Names of the seeded DEFAULT folders that specific modules auto-file into.
 * There is NO stored "source module" column on VaultFile (audited against the
 * schema), so origin is derived from real referential data: the module's own
 * back-relation when one exists, else the identity of the module-owned folder
 * the file was filed into. Folder identity is not a guess — name + DEFAULT is
 * exactly how the modules themselves resolve these folders:
 * rfq-quote-vault.service.ts ('RFQ Quotes'), leads.service.ts
 * ('Lead Attachments'), scm.service.ts ('Vendor NDA'). The scope is
 * deliberately NOT part of the match: as seeded, Vendor NDA is COMPANY_WIDE
 * while RFQ Quotes and Lead Attachments are VERTICAL-scoped. DEFAULT is the
 * meaningful guard — only a SUPER_ADMIN can create a DEFAULT folder, so a
 * same-named CUSTOM folder someone made is not mistaken for a module's.
 */
export const ORIGIN_FOLDER_NAMES: Record<string, VaultFileOrigin> = {
  'Vendor NDA': VaultFileOrigin.VENDOR_QUALIFICATION,
  'RFQ Quotes': VaultFileOrigin.RFQ,
  'Lead Attachments': VaultFileOrigin.SALES_LEAD,
};

/** The referential signals that identify an auto-filed document. */
export interface VaultOriginSignals {
  hasDesignDocument: boolean;
  hasLeadAttachment: boolean;
  /** Signed vendor NDA questionnaire, or the company NDA template itself. */
  hasVendorNda: boolean;
  folderName: string;
  folderType: VaultFolderType;
}

/**
 * Which module filed this document, or MANUAL when nothing says otherwise.
 * Back-relations are checked first because they are hard links to the owning
 * record; folder identity is the fallback for the one module that keeps no FK
 * (RFQ quote files are matched by generated name — see rfq-quote-vault.service).
 */
export function deriveVaultFileOrigin(
  signals: VaultOriginSignals,
): VaultFileOrigin {
  if (signals.hasDesignDocument) return VaultFileOrigin.DESIGN;
  if (signals.hasLeadAttachment) return VaultFileOrigin.SALES_LEAD;
  if (signals.hasVendorNda) return VaultFileOrigin.VENDOR_QUALIFICATION;

  if (signals.folderType === VaultFolderType.DEFAULT) {
    const byFolder = ORIGIN_FOLDER_NAMES[signals.folderName];
    if (byFolder) return byFolder;
  }
  return VaultFileOrigin.MANUAL;
}
