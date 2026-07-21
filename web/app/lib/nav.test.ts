import { describe, expect, it } from 'vitest';
import type { DecodedAccessToken, Role } from './jwt';
import {
  activeModule,
  availableModules,
  landingRoute,
  sidebarNav,
  type Access,
} from './nav';

function access(
  role: Role,
  opts: {
    isHrStaff?: boolean;
    isSalesStaff?: boolean;
    isSalesHead?: boolean;
    isRndHead?: boolean;
    isRndStaff?: boolean;
    isStoreStaff?: boolean;
    isScmStaff?: boolean;
    isFinanceUser?: boolean;
  } = {},
): Access {
  const user: DecodedAccessToken = {
    sub: 'u1',
    email: 'u@x.com',
    role,
    verticalId: 'v1',
  };
  return {
    user,
    isHrStaff: opts.isHrStaff ?? false,
    isSalesStaff: opts.isSalesStaff ?? false,
    isSalesHead: opts.isSalesHead ?? false,
    isRndHead: opts.isRndHead ?? false,
    isFinanceUser: opts.isFinanceUser ?? false,
    isAccountsHead: false,
    isRndStaff: opts.isRndStaff ?? false,
    isStoreStaff: opts.isStoreStaff ?? false,
    isScmStaff: opts.isScmStaff ?? false,
    payslipsEnabled: false,
  };
}

/** Flatten sidebar item labels for easy assertions. */
function labels(a: Access, module: ReturnType<typeof activeModule>): string[] {
  return sidebarNav(a, module).flatMap((g) => g.items.map((i) => i.label));
}

describe('availableModules', () => {
  it('gives a Sales-vertical employee only the sales module', () => {
    expect(
      availableModules(access('EMPLOYEE', { isSalesStaff: true })),
    ).toEqual(['sales']);
  });
  it('gives an HR-vertical employee only the hr module', () => {
    expect(availableModules(access('EMPLOYEE', { isHrStaff: true }))).toEqual([
      'hr',
    ]);
  });
  it('gives SUPER_ADMIN both modules', () => {
    expect(availableModules(access('SUPER_ADMIN'))).toEqual(['hr', 'sales']);
  });
  it('gives plain ADMIN only hr (no Sales operational access)', () => {
    expect(availableModules(access('ADMIN'))).toEqual(['hr']);
  });
  it('gives a module-less employee (e.g. Production) no modules', () => {
    expect(availableModules(access('EMPLOYEE'))).toEqual([]);
  });
});

describe('activeModule', () => {
  it('single-module user always resolves to that module, regardless of path', () => {
    const mods = availableModules(access('MANAGER', { isSalesStaff: true }));
    // Even on a shared HR-ish path, a Sales-only user stays in Sales.
    expect(activeModule('/leave', mods)).toBe('sales');
    expect(activeModule('/team', mods)).toBe('sales');
    expect(activeModule('/sales/leads', mods)).toBe('sales');
  });
  it('multi-module user (SuperAdmin) derives module from the path', () => {
    const mods = availableModules(access('SUPER_ADMIN'));
    expect(activeModule('/sales/leads', mods)).toBe('sales');
    expect(activeModule('/admin/employees', mods)).toBe('hr');
    expect(activeModule('/leave', mods)).toBe('hr');
  });
  it('zero-module user has no active module', () => {
    expect(activeModule('/leave', [])).toBeUndefined();
  });
});

describe('sidebarNav — the reported bug', () => {
  it('always puts Home / Dashboard at the top of the sidebar', () => {
    for (const a of [
      access('EMPLOYEE', { isSalesStaff: true }),
      access('EMPLOYEE', { isHrStaff: true }),
      access('SUPER_ADMIN'),
      access('EMPLOYEE'),
    ]) {
      const activeNavModule = activeModule('/dashboard', availableModules(a));
      const groups = sidebarNav(a, activeNavModule);
      expect(groups[0]).toEqual({
        heading: 'Home',
        items: [{ label: 'Dashboard', href: '/dashboard' }],
      });
    }
  });

  it('a Sales MANAGER sees the Sales pipeline nav (was missing) plus shared items', () => {
    const a = access('MANAGER', { isSalesStaff: true });
    const mods = availableModules(a);
    const shown = labels(a, activeModule('/leave', mods));
    expect(shown).toContain('Leads');
    expect(shown).toContain('Bid Approvals'); // manager-only sales item
    expect(shown).not.toContain('My Profile'); // available from account dropdown
    // Must NOT leak HR-admin items.
    expect(shown).not.toContain('Employees');
    expect(shown).not.toContain('Payroll Runs');
  });

  it('a Sales EMPLOYEE sees Sales nav without the manager-only approvals item', () => {
    const a = access('EMPLOYEE', { isSalesStaff: true });
    const shown = labels(a, activeModule('/sales/leads', availableModules(a)));
    expect(shown).toContain('Leads');
    expect(shown).not.toContain('Bid Approvals');
    expect(shown).not.toContain('My Profile');
  });

  it('an HR EMPLOYEE sees HR People tools + shared items, no Sales', () => {
    const a = access('EMPLOYEE', { isHrStaff: true });
    const shown = labels(a, activeModule('/hr/roster', availableModules(a)));
    expect(shown).toContain('Roster');
    expect(shown).not.toContain('My Profile');
    expect(shown).not.toContain('Leads');
    // HR staff don't do project kickoffs — the Projects group is hidden.
    expect(shown).not.toContain('Project Kickoff');
  });

  it('a non-HR employee still sees Project Kickoff (cross-cutting)', () => {
    const a = access('EMPLOYEE', { isSalesStaff: true });
    const shown = labels(a, activeModule('/sales/leads', availableModules(a)));
    expect(shown).toContain('Project Kickoff');
  });

  it('an HR MANAGER sees Leave & Attendance + Payroll (HR-lead functions)', () => {
    const a = access('MANAGER', { isHrStaff: true });
    const shown = labels(a, activeModule('/hr/roster', availableModules(a)));
    expect(shown).toContain('Roster'); // People
    expect(shown).toContain('All Pending Approvals'); // Leave & Attendance
    expect(shown).toContain('Attendance Corrections');
    expect(shown).toContain('Salary Structures'); // Payroll
    expect(shown).toContain('Payroll Runs');
    expect(shown).toContain('Statutory Config');
    // Not an admin — must NOT get the Administration group.
    expect(shown).not.toContain('Employees');
    expect(shown).not.toContain('Verticals');
  });

  it('an HR EMPLOYEE does NOT get Payroll or Leave & Attendance (HR Managers only)', () => {
    const a = access('EMPLOYEE', { isHrStaff: true });
    const shown = labels(a, activeModule('/hr/roster', availableModules(a)));
    expect(shown).not.toContain('Salary Structures');
    expect(shown).not.toContain('Payroll Runs');
    expect(shown).not.toContain('All Pending Approvals');
  });

  it('R&D staff see the Engineering group (Products + Bills of Materials)', () => {
    const a = access('EMPLOYEE', { isRndStaff: true });
    const shown = labels(a, activeModule('/scm/bom', availableModules(a)));
    expect(shown).toContain('Bills of Materials');
    // Products management now lives under Engineering (R&D-only).
    expect(shown).toContain('Products');
    // Non-R&D-Head R&D staff do NOT see the BOM approval queue.
    expect(shown).not.toContain('BOM Approvals');
  });

  it('a non-R&D user does NOT see the Engineering group (incl. Products)', () => {
    const a = access('EMPLOYEE');
    const shown = labels(a, activeModule('/profile', availableModules(a)));
    expect(shown).not.toContain('Bills of Materials');
    expect(shown).not.toContain('BOM Approvals');
    expect(shown).not.toContain('Products');
  });

  it('a Sales rep no longer sees Products (moved to Engineering) but keeps Customer Master', () => {
    const a = access('EMPLOYEE', { isSalesStaff: true });
    const shown = labels(a, activeModule('/sales/leads', availableModules(a)));
    expect(shown).toContain('Customer Master');
    expect(shown).not.toContain('Products');
  });

  it('an R&D Head (R&D staff) additionally sees the BOM Approvals queue', () => {
    const a = access('EMPLOYEE', { isRndStaff: true, isRndHead: true });
    const shown = labels(a, activeModule('/scm/bom', availableModules(a)));
    expect(shown).toContain('Bills of Materials');
    expect(shown).toContain('BOM Approvals');
  });

  it('Store staff see Store Management but NOT the Engineering group', () => {
    const a = access('EMPLOYEE', { isStoreStaff: true });
    const shown = labels(a, activeModule('/scm/items', availableModules(a)));
    expect(shown).toContain('Item Master');
    expect(shown).toContain('Inventory');
    // Engineering is R&D-only — Store staff no longer see BOMs in the nav.
    expect(shown).not.toContain('Bills of Materials');
    expect(shown).not.toContain('BOM Approvals');
  });

  it('a non-Store, non-SuperAdmin user does NOT see Store Management', () => {
    const a = access('EMPLOYEE');
    const shown = labels(a, activeModule('/profile', availableModules(a)));
    expect(shown).not.toContain('Item Master');
    expect(shown).not.toContain('Inventory');
  });

  it('SCM staff see the SCM group (Vendors / Suppliers / Purchase Orders)', () => {
    const a = access('EMPLOYEE', { isScmStaff: true });
    const shown = labels(a, activeModule('/scm/vendors', availableModules(a)));
    expect(shown).toContain('Vendors');
    expect(shown).toContain('Suppliers');
    expect(shown).toContain('Purchase Orders');
  });

  it('a non-SCM, non-SuperAdmin user does NOT see the SCM group', () => {
    const a = access('EMPLOYEE', { isSalesStaff: true });
    const shown = labels(a, activeModule('/sales/leads', availableModules(a)));
    expect(shown).not.toContain('Vendors');
    expect(shown).not.toContain('Suppliers');
    expect(shown).not.toContain('Purchase Orders');
  });

  it('SUPER_ADMIN still sees the SCM group', () => {
    const a = access('SUPER_ADMIN');
    const shown = labels(a, activeModule('/scm/vendors', availableModules(a)));
    expect(shown).toContain('Vendors');
    expect(shown).toContain('Purchase Orders');
  });

  it('Store staff see the Store Management receiving items (GRN / NCR / Material Issue)', () => {
    const a = access('EMPLOYEE', { isStoreStaff: true });
    const shown = labels(a, activeModule('/stores/grn', availableModules(a)));
    expect(shown).toContain('GRN Register');
    expect(shown).toContain('Non-Conformance');
    expect(shown).toContain('Material Issue');
  });

  it('Store staff see the Logistics group (Dispatch Register / OTD)', () => {
    const a = access('EMPLOYEE', { isStoreStaff: true });
    const shown = labels(
      a,
      activeModule('/logistics/dispatch', availableModules(a)),
    );
    expect(shown).toContain('Dispatch Register');
    expect(shown).toContain('OTD Analytics');
  });

  it('SCM staff also see the Logistics group', () => {
    const a = access('EMPLOYEE', { isScmStaff: true });
    const shown = labels(
      a,
      activeModule('/logistics/dispatch', availableModules(a)),
    );
    expect(shown).toContain('Dispatch Register');
    expect(shown).toContain('OTD Analytics');
  });

  it('a non-Store, non-SuperAdmin user does NOT see the Logistics group', () => {
    const a = access('EMPLOYEE');
    const shown = labels(a, activeModule('/profile', availableModules(a)));
    expect(shown).not.toContain('Dispatch Register');
  });

  it('a non-Store, non-SuperAdmin user does NOT see the Store receiving items', () => {
    const a = access('EMPLOYEE');
    const shown = labels(a, activeModule('/profile', availableModules(a)));
    expect(shown).not.toContain('GRN Register');
    expect(shown).not.toContain('Material Issue');
  });

  it('SUPER_ADMIN sees both Engineering and Store Management without the flags', () => {
    const a = access('SUPER_ADMIN');
    const shown = labels(a, activeModule('/scm/items', availableModules(a)));
    expect(shown).toContain('Item Master');
    expect(shown).toContain('Inventory');
    expect(shown).toContain('Bills of Materials');
  });

  // Personal profile and self-service tabs are reached from the account
  // dropdown/profile page and are not duplicated in the sidebar.
  it('does not duplicate profile or its tabs in the sidebar', () => {
    for (const role of [
      'SUPER_ADMIN',
      'ADMIN',
      'MANAGER',
      'EMPLOYEE',
    ] as const) {
      const a = access(role);
      const shown = labels(a, activeModule('/profile', availableModules(a)));
      expect(shown).not.toContain('My Profile');
      expect(shown).not.toContain('My Team');
      expect(shown).not.toContain('My Leave');
      expect(shown).not.toContain('My Attendance');
    }
  });

  it('a module-less EMPLOYEE (Production) sees only shared items', () => {
    const a = access('EMPLOYEE');
    const shown = labels(a, activeModule('/leave', availableModules(a)));
    expect(shown).toEqual(expect.arrayContaining(['Documents', 'Boards']));
    expect(shown).not.toContain('Leads');
    expect(shown).not.toContain('Roster');
  });

  it('Finance shows the Tally-style voucher/report labels and hides the leaf-module items', () => {
    const a = access('EMPLOYEE', { isFinanceUser: true });
    const shown = labels(
      a,
      activeModule('/finance/ar/invoices', availableModules(a)),
    );
    // Tally-aligned labels over the existing routes (Vouchers/Masters/Reports).
    expect(shown).toContain('Day Book');
    expect(shown).toContain('Sales Vouchers');
    expect(shown).toContain('Purchase Vouchers');
    expect(shown).toContain('Ledgers');
    expect(shown).toContain('Journal Vouchers');
    expect(shown).toContain('GST Reports');
    // Leaf modules are hidden from nav (code remains, just not surfaced).
    expect(shown).not.toContain('Treasury & Credit');
    expect(shown).not.toContain('Budgets');
    expect(shown).not.toContain('Fixed Assets');
    expect(shown).not.toContain('Bank Reconciliation');
    expect(shown).not.toContain('Executive Reporting');
    expect(shown).not.toContain('Production Readiness');
  });
});

describe('landingRoute', () => {
  // The personal dashboard is now the single post-login landing for every role.
  it('sends every role to the personal dashboard', () => {
    expect(landingRoute(access('MANAGER', { isSalesStaff: true }))).toBe(
      '/dashboard',
    );
    expect(landingRoute(access('EMPLOYEE', { isSalesStaff: true }))).toBe(
      '/dashboard',
    );
    expect(landingRoute(access('ADMIN'))).toBe('/dashboard');
    expect(landingRoute(access('SUPER_ADMIN'))).toBe('/dashboard');
    expect(landingRoute(access('MANAGER', { isHrStaff: true }))).toBe(
      '/dashboard',
    );
    expect(landingRoute(access('EMPLOYEE'))).toBe('/dashboard');
  });
});

describe('sharedNav — dashboard', () => {
  it('every role gets the Dashboard nav item', () => {
    for (const role of [
      'SUPER_ADMIN',
      'ADMIN',
      'MANAGER',
      'EMPLOYEE',
    ] as const) {
      const a = access(role);
      const shown = labels(a, activeModule('/dashboard', availableModules(a)));
      expect(shown).toContain('Dashboard');
    }
  });
});
