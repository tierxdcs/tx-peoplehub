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
  /** The current user is SCM staff (SCM vertical) — gates the SCM group. */
  isScmStaff: boolean;
  isFinanceUser: boolean;
  isFinanceAuditor?: boolean;
  isAccountsHead: boolean;
  isQualityUser?: boolean;
  isQmsHead?: boolean;
  isDesignUser?: boolean;
  isDesignHead?: boolean;
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
 * module: optional payslips, plus manager-team tools for managers (a
 * Sales OR HR manager both manage their team's leave/attendance). Gated by
 * role only, never by module.
 */
export function sharedNav(access: Access): NavGroup[] {
  const groups: NavGroup[] = [];

  // Personal dashboard — the post-login landing for every role; always the
  // first entry back to "home" regardless of module.
  groups.push({
    heading: 'Home',
    items: [{ label: 'Dashboard', href: '/dashboard' }],
  });

  // Profile is available from the account dropdown, so it is not duplicated
  // in the sidebar. Payslips remains here when payroll self-service is enabled.
  const me: NavItem[] = [];
  if (access.payslipsEnabled)
    me.push({ label: 'My Payslips', href: '/payslips' });
  if (me.length) groups.push({ heading: 'Me', items: me });

  // "My Team" (roster, leave approvals, team attendance) is no longer a sidebar
  // group — those manager tools now live as tabs under My Profile (reached from
  // the account dropdown), alongside My Team / My Leave / My Attendance. The
  // standalone /team/* routes still exist and work; they're just not surfaced
  // in the sidebar.

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

  // Project Kickoff — cross-cutting and membership-scoped like Kanban; access
  // to individual kickoffs is decided server-side. Hidden from HR-vertical staff
  // (project kickoffs aren't part of the HR function).
  if (!access.isHrStaff) {
    groups.push({
      heading: 'Projects',
      items: [{ label: 'Project Kickoff', href: '/project-kickoff' }],
    });
  }

  // SCM — vendor + supplier qualification plus Purchase Orders. Restricted to
  // SCM-vertical staff and SUPER_ADMIN (procurement is their function). Backend
  // reads remain company-wide, but the nav group is not surfaced to other
  // verticals (Sales/Finance/HR/R&D/Production). PO create is further gated to
  // SCM Manager+/SA and self-guarded in the page.
  if (access.isScmStaff || flags(access.user).isSuperAdmin) {
    groups.push({
      heading: 'SCM',
      items: [
        { label: 'Vendors', href: '/scm/vendors' },
        { label: 'Suppliers', href: '/scm/suppliers' },
        { label: 'RFQs', href: '/scm/rfqs' },
        { label: 'Purchase Orders', href: '/stores/purchase-orders' },
      ],
    });
  }

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

  // Logistics & Dispatch — outbound Delivery Challans + OTD. Shown to Store
  // (Production) staff AND SCM staff (procurement/logistics overlap), plus
  // SUPER_ADMIN. Dispatch is gated to Production-vertical and final-QC clearance
  // to isQcInspector by the backend; read is company-wide there.
  if (
    access.isStoreStaff ||
    access.isScmStaff ||
    flags(access.user).isSuperAdmin
  ) {
    groups.push({
      heading: 'Logistics',
      items: [
        { label: 'Dispatch Register', href: '/logistics/dispatch' },
        { label: 'OTD Analytics', href: '/logistics/otd' },
      ],
    });
  }

  if (access.isFinanceUser || access.isAccountsHead) {
    // Trimmed to the core procure-to-pay / order-to-cash / GST spine: GL core,
    // AR, AP, and compliance. The four "leaf" finance modules — Treasury &
    // Credit, Schedules & Analytics + Budgets + Fixed Assets (management),
    // Bank Reconciliation + Exports + Production Readiness (operations), and
    // Executive Reporting (reporting) — are INTENTIONALLY HIDDEN from nav.
    // Their backend code, routes, models, and page files remain intact and
    // reachable by direct URL; they're built but not currently in use. Do NOT
    // re-add them to nav without a reason — hiding is a deliberate, reversible
    // trim (see the Finance discovery report). To restore one, just re-add its
    // NavItem line here.
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
      { label: 'Chart of Accounts', href: '/finance/accounts' },
      { label: 'Journal Entries', href: '/finance/journals' },
      { label: 'Financial Reports', href: '/finance/reports' },
      // Hidden leaf-module items (kept here, commented, for easy restore):
      // { label: 'Bank Reconciliation', href: '/finance/bank-reconciliation' }, // finance-operations
      // { label: 'Exports & Audit Pack', href: '/finance/exports' },            // finance-operations
      // { label: 'Production Readiness', href: '/finance/production-readiness' },// finance-operations
      // { label: 'Budgets', href: '/finance/budgets' },                         // finance-management
      // { label: 'Fixed Assets', href: '/finance/fixed-assets' },               // finance-management
      // { label: 'Schedules & Analytics', href: '/finance/management' },         // finance-management
      // { label: 'Treasury & Credit', href: '/finance/treasury' },              // finance-treasury
      // { label: 'Executive Reporting', href: '/finance/executive' },           // finance-reporting
    ];
    groups.push({ heading: 'Finance & Accounts', items: financeItems });
  } else if (access.isFinanceAuditor) {
    groups.push({
      heading: 'Finance Audit',
      items: [{ label: 'Executive Reporting', href: '/finance/executive' }],
    });
  }

  if (access.isQualityUser || access.isQmsHead) {
    groups.push({
      heading: 'Quality Management',
      items: [
        { label: 'QMS Dashboard', href: '/qms' },
        { label: 'Inspections', href: '/qms/inspections' },
        { label: 'Quality Plans', href: '/qms/plans' },
        { label: 'Question Templates', href: '/qms/templates' },
        { label: 'NCR Register', href: '/qms/ncrs' },
        { label: 'CAPA Tracker', href: '/qms/capas' },
        { label: 'Audit Programmes', href: '/qms/audit-programs' },
        { label: 'Audits', href: '/qms/audits' },
        { label: 'Quality Reports', href: '/qms/reports' },
        { label: 'Calibration', href: '/qms/calibration' },
        { label: 'Customer Complaints', href: '/qms/complaints' },
        { label: 'Supplier Quality', href: '/qms/supplier-quality' },
        { label: 'Quality Analytics', href: '/qms/analytics' },
      ],
    });
  }

  if (access.isDesignUser || access.isDesignHead) {
    groups.push({
      heading: 'Design Engineering',
      items: [
        { label: 'Design Dashboard', href: '/design' },
        { label: 'Design Requests', href: '/design/requests' },
        { label: 'Design Projects', href: '/design/projects' },
        { label: 'Design Controls', href: '/design/controls' },
        { label: 'Document Register', href: '/design/documents' },
        { label: 'Engineering Changes', href: '/design/changes' },
        { label: 'Design Reviews', href: '/design/reviews' },
        { label: 'Project Templates', href: '/design/templates' },
        { label: 'Document Transmittals', href: '/design/transmittals' },
        { label: 'Change Reports', href: '/design/change-reports' },
      ],
    });
  }

  return groups;
}

/** Operational HR module groups (employee administration / HR-vertical tools). */
export function hrNav(access: Access): NavGroup[] {
  const { isAdmin, isManager } = flags(access.user);
  // HR-vertical Managers run the People / Leave & Attendance / Payroll HR
  // functions alongside Admins (backend enforces the same via
  // HrManagerOrAdminGuard). Payroll is HR MANAGERS, not all HR staff.
  const isHrManager = access.isHrStaff && isManager;
  const groups: NavGroup[] = [];

  if (isAdmin) {
    groups.push({
      heading: 'Administration',
      items: [
        { label: 'Employees', href: '/admin/employees' },
        { label: 'Verticals', href: '/admin/verticals' },
        { label: 'Pending Access', href: '/admin/pending-access' },
        ...(flags(access.user).isSuperAdmin
          ? [
              { label: 'Business Units', href: '/admin/business-units' },
              { label: 'Finance Auditors', href: '/admin/finance-auditors' },
            ]
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

  if (isAdmin || isHrManager) {
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
 * The full sidebar: Home is always first, followed by the active operational
 * module and then the remaining shared groups. A zero-module user gets only
 * the shared groups, still beginning with Home.
 */
export function sidebarNav(
  access: Access,
  module: ModuleKey | undefined,
): NavGroup[] {
  const moduleGroups = module ? moduleNav(module, access) : [];
  const sharedGroups = sharedNav(access);
  const home = sharedGroups.filter((group) => group.heading === 'Home');
  const remainingShared = sharedGroups.filter(
    (group) => group.heading !== 'Home',
  );
  return [...home, ...moduleGroups, ...remainingShared];
}

/** First reachable route for a module — used for post-login landing + toggle. */
export function moduleHome(
  module: ModuleKey,
  access: Access,
): string | undefined {
  return moduleNav(module, access)[0]?.items[0]?.href;
}

/**
 * Where a user lands after login. The personal dashboard is now the single
 * post-login landing page for EVERY role — it degrades gracefully for a
 * brand-new employee with no tasks/projects and gives everyone a consistent
 * home. Module-specific homes remain reachable from the sidebar.
 */
export function landingRoute(_access: Access): string {
  return '/dashboard';
}
