import { VaultFolderType } from '@prisma/client';
import {
  VaultFileOrigin,
  VaultFileTypeCategory,
} from './dto/vault-search-query.dto';
import {
  FILE_TYPE_SORT_ORDER,
  VAULT_SEARCH_MIN_SCORE,
  classifyVaultFileType,
  deriveVaultFileOrigin,
  normaliseVaultTerm,
  vaultFuzzyScore,
} from './vault-search';

/** Score a raw (un-normalised) query the way the service does. */
function score(query: string, text: string): number {
  return vaultFuzzyScore(normaliseVaultTerm(query), text);
}

/** Does this query match this name at all? */
function matches(query: string, text: string): boolean {
  return score(query, text) >= VAULT_SEARCH_MIN_SCORE;
}

describe('normaliseVaultTerm', () => {
  it('lowercases and collapses punctuation to single spaces', () => {
    expect(normaliseVaultTerm('  RFQ-Quote__2026.pdf ')).toBe(
      'rfq quote 2026 pdf',
    );
    expect(normaliseVaultTerm('***')).toBe('');
  });
});

describe('vaultFuzzyScore', () => {
  it('is fuzzy, not exact-substring — a prefix of one word still matches', () => {
    // The confirmed gap this replaces: strict substring matching misses these.
    expect(matches('quot', 'RFQ-Quote-2026.pdf')).toBe(true);
    expect(matches('ven nda', 'Vendor NDA signed.pdf')).toBe(true);
    expect(matches('invcs', 'Invoices.xlsx')).toBe(true);
  });

  it('ranks in explainable bands: exact > prefix > token-prefix > substring', () => {
    expect(score('kickoff', 'Kickoff')).toBe(1);
    expect(score('kick', 'Kickoff Checklist.pdf')).toBe(0.95);
    // Both query tokens prefix distinct name tokens, but not from the start.
    expect(score('check kick', 'Kickoff Checklist.pdf')).toBe(0.85);
    expect(score('checklist', 'Kickoff Checklist.pdf')).toBe(0.85);
    expect(score('off check', 'Kickoff Checklist.pdf')).toBeLessThan(0.85);
  });

  it('ranks a real word above an initials-only match', () => {
    const word = score('quote', 'Vendor Quote Final.pdf');
    const initials = score('vqf', 'Vendor Quote Final.pdf');
    expect(word).toBeGreaterThan(initials);
    expect(initials).toBeGreaterThanOrEqual(VAULT_SEARCH_MIN_SCORE);
  });

  it('rejects noise rather than matching everything', () => {
    expect(matches('payroll', 'Vendor NDA signed.pdf')).toBe(false);
    expect(score('', 'anything.pdf')).toBe(0);
    expect(score('abc', '***')).toBe(0);
  });

  it('matches folder names with the same scorer as file names', () => {
    expect(matches('rfq', 'RFQ Quotes')).toBe(true);
    expect(matches('lead att', 'Lead Attachments')).toBe(true);
  });
});

describe('classifyVaultFileType', () => {
  it('classifies by extension across every bucket', () => {
    expect(classifyVaultFileType('a.pdf', null)).toBe(
      VaultFileTypeCategory.PDF,
    );
    expect(classifyVaultFileType('a.PNG', null)).toBe(
      VaultFileTypeCategory.IMAGE,
    );
    expect(classifyVaultFileType('a.xlsx', null)).toBe(
      VaultFileTypeCategory.SPREADSHEET,
    );
    expect(classifyVaultFileType('a.docx', null)).toBe(
      VaultFileTypeCategory.DOCUMENT,
    );
    expect(classifyVaultFileType('a.pptx', null)).toBe(
      VaultFileTypeCategory.PRESENTATION,
    );
    expect(classifyVaultFileType('a.step', null)).toBe(
      VaultFileTypeCategory.CAD,
    );
    expect(classifyVaultFileType('a.zip', null)).toBe(
      VaultFileTypeCategory.ARCHIVE,
    );
    expect(classifyVaultFileType('a.txt', null)).toBe(
      VaultFileTypeCategory.TEXT,
    );
  });

  it('trusts the extension over a wrong or generic mimetype', () => {
    // Browsers routinely declare octet-stream for office/CAD files.
    expect(
      classifyVaultFileType('drawing.dwg', 'application/octet-stream'),
    ).toBe(VaultFileTypeCategory.CAD);
    expect(classifyVaultFileType('report.pdf', 'text/plain')).toBe(
      VaultFileTypeCategory.PDF,
    );
  });

  it('falls back to the mimetype when the extension says nothing', () => {
    expect(classifyVaultFileType('scan', 'application/pdf')).toBe(
      VaultFileTypeCategory.PDF,
    );
    expect(classifyVaultFileType('scan', 'image/x-exotic')).toBe(
      VaultFileTypeCategory.IMAGE,
    );
    expect(
      classifyVaultFileType(
        'sheet',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet; charset=utf-8',
      ),
    ).toBe(VaultFileTypeCategory.SPREADSHEET);
  });

  it('is OTHER rather than a guess when nothing identifies the file', () => {
    expect(classifyVaultFileType('mystery', null)).toBe(
      VaultFileTypeCategory.OTHER,
    );
    expect(classifyVaultFileType('mystery.qqq', 'application/x-qqq')).toBe(
      VaultFileTypeCategory.OTHER,
    );
  });

  it('sorts every category, OTHER last', () => {
    const all = Object.values(VaultFileTypeCategory);
    expect([...FILE_TYPE_SORT_ORDER].sort()).toEqual([...all].sort());
    expect(FILE_TYPE_SORT_ORDER.at(-1)).toBe(VaultFileTypeCategory.OTHER);
  });
});

describe('deriveVaultFileOrigin', () => {
  const manualFolder = {
    hasDesignDocument: false,
    hasLeadAttachment: false,
    hasVendorNda: false,
    folderName: 'Project Notes',
    folderType: VaultFolderType.CUSTOM,
  };

  it('prefers a hard back-relation over folder identity', () => {
    expect(
      deriveVaultFileOrigin({ ...manualFolder, hasDesignDocument: true }),
    ).toBe(VaultFileOrigin.DESIGN);
    expect(
      deriveVaultFileOrigin({ ...manualFolder, hasLeadAttachment: true }),
    ).toBe(VaultFileOrigin.SALES_LEAD);
    expect(deriveVaultFileOrigin({ ...manualFolder, hasVendorNda: true })).toBe(
      VaultFileOrigin.VENDOR_QUALIFICATION,
    );
  });

  it('falls back to the module-owned DEFAULT folder it was filed into', () => {
    const defaultFolder = {
      ...manualFolder,
      folderType: VaultFolderType.DEFAULT,
    };
    // RFQ quote files carry no FK back to the quote (they are matched by
    // generated name), so folder identity is the only real signal. Scope is not
    // part of the match: as seeded, RFQ Quotes and Lead Attachments are
    // VERTICAL-scoped while Vendor NDA is COMPANY_WIDE.
    expect(
      deriveVaultFileOrigin({ ...defaultFolder, folderName: 'RFQ Quotes' }),
    ).toBe(VaultFileOrigin.RFQ);
    expect(
      deriveVaultFileOrigin({ ...defaultFolder, folderName: 'Vendor NDA' }),
    ).toBe(VaultFileOrigin.VENDOR_QUALIFICATION);
    expect(
      deriveVaultFileOrigin({
        ...defaultFolder,
        folderName: 'Lead Attachments',
      }),
    ).toBe(VaultFileOrigin.SALES_LEAD);
  });

  it('does not treat a look-alike folder as a module folder', () => {
    // Same name, but a CUSTOM/TEAM folder someone made — not the seeded one the
    // module files into.
    expect(
      deriveVaultFileOrigin({ ...manualFolder, folderName: 'RFQ Quotes' }),
    ).toBe(VaultFileOrigin.MANUAL);
  });

  it('is MANUAL for an ordinary human upload', () => {
    expect(deriveVaultFileOrigin(manualFolder)).toBe(VaultFileOrigin.MANUAL);
  });
});
