import { describe, expect, it } from 'vitest';
import type { NavLeaf } from './nav';
import {
  NAV_SEARCH_LIMIT,
  normaliseQuery,
  scoreText,
  searchNav,
} from './nav-search';

function leaf(label: string, href: string, section: string): NavLeaf {
  return { label, href, section };
}

const LEAVES: NavLeaf[] = [
  leaf('Employees', '/admin/employees', 'Administration'),
  leaf('Employee Onboarding', '/hr/onboarding', 'HR'),
  leaf('Salary Structures', '/hr/salary-structures', 'Payroll'),
  leaf('Payslips', '/hr/payslips', 'Payroll'),
  leaf('Purchase Orders', '/scm/purchase-orders', 'SCM'),
  leaf('Sales Voucher', '/finance/vouchers/sales', 'Vouchers'),
  leaf('Purchase Voucher', '/finance/vouchers/purchase', 'Vouchers'),
  leaf('Journal Voucher', '/finance/vouchers/journal', 'Vouchers'),
  leaf('Invoices', '/finance/invoices', 'Finance'),
  leaf('Leads', '/sales/leads', 'Sales'),
];

function hrefs(query: string) {
  return searchNav(query, LEAVES).map((hit) => hit.leaf.href);
}

describe('normaliseQuery', () => {
  it('lowercases and collapses punctuation to single spaces', () => {
    expect(normaliseQuery('  Salary-Structures! ')).toBe('salary structures');
  });
});

describe('searchNav', () => {
  it('returns nothing for an empty or punctuation-only query', () => {
    expect(searchNav('', LEAVES)).toEqual([]);
    expect(searchNav('   -- ', LEAVES)).toEqual([]);
  });

  it('matches a prefix of a single word ("emp" → Employees)', () => {
    expect(hrefs('emp')[0]).toBe('/admin/employees');
  });

  it('matches per-word prefixes across words ("sal str")', () => {
    expect(hrefs('sal str')[0]).toBe('/hr/salary-structures');
  });

  it('lists every page a prefix reaches, shortest label first', () => {
    const results = hrefs('employee');
    expect(results[0]).toBe('/admin/employees');
    expect(results).toContain('/hr/onboarding');
  });

  it('finds a page from a mid-label word ("orders")', () => {
    expect(hrefs('orders')).toContain('/scm/purchase-orders');
  });

  it('matches initials ("pv" → Purchase Voucher)', () => {
    expect(hrefs('pv')).toContain('/finance/vouchers/purchase');
  });

  it('lists a section’s pages when the section name is typed', () => {
    const results = hrefs('vouchers');
    expect(results).toContain('/finance/vouchers/sales');
    expect(results).toContain('/finance/vouchers/purchase');
    expect(results).toContain('/finance/vouchers/journal');
  });

  it('lets a label hit outrank a section hit for the same word', () => {
    // "Sales Voucher" (label) must beat pages merely sitting in the Sales
    // section, since the section score is discounted.
    const results = searchNav('sales voucher', LEAVES);
    expect(results[0].leaf.href).toBe('/finance/vouchers/sales');
  });

  it('finds a page whose section differs from the query word entirely', () => {
    // Nothing about "leads" mentions its section — the leaf label alone matches.
    expect(hrefs('leads')).toEqual(['/sales/leads']);
  });

  it('drops noise instead of listing every page', () => {
    expect(searchNav('zzzqqq', LEAVES)).toEqual([]);
  });

  it('caps the result list', () => {
    const many = Array.from({ length: 30 }, (_, i) =>
      leaf(`Voucher ${i}`, `/v/${i}`, 'Vouchers'),
    );
    expect(searchNav('voucher', many).length).toBe(NAV_SEARCH_LIMIT);
    expect(searchNav('voucher', many, 3).length).toBe(3);
  });

  it('orders equal scores deterministically (shorter label, then A→Z)', () => {
    const ties = [
      leaf('Bravo Report', '/b', 'X'),
      leaf('Alpha Report', '/a', 'X'),
      leaf('Report', '/r', 'X'),
    ];
    expect(searchNav('report', ties).map((h) => h.leaf.href)).toEqual([
      '/r',
      '/a',
      '/b',
    ]);
  });

  it('scores every hit inside the 0..1 band', () => {
    for (const hit of searchNav('pay', LEAVES)) {
      expect(hit.score).toBeGreaterThan(0);
      expect(hit.score).toBeLessThanOrEqual(1);
    }
  });
});

describe('scoreText', () => {
  it('gives an exact match the top score', () => {
    expect(scoreText('payslips', 'Payslips')).toBe(1);
  });

  it('scores prefix above substring above loose subsequence', () => {
    const prefix = scoreText('purchase', 'Purchase Orders');
    const substring = scoreText('orders', 'Purchase Orders');
    const loose = scoreText('pchor', 'Purchase Orders');
    expect(prefix).toBeGreaterThan(substring);
    expect(substring).toBeGreaterThan(loose);
    expect(loose).toBeGreaterThan(0);
  });

  it('returns 0 when nothing matches', () => {
    expect(scoreText('xyz', 'Payslips')).toBe(0);
    expect(scoreText('', 'Payslips')).toBe(0);
  });
});
