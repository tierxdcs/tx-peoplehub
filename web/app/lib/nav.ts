import type { DecodedAccessToken } from './jwt';

/**
 * Pure nav model. Encodes the same role/vertical gating the original flat nav
 * used — a visual reorg, not a permissions change.
 *
 * Structure: a set of ALWAYS-SHARED groups (personal self-service +
 * manager-team tools, available to a user regardless of which operational
 * module they belong to) plus zero-or-more OPERATIONAL modules (hr / sales)
 * gated by role + vertical. The sidebar renders the active module's groups
 * (if any) followed by the shared groups; the top-bar toggle appears only
 * when a user has more than one operational module.
 */

export type ModuleKey = 'hr' | 'sales';

export interface NavItem {
  label: string;
  href: string;
}
export interface NavGroup {
  heading: string;
  items: NavItem[];
}

export interface Access {
  user: DecodedAccessToken;
  isHrStaff: boolean;
  isSalesStaff: boolean;
  /** The current user holds the Sales Head designation (gates the assessment queue). */
  isSalesHead: boolean;
  payslipsEnabled: boolean;
}

function flags(user: DecodedAccessToken) {
  return {
    isAdmin: user.role === 'ADMIN' || user.role === 'SUPER_ADMIN',
    isManager: user.role === 'MANAGER',
    isEmployee: user.role === 'EMPLOYEE',
    isSuperAdmin: user.role === 'SUPER_ADMIN',
  };
}

/**
 * The operational modules this user may see.
 * - HR: Admin/SuperAdmin (employee administration) or HR-vertical staff.
 * - Sales: SuperAdmin (company-wide) or Sales-vertical staff — never plain Admin.
 * A user may have zero (e.g. a Production-vertical employee), one (the common
 * case), or both (SuperAdmin).
 */
export function availableModules(access: Access): ModuleKey[] {
  const { isAdmin, isSuperAdmin } = flags(access.user);
  const mods: ModuleKey[] = [];
  if (isAdmin || access.isHrStaff) mods.push('hr');
  if (isSuperAdmin || access.isSalesStaff) mods.push('sales');
  return mods;
}

/**
 * Which module's nav the sidebar shows.
 * - No modules → undefined (shared items only).
 * - Exactly one module → always that module (no ambiguity, pathname-independent),
 *   so a Sales-only rep always sees the Sales nav even on a shared page like /leave.
 * - Multiple modules (SuperAdmin) → derived from the pathname, so navigating
 *   into /sales/* shows Sales and everything else shows HR; the toggle switches.
 */
export function activeModule(
  pathname: string,
  modules: ModuleKey[],
): ModuleKey | undefined {
  if (modules.length === 0) return undefined;
  if (modules.length === 1) return modules[0];
  return pathname.startsWith('/sales') ? 'sales' : 'hr';
}

/**
 * Always-shared groups, available to every authenticated user regardless of
 * module: personal self-service, plus manager-team tools for managers (a
 * Sales OR HR manager both manage their team's leave/attendance). Gated by
 * role only, never by module.
 */
export function sharedNav(access: Access): NavGroup[] {
  const { isManager, isEmployee } = flags(access.user);
  const groups: NavGroup[] = [];

  const me: NavItem[] = [
    { label: 'My Leave', href: '/leave' },
    { label: 'My Attendance', href: '/attendance' },
  ];
  if (isEmployee) me.unshift({ label: 'My Profile', href: '/profile' });
  if (isManager) me.unshift({ label: 'My Team', href: '/team' });
  if (access.payslipsEnabled) me.push({ label: 'My Payslips', href: '/payslips' });
  groups.push({ heading: 'Me', items: me });

  if (isManager) {
    groups.push({
      heading: 'My Team',
      items: [
        { label: 'Leave Approvals', href: '/team/leave-approvals' },
        { label: 'Team Attendance', href: '/team/attendance' },
      ],
    });
  }

  return groups;
}

/** Operational HR module groups (employee administration / HR-vertical tools). */
export function hrNav(access: Access): NavGroup[] {
  const { isAdmin } = flags(access.user);
  const groups: NavGroup[] = [];

  if (isAdmin) {
    groups.push({
      heading: 'Administration',
      items: [
        { label: 'Employees', href: '/admin/employees' },
        { label: 'Verticals', href: '/admin/verticals' },
        { label: 'Pending Access', href: '/admin/pending-access' },
        {
          label: 'Bid Assessment Questions',
          href: '/admin/bid-assessment-questions',
        },
      ],
    });
  }

  // Roster/onboarding — Admin or HR-vertical staff.
  if (isAdmin || access.isHrStaff) {
    groups.push({
      heading: 'People',
      items: [
        { label: 'Roster', href: '/hr/roster' },
        { label: 'Onboard Employee', href: '/hr/onboard' },
      ],
    });
  }

  if (isAdmin) {
    groups.push({
      heading: 'Leave & Attendance',
      items: [
        { label: 'All Pending Approvals', href: '/admin/leave-approvals' },
        { label: 'Attendance Corrections', href: '/admin/attendance-corrections' },
      ],
    });
    groups.push({
      heading: 'Payroll',
      items: [
        { label: 'Salary Structures', href: '/admin/salary-structures' },
        { label: 'Payroll Runs', href: '/admin/payroll-runs' },
        { label: 'Statutory Config', href: '/admin/statutory-config' },
      ],
    });
  }

  return groups;
}

/** Operational Sales module groups (SuperAdmin or Sales-vertical staff). */
export function salesNav(access: Access): NavGroup[] {
  const { isManager, isSuperAdmin } = flags(access.user);
  const pipeline: NavItem[] = [
    { label: 'Leads', href: '/sales/leads' },
    { label: 'Opportunities', href: '/sales/opportunities' },
    { label: 'Bids', href: '/sales/bids' },
    { label: 'Orders', href: '/sales/orders' },
  ];
  if (isManager || isSuperAdmin) {
    pipeline.push({ label: 'Bid Approvals', href: '/sales/bids/pending-approval' });
  }
  // Bid/No-Bid assessment review — only the designated Sales Head (any Sales
  // role) or SUPER_ADMIN. The page also self-guards, but gating the nav item
  // keeps it hidden from reps who can't act on it.
  if (access.isSalesHead || isSuperAdmin) {
    pipeline.push({
      label: 'Assessment Approvals',
      href: '/sales/bid-assessments/pending-approval',
    });
  }
  return [
    { heading: 'Pipeline', items: pipeline },
    {
      heading: 'Master Data',
      items: [
        { label: 'Customer Master', href: '/sales/customers' },
        { label: 'Products', href: '/sales/products' },
      ],
    },
  ];
}

function moduleNav(module: ModuleKey, access: Access): NavGroup[] {
  return module === 'sales' ? salesNav(access) : hrNav(access);
}

/**
 * The full sidebar: the active operational module's groups (if the user has
 * one) followed by the always-shared groups. A zero-module user gets only the
 * shared groups.
 */
export function sidebarNav(
  access: Access,
  module: ModuleKey | undefined,
): NavGroup[] {
  const moduleGroups = module ? moduleNav(module, access) : [];
  return [...moduleGroups, ...sharedNav(access)];
}

/** First reachable route for a module — used for post-login landing + toggle. */
export function moduleHome(module: ModuleKey, access: Access): string | undefined {
  return moduleNav(module, access)[0]?.items[0]?.href;
}

/**
 * Where a user lands after login. Module-aware: a Sales-only rep goes straight
 * into Sales rather than a shared page. Admin/SuperAdmin keep their HR-admin
 * home; HR-vertical staff and module-less users get their role-based shared
 * home (unchanged from the original roleHome behavior).
 */
export function landingRoute(access: Access): string {
  const { isAdmin, isManager } = flags(access.user);
  const modules = availableModules(access);

  if (isAdmin) return '/admin/employees';
  if (modules.length === 1 && modules[0] === 'sales') {
    return moduleHome('sales', access) ?? '/sales/leads';
  }
  return isManager ? '/team' : '/profile';
}
