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
  /** The current user holds the R&D Head designation (gates the BOM approval queue). */
  isRndHead: boolean;
  /** The current user is R&D staff (RND vertical) — gates the Engineering group. */
  isRndStaff: boolean;
  /** The current user is Store staff (PRODUCTION vertical) — gates Store Management. */
  isStoreStaff: boolean;
  isFinanceUser: boolean;
  isFinanceAuditor?: boolean;
  isAccountsHead: boolean;
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
  const { isManager } = flags(access.user);
  const groups: NavGroup[] = [];

  // My Team, My Leave, and My Attendance now live as tabs INSIDE the profile
  // page, so the nav collapses to a single "My Profile" entry (shown to
  // everyone — it's the home for those personal self-service tabs, gated
  // inside the page itself). Payslips stays a separate link. The standalone
  // /team, /leave, /attendance routes still resolve directly (bookmarks, deep
  // links), they're just no longer surfaced in the sidebar.
  const me: NavItem[] = [{ label: 'My Profile', href: '/profile' }];
  if (access.payslipsEnabled)
    me.push({ label: 'My Payslips', href: '/payslips' });
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

  // Vault (document management) is cross-cutting — every authenticated employee
  // sees it regardless of role or vertical. Content within is access-scoped by
  // the backend; the nav item itself is ungated by design.
  groups.push({
    heading: 'Vault',
    items: [{ label: 'Documents', href: '/vault' }],
  });

  // Kanban is likewise cross-cutting and membership-scoped — everyone sees the
  // nav item; which boards they can actually open is decided by board
  // membership on the server. Sprints spans every board they belong to.
  groups.push({
    heading: 'Boards',
    items: [
      { label: 'Boards', href: '/kanban' },
      { label: 'Sprints', href: '/kanban/sprints' },
    ],
  });

  // Project Kickoff — cross-cutting and membership-scoped like Kanban; everyone
  // sees the nav item, access to individual kickoffs is decided server-side.
  groups.push({
    heading: 'Projects',
    items: [{ label: 'Project Kickoff', href: '/project-kickoff' }],
  });

  // SCM — vendor + supplier qualification plus Purchase Orders. Raising a PO is
  // a purchasing (SCM) activity, distinct from the Stores receiving flow, so it
  // lives here next to the trading partners it references. Company-wide read
  // (like Vendors/Suppliers), so everyone sees the nav items; PO create is
  // gated to SCM Manager+ by the backend and self-guarded in the page.
  groups.push({
    heading: 'SCM',
    items: [
      { label: 'Vendors', href: '/scm/vendors' },
      { label: 'Suppliers', href: '/scm/suppliers' },
      { label: 'Purchase Orders', href: '/stores/purchase-orders' },
    ],
  });

  // Engineering — Bills of Materials. R&D-only (RND vertical; SUPER_ADMIN
  // included via isRndStaff). Create/approve actions are further gated inside
  // the pages + backend. The BOM Approval Queue is shown only to R&D Heads (the
  // approvers), mirroring the Sales-Head-gated items.
  if (access.isRndStaff || flags(access.user).isSuperAdmin) {
    const engineeringItems: NavItem[] = [
      // Products live under Engineering: only R&D adds/edits them. Sales still
      // reference products through bid/order line pickers (separate endpoints),
      // they just don't get the product-management entry point here.
      { label: 'Products', href: '/sales/products' },
      { label: 'Bills of Materials', href: '/scm/bom' },
    ];
    if (access.isRndHead) {
      engineeringItems.push({
        label: 'BOM Approvals',
        href: '/scm/bom/pending-approval',
      });
    }
    groups.push({ heading: 'Engineering', items: engineeringItems });
  }

  // Store Management — Item Master + Inventory. Shown to Store staff (the
  // PRODUCTION vertical) and SUPER_ADMIN; item create/edit + stock adjustments
  // are gated inside the pages by the backend. R&D can still reach Item Master
  // and inventory read via direct links; the nav group is Store-scoped.
  if (access.isStoreStaff || flags(access.user).isSuperAdmin) {
    // Store Management: master data (Item Master, Inventory) plus the receiving
    // flow (GRN + QC → NCR) and Material Issue. Purchase Orders live in the SCM
    // group (raising a PO is a purchasing activity). Same audience (PRODUCTION
    // vertical + SUPER_ADMIN); QC is gated to isQcInspector by the backend —
    // the pages self-guard those actions.
    groups.push({
      heading: 'Store Management',
      items: [
        { label: 'Item Master', href: '/scm/items' },
        { label: 'Inventory', href: '/scm/inventory' },
        { label: 'GRN Register', href: '/stores/grn' },
        { label: 'Non-Conformance', href: '/stores/ncr' },
        { label: 'Material Issue', href: '/stores/material-issue' },
      ],
    });
  }

  if (access.isFinanceUser || access.isAccountsHead) {
    const financeItems: NavItem[] = [
      { label: 'Sales Invoices', href: '/finance/ar/invoices' },
      { label: 'Customer Receipts', href: '/finance/ar/receipts' },
      { label: 'AR Summary', href: '/finance/ar/summary' },
      { label: 'Vendor Invoices', href: '/finance/ap/invoices' },
      { label: 'Vendor Payments', href: '/finance/ap/payments' },
      { label: 'AP Summary', href: '/finance/ap/summary' },
      { label: 'Payment Calendar', href: '/finance/payment-calendar' },
      { label: 'Credit & Debit Notes', href: '/finance/adjustments' },
      { label: 'GST, TDS & Forecast', href: '/finance/compliance' },
      { label: 'Statutory Filings', href: '/finance/filings' },
      { label: 'Period Close', href: '/finance/period-close' },
      { label: 'Bank Reconciliation', href: '/finance/bank-reconciliation' },
      { label: 'Exports & Audit Pack', href: '/finance/exports' },
      { label: 'Budgets', href: '/finance/budgets' },
      { label: 'Fixed Assets', href: '/finance/fixed-assets' },
      { label: 'Schedules & Analytics', href: '/finance/management' },
      { label: 'Treasury & Credit', href: '/finance/treasury' },
      { label: 'Chart of Accounts', href: '/finance/accounts' },
      { label: 'Journal Entries', href: '/finance/journals' },
      { label: 'Financial Reports', href: '/finance/reports' },
      { label: 'Executive Reporting', href: '/finance/executive' },
      { label: 'Production Readiness', href: '/finance/production-readiness' },
    ];
    groups.push({ heading: 'Finance & Accounts', items: financeItems });
  } else if (access.isFinanceAuditor) {
    groups.push({
      heading: 'Finance Audit',
      items: [{ label: 'Executive Reporting', href: '/finance/executive' }],
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
        ...(flags(access.user).isSuperAdmin
          ? [{ label: 'Finance Auditors', href: '/admin/finance-auditors' }]
          : []),
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
        {
          label: 'Attendance Corrections',
          href: '/admin/attendance-corrections',
        },
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
    pipeline.push({
      label: 'Bid Approvals',
      href: '/sales/bids/pending-approval',
    });
  }
  // Bid/No-Bid assessment review — only the designated Sales Head (any Sales
  // role) or SUPER_ADMIN. The page also self-guards, but gating the nav item
  // keeps it hidden from reps who can't act on it.
  if (access.isSalesHead || isSuperAdmin) {
    pipeline.push({
      label: 'Assessment Approvals',
      href: '/sales/bid-assessments/pending-approval',
    });
    // Order Confirmation Sheets awaiting the Sales Head's countersignature —
    // same audience as Assessment Approvals.
    pipeline.push({
      label: 'Confirmation Sheets',
      href: '/sales/confirmation-sheets/pending-approval',
    });
  }
  return [
    { heading: 'Pipeline', items: pipeline },
    {
      heading: 'Master Data',
      // Products moved to the Engineering group (R&D-only management). Customer
      // Master stays here — it's Sales-owned.
      items: [{ label: 'Customer Master', href: '/sales/customers' }],
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
export function moduleHome(
  module: ModuleKey,
  access: Access,
): string | undefined {
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
