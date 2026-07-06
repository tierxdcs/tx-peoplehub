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
    payslipsEnabled: false,
  };
}

/** Flatten sidebar item labels for easy assertions. */
function labels(a: Access, module: ReturnType<typeof activeModule>): string[] {
  return sidebarNav(a, module).flatMap((g) => g.items.map((i) => i.label));
}

describe('availableModules', () => {
  it('gives a Sales-vertical employee only the sales module', () => {
    expect(availableModules(access('EMPLOYEE', { isSalesStaff: true }))).toEqual(['sales']);
  });
  it('gives an HR-vertical employee only the hr module', () => {
    expect(availableModules(access('EMPLOYEE', { isHrStaff: true }))).toEqual(['hr']);
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
  it('a Sales MANAGER sees the Sales pipeline nav (was missing) plus shared items', () => {
    const a = access('MANAGER', { isSalesStaff: true });
    const mods = availableModules(a);
    const shown = labels(a, activeModule('/leave', mods));
    expect(shown).toContain('Leads');
    expect(shown).toContain('Bid Approvals'); // manager-only sales item
    expect(shown).toContain('My Leave'); // shared items still present
    expect(shown).toContain('My Team');
    // Must NOT leak HR-admin items.
    expect(shown).not.toContain('Employees');
    expect(shown).not.toContain('Payroll Runs');
  });

  it('a Sales EMPLOYEE sees Sales nav without the manager-only approvals item', () => {
    const a = access('EMPLOYEE', { isSalesStaff: true });
    const shown = labels(a, activeModule('/sales/leads', availableModules(a)));
    expect(shown).toContain('Leads');
    expect(shown).not.toContain('Bid Approvals');
    expect(shown).toContain('My Leave');
  });

  it('an HR EMPLOYEE sees HR People tools + shared items, no Sales', () => {
    const a = access('EMPLOYEE', { isHrStaff: true });
    const shown = labels(a, activeModule('/hr/roster', availableModules(a)));
    expect(shown).toContain('Roster');
    expect(shown).toContain('My Leave');
    expect(shown).not.toContain('Leads');
  });

  it('a module-less EMPLOYEE (Production) sees only shared items', () => {
    const a = access('EMPLOYEE');
    const shown = labels(a, activeModule('/leave', availableModules(a)));
    expect(shown).toEqual(
      expect.arrayContaining(['My Profile', 'My Leave', 'My Attendance']),
    );
    expect(shown).not.toContain('Leads');
    expect(shown).not.toContain('Roster');
  });
});

describe('landingRoute', () => {
  it('sends a Sales-only manager into Sales', () => {
    expect(landingRoute(access('MANAGER', { isSalesStaff: true }))).toBe('/sales/leads');
  });
  it('sends a Sales-only employee into Sales', () => {
    expect(landingRoute(access('EMPLOYEE', { isSalesStaff: true }))).toBe('/sales/leads');
  });
  it('keeps Admin/SuperAdmin on the HR-admin home', () => {
    expect(landingRoute(access('ADMIN'))).toBe('/admin/employees');
    expect(landingRoute(access('SUPER_ADMIN'))).toBe('/admin/employees');
  });
  it('sends an HR/module-less manager to /team and employee to /profile', () => {
    expect(landingRoute(access('MANAGER', { isHrStaff: true }))).toBe('/team');
    expect(landingRoute(access('EMPLOYEE'))).toBe('/profile');
  });
});
