import {
  AccessStatus,
  AccountType,
  BidAssessmentQuestionType,
  LeaveAccrualType,
  OrderLineDeliveryType,
  PrismaClient,
  Role,
  NormalBalance,
  ProvisioningApproverType,
  VaultFolderType,
  VaultGranteeType,
  VaultVisibilityScope,
} from '@prisma/client';
import * as bcrypt from 'bcrypt';

const VERTICALS: Array<{ name: string; code: string }> = [
  { name: 'Sales', code: 'SALES' },
  { name: 'HR', code: 'HR' },
  { name: 'Production', code: 'PRODUCTION' },
  { name: 'SCM', code: 'SCM' },
  { name: 'R&D', code: 'RND' },
  { name: 'Accounts', code: 'ACCOUNTS' },
  { name: 'Design', code: 'DESIGN' },
  { name: 'Quality', code: 'QUALITY' },
];

/// Business units a product can belong to. Idempotent upsert by `code`.
/// displayOrder controls dropdown/management ordering. `update` intentionally
/// refreshes name/description/order so tweaks to this list propagate on re-seed,
/// while never resurrecting a manually deactivated unit (isActive is omitted).
const BUSINESS_UNITS: Array<{
  name: string;
  code: string;
  description: string;
  displayOrder: number;
  colorHex: string;
}> = [
  { name: 'Phaze Edge', code: 'EDGE', description: 'Edge and micro data-centre solutions.', displayOrder: 1, colorHex: '#2563EB' },
  { name: 'Phaze Infrastructure', code: 'INFRA', description: 'Racks, cabinets, enclosures and physical infrastructure.', displayOrder: 2, colorHex: '#64748B' },
  { name: 'Phaze Hyperscale', code: 'HYPERSCALE', description: 'Hyperscale and OCP/ORV-class deployments.', displayOrder: 3, colorHex: '#7C3AED' },
  { name: 'Phaze MOD', code: 'MOD', description: 'Modular and containerised data-centre systems.', displayOrder: 4, colorHex: '#0891B2' },
  { name: 'Phaze Intelligence', code: 'INTELLIGENCE', description: 'Monitoring, software and intelligent systems.', displayOrder: 5, colorHex: '#D97706' },
  { name: 'Phaze Services', code: 'SERVICES', description: 'Services, support and everything not otherwise classified.', displayOrder: 6, colorHex: '#059669' },
];

/// Default store/warehouse locations for the inventory MVP (idempotent).
const STORE_LOCATIONS: Array<{ code: string; name: string }> = [
  { code: 'MAIN', name: 'Main Store' },
];

const CURRENCIES = [
  { code: 'INR', name: 'Indian Rupee', symbol: '₹', isBase: true },
  { code: 'USD', name: 'US Dollar', symbol: '$', isBase: false },
  { code: 'CAD', name: 'Canadian Dollar', symbol: 'C$', isBase: false },
  { code: 'EUR', name: 'Euro', symbol: '€', isBase: false },
];

const BASE_ACCOUNTS: Array<{
  code: string;
  name: string;
  accountType: AccountType;
  normalBalance: NormalBalance;
  isControlAccount?: boolean;
}> = [
  {
    code: '1000',
    name: 'Cash and Bank',
    accountType: AccountType.ASSET,
    normalBalance: NormalBalance.DEBIT,
  },
  {
    code: '1100',
    name: 'Accounts Receivable',
    accountType: AccountType.ASSET,
    normalBalance: NormalBalance.DEBIT,
    isControlAccount: true,
  },
  {
    code: '1200',
    name: 'Inventory',
    accountType: AccountType.ASSET,
    normalBalance: NormalBalance.DEBIT,
    isControlAccount: true,
  },
  {
    code: '1300',
    name: 'Input GST',
    accountType: AccountType.ASSET,
    normalBalance: NormalBalance.DEBIT,
    isControlAccount: true,
  },
  {
    code: '1400',
    name: 'TDS Receivable',
    accountType: AccountType.ASSET,
    normalBalance: NormalBalance.DEBIT,
    isControlAccount: true,
  },
  {
    code: '1500',
    name: 'Supplier Advances',
    accountType: AccountType.ASSET,
    normalBalance: NormalBalance.DEBIT,
    isControlAccount: true,
  },
  {
    code: '1600',
    name: 'Property, Plant and Equipment',
    accountType: AccountType.ASSET,
    normalBalance: NormalBalance.DEBIT,
    isControlAccount: true,
  },
  {
    code: '1650',
    name: 'Accumulated Depreciation',
    accountType: AccountType.ASSET,
    normalBalance: NormalBalance.CREDIT,
    isControlAccount: true,
  },
  {
    code: '1700',
    name: 'Prepaid Expenses',
    accountType: AccountType.ASSET,
    normalBalance: NormalBalance.DEBIT,
  },
  {
    code: '2000',
    name: 'Accounts Payable',
    accountType: AccountType.LIABILITY,
    normalBalance: NormalBalance.CREDIT,
    isControlAccount: true,
  },
  {
    code: '2100',
    name: 'Output GST',
    accountType: AccountType.LIABILITY,
    normalBalance: NormalBalance.CREDIT,
    isControlAccount: true,
  },
  {
    code: '2200',
    name: 'TDS Payable',
    accountType: AccountType.LIABILITY,
    normalBalance: NormalBalance.CREDIT,
    isControlAccount: true,
  },
  {
    code: '2300',
    name: 'Customer Advances',
    accountType: AccountType.LIABILITY,
    normalBalance: NormalBalance.CREDIT,
    isControlAccount: true,
  },
  {
    code: '2400',
    name: 'Accrued Expenses',
    accountType: AccountType.LIABILITY,
    normalBalance: NormalBalance.CREDIT,
  },
  {
    // Employee reimbursements owed to staff for approved expense claims. A
    // liability DISTINCT from Accounts Payable (2000) so vendor AP aging never
    // mixes with what the company owes its own employees. Credited when a claim
    // is approved, cleared to Cash and Bank (1000) when it is marked Paid.
    code: '2500',
    name: 'Employee Reimbursements Payable',
    accountType: AccountType.LIABILITY,
    normalBalance: NormalBalance.CREDIT,
    isControlAccount: true,
  },
  {
    code: '3000',
    name: 'Owner Equity',
    accountType: AccountType.EQUITY,
    normalBalance: NormalBalance.CREDIT,
  },
  {
    code: '4000',
    name: 'Sales Revenue',
    accountType: AccountType.REVENUE,
    normalBalance: NormalBalance.CREDIT,
  },
  {
    code: '5000',
    name: 'Cost of Goods Sold',
    accountType: AccountType.COST_OF_GOODS_SOLD,
    normalBalance: NormalBalance.DEBIT,
  },
  {
    code: '6000',
    name: 'Employee Costs',
    accountType: AccountType.EXPENSE,
    normalBalance: NormalBalance.DEBIT,
  },
  {
    code: '6100',
    name: 'Administrative Expenses',
    accountType: AccountType.EXPENSE,
    normalBalance: NormalBalance.DEBIT,
  },
  {
    code: '6200',
    name: 'Sales and Marketing Expenses',
    accountType: AccountType.EXPENSE,
    normalBalance: NormalBalance.DEBIT,
  },
  {
    code: '6300',
    name: 'R&D Expenses',
    accountType: AccountType.EXPENSE,
    normalBalance: NormalBalance.DEBIT,
  },
  {
    code: '6400',
    name: 'Finance Costs',
    accountType: AccountType.EXPENSE,
    normalBalance: NormalBalance.DEBIT,
  },
  {
    code: '6500',
    name: 'Depreciation Expense',
    accountType: AccountType.EXPENSE,
    normalBalance: NormalBalance.DEBIT,
  },
  {
    code: '7000',
    name: 'Other Income',
    accountType: AccountType.OTHER_INCOME,
    normalBalance: NormalBalance.CREDIT,
  },
  {
    code: '8000',
    name: 'Other Expenses',
    accountType: AccountType.OTHER_EXPENSE,
    normalBalance: NormalBalance.DEBIT,
  },
];

/**
 * Tally-standard account GROUPS, layered onto the existing `parentId`
 * hierarchy on `LedgerAccount` (see Increment 1 discovery: there was no named
 * grouping concept, only accountType + parentId). Each group is itself a
 * `LedgerAccount` row (a non-posting "header" ledger) so it reuses the
 * existing hierarchy rather than adding a parallel model. `GRP-` prefix keeps
 * them visually distinct from real posting accounts in code/list views.
 *
 * `parentGroupCode` nests sub-groups the way Tally does (e.g. Duties & Taxes
 * has no parent here — Tally nests it under Current Liabilities, but the
 * existing 25 accounts don't need that extra layer to be useful, so we keep a
 * flat one-level-deep taxonomy; add nesting later if a real need appears).
 */
const ACCOUNT_GROUPS: Array<{
  code: string;
  name: string;
  accountType: AccountType;
  normalBalance: NormalBalance;
  /** Signals a bank/cash-eligible group for Contra voucher ledger restriction. */
  isBankOrCash?: boolean;
}> = [
  { code: 'GRP-BANK', name: 'Bank Accounts', accountType: AccountType.ASSET, normalBalance: NormalBalance.DEBIT, isBankOrCash: true },
  { code: 'GRP-CASH', name: 'Cash-in-Hand', accountType: AccountType.ASSET, normalBalance: NormalBalance.DEBIT, isBankOrCash: true },
  { code: 'GRP-DEBTORS', name: 'Sundry Debtors', accountType: AccountType.ASSET, normalBalance: NormalBalance.DEBIT },
  { code: 'GRP-STOCK', name: 'Stock-in-Hand', accountType: AccountType.ASSET, normalBalance: NormalBalance.DEBIT },
  { code: 'GRP-LOANS-ADVANCES', name: 'Loans and Advances (Asset)', accountType: AccountType.ASSET, normalBalance: NormalBalance.DEBIT },
  { code: 'GRP-FIXED-ASSETS', name: 'Fixed Assets', accountType: AccountType.ASSET, normalBalance: NormalBalance.DEBIT },
  { code: 'GRP-CREDITORS', name: 'Sundry Creditors', accountType: AccountType.LIABILITY, normalBalance: NormalBalance.CREDIT },
  { code: 'GRP-DUTIES-TAXES', name: 'Duties and Taxes', accountType: AccountType.LIABILITY, normalBalance: NormalBalance.CREDIT },
  { code: 'GRP-CURRENT-LIAB', name: 'Current Liabilities', accountType: AccountType.LIABILITY, normalBalance: NormalBalance.CREDIT },
  { code: 'GRP-CAPITAL', name: 'Capital Account', accountType: AccountType.EQUITY, normalBalance: NormalBalance.CREDIT },
  { code: 'GRP-SALES', name: 'Sales Accounts', accountType: AccountType.REVENUE, normalBalance: NormalBalance.CREDIT },
  { code: 'GRP-PURCHASE', name: 'Purchase Accounts', accountType: AccountType.COST_OF_GOODS_SOLD, normalBalance: NormalBalance.DEBIT },
  { code: 'GRP-INDIRECT-EXP', name: 'Indirect Expenses', accountType: AccountType.EXPENSE, normalBalance: NormalBalance.DEBIT },
  { code: 'GRP-INDIRECT-INC', name: 'Indirect Income', accountType: AccountType.OTHER_INCOME, normalBalance: NormalBalance.CREDIT },
  { code: 'GRP-OTHER-EXP', name: 'Other Expenses (Non-operating)', accountType: AccountType.OTHER_EXPENSE, normalBalance: NormalBalance.DEBIT },
];

/** Which group each of the 25 base accounts reparents under. */
const ACCOUNT_GROUP_MEMBERSHIP: Record<string, string> = {
  '1000': 'GRP-BANK', // Cash and Bank — treated as the Bank group; see GRP-CASH note below
  '1100': 'GRP-DEBTORS',
  '1200': 'GRP-STOCK',
  '1300': 'GRP-DUTIES-TAXES',
  '1400': 'GRP-LOANS-ADVANCES',
  '1500': 'GRP-LOANS-ADVANCES',
  '1600': 'GRP-FIXED-ASSETS',
  '1650': 'GRP-FIXED-ASSETS',
  '1700': 'GRP-LOANS-ADVANCES',
  '2000': 'GRP-CREDITORS',
  '2100': 'GRP-DUTIES-TAXES',
  '2200': 'GRP-DUTIES-TAXES',
  '2300': 'GRP-CURRENT-LIAB',
  '2400': 'GRP-CURRENT-LIAB',
  '2500': 'GRP-CURRENT-LIAB',
  '3000': 'GRP-CAPITAL',
  '4000': 'GRP-SALES',
  '5000': 'GRP-PURCHASE',
  '6000': 'GRP-INDIRECT-EXP',
  '6100': 'GRP-INDIRECT-EXP',
  '6200': 'GRP-INDIRECT-EXP',
  '6300': 'GRP-INDIRECT-EXP',
  '6400': 'GRP-INDIRECT-EXP',
  '6500': 'GRP-INDIRECT-EXP',
  '7000': 'GRP-INDIRECT-INC',
  '8000': 'GRP-OTHER-EXP',
};

/**
 * Default employee-expense categories, each mapped to the EXISTING expense
 * ledger its lines debit on approval (by ledger code — resolved to the id at
 * seed time). Chosen so a mixed-category claim posts to more than one debit
 * ledger, exercising the multi-debit posting path. Admins can add/deactivate
 * more via the admin-config screen; these are idempotent starters.
 */
const EXPENSE_CATEGORIES: Array<{ name: string; ledgerCode: string }> = [
  { name: 'Travel', ledgerCode: '6100' }, // Administrative Expenses
  { name: 'Accommodation', ledgerCode: '6100' }, // Administrative Expenses
  { name: 'Office Supplies', ledgerCode: '6100' }, // Administrative Expenses
  { name: 'Meals', ledgerCode: '6000' }, // Employee Costs
  { name: 'Other', ledgerCode: '8000' }, // Other Expenses
];

const LEAVE_TYPES: Array<{
  code: string;
  name: string;
  accrualType: LeaveAccrualType;
  annualQuota: number | null;
  carryForwardCap: number | null;
}> = [
  {
    code: 'CL',
    name: 'Casual Leave',
    accrualType: LeaveAccrualType.FIXED_ANNUAL,
    annualQuota: 12,
    carryForwardCap: null,
  },
  {
    code: 'SL',
    name: 'Sick Leave',
    accrualType: LeaveAccrualType.FIXED_ANNUAL,
    annualQuota: 12,
    carryForwardCap: null,
  },
  {
    code: 'EL',
    name: 'Earned/Annual Leave',
    accrualType: LeaveAccrualType.MONTHLY_ACCRUAL,
    annualQuota: 18,
    carryForwardCap: 30,
  },
  {
    code: 'UL',
    name: 'Unpaid Leave',
    accrualType: LeaveAccrualType.UNTRACKED,
    annualQuota: null,
    carryForwardCap: null,
  },
];

/**
 * Starting Bid/No-Bid questionnaire. A reasonable default set — Admin can
 * edit/add/deactivate afterward via /bid-assessment-questions. Seeded only
 * when the table is empty (no natural unique key to upsert on), so it never
 * clobbers Admin edits on re-seed.
 */
const BID_ASSESSMENT_QUESTIONS: Array<{
  text: string;
  type: BidAssessmentQuestionType;
  options?: string[];
  displayOrder: number;
}> = [
  {
    text: 'Is the customer budget confirmed for this requirement?',
    type: BidAssessmentQuestionType.BOOLEAN,
    displayOrder: 1,
  },
  {
    text: 'How technically feasible is the requirement for us to deliver?',
    type: BidAssessmentQuestionType.SCALE,
    displayOrder: 2,
  },
  {
    text: 'Estimated gross margin on this deal (%)',
    type: BidAssessmentQuestionType.TEXT,
    displayOrder: 3,
  },
  {
    text: 'What is the competitive situation?',
    type: BidAssessmentQuestionType.SELECT,
    options: [
      'Sole vendor',
      'Few competitors',
      'Crowded / commoditised',
      'Unknown',
    ],
    displayOrder: 4,
  },
  {
    text: 'Do we have the resources (people/capacity) available to deliver?',
    type: BidAssessmentQuestionType.BOOLEAN,
    displayOrder: 5,
  },
  {
    text: 'How well does this opportunity fit our strategic direction?',
    type: BidAssessmentQuestionType.SCALE,
    displayOrder: 6,
  },
  {
    text: 'Is the customer creditworthy (payment history / references)?',
    type: BidAssessmentQuestionType.BOOLEAN,
    displayOrder: 7,
  },
  {
    text: 'Is the requested delivery timeline feasible?',
    type: BidAssessmentQuestionType.BOOLEAN,
    displayOrder: 8,
  },
];

// Employee codes are `PHB` + 2-digit year + a 3-digit sequence that resets each
// year (PHB26-001). Backed by the same year-scoped `sales_sequences` counter the
// runtime allocator uses, so seed and app share one sequence per year.
async function nextEmployeeId(client: PrismaClient): Promise<string> {
  const year = new Date().getFullYear();
  const rows = await client.$queryRaw<Array<{ lastValue: number }>>`
    INSERT INTO sales_sequences ("entity", "year", "lastValue", "updatedAt")
    VALUES ('employee', ${year}, 1, now())
    ON CONFLICT ("entity", "year")
    DO UPDATE SET "lastValue" = sales_sequences."lastValue" + 1,
                  "updatedAt" = now()
    RETURNING "lastValue"
  `;
  const seq = rows[0].lastValue;
  const yy = (year % 100).toString().padStart(2, '0');
  return `PHB${yy}-${seq.toString().padStart(3, '0')}`;
}

/**
 * Default Vault folders (spec §4.1). All owned by the seeded SUPER_ADMIN.
 * `verticalCode` null = COMPANY_WIDE; otherwise VERTICAL-scoped to that
 * vertical. Company Policies + Compliance & Legal keep unbounded version
 * history (maxVersions = null) per the compliance-retention exception; the
 * rest use the default cap of 5 when versioning is on. Seeded idempotently:
 * a folder is created only if no DEFAULT folder with the same name +
 * scope/vertical already exists, so re-running never duplicates.
 */
const DEFAULT_FOLDERS: Array<{
  name: string;
  verticalCode: string | null;
  versioningEnabled: boolean;
  maxVersionsRetained: number | null;
  /**
   * Verticals granted explicit READ beyond the folder's own scope. Vault
   * grants are additive, so this widens who can read without moving the
   * folder out of its owning vertical.
   */
  readGrantVerticalCodes?: string[];
}> = [
  // Company-wide
  {
    name: 'Company Policies',
    verticalCode: null,
    versioningEnabled: true,
    maxVersionsRetained: null,
  },
  {
    name: 'Onboarding Documents',
    verticalCode: null,
    versioningEnabled: false,
    maxVersionsRetained: 5,
  },
  {
    name: 'Compliance & Legal',
    verticalCode: null,
    versioningEnabled: true,
    maxVersionsRetained: null,
  },
  {
    name: 'Vendor NDA',
    verticalCode: null,
    versioningEnabled: true,
    maxVersionsRetained: null,
  },
  {
    name: 'IT & Security Guidelines',
    verticalCode: null,
    versioningEnabled: false,
    maxVersionsRetained: 5,
  },
  {
    name: 'Company Announcements',
    verticalCode: null,
    versioningEnabled: false,
    maxVersionsRetained: 5,
  },
  // Vertical-scoped
  {
    name: 'Sales',
    verticalCode: 'SALES',
    versioningEnabled: false,
    maxVersionsRetained: 5,
  },
  {
    // Home for files attached to sales leads (see LeadAttachment). VERTICAL
    // scope → any Sales-vertical user can preview them, matching the
    // "any sales staff can view any lead" read rule.
    name: 'Lead Attachments',
    verticalCode: 'SALES',
    versioningEnabled: false,
    maxVersionsRetained: 5,
  },
  {
    name: 'Design',
    verticalCode: 'DESIGN',
    versioningEnabled: true,
    maxVersionsRetained: 5,
  },
  {
    name: 'Production / Manufacturing',
    verticalCode: 'PRODUCTION',
    versioningEnabled: true,
    maxVersionsRetained: 5,
  },
  {
    name: 'Quality',
    verticalCode: 'PRODUCTION',
    versioningEnabled: false,
    maxVersionsRetained: 5,
  },
  {
    name: 'Procurement / SCM',
    verticalCode: 'SCM',
    versioningEnabled: false,
    maxVersionsRetained: 5,
  },
  {
    name: 'Dispatch',
    verticalCode: 'SCM',
    versioningEnabled: false,
    maxVersionsRetained: 5,
  },
  {
    // Home for vendor/supplier RFQ quotes (see RfqQuote). SCM-scoped because
    // sourcing owns the RFQ, plus an explicit Accounts read grant so Finance
    // can check a PO's price against the winning quote without asking SCM.
    // Versioned: a vendor may resubmit against the same RFQ, and the earlier
    // quote is the record of what was originally offered.
    name: 'RFQ Quotes',
    verticalCode: 'SCM',
    versioningEnabled: true,
    maxVersionsRetained: 5,
    readGrantVerticalCodes: ['ACCOUNTS'],
  },
];

/**
 * Idempotent baseline seed. Safe to run repeatedly and on a freshly-truncated
 * database — verticals/leave types upsert, bid questions/super-admin/vault
 * folders are count-or-existence guarded. Accepts the PrismaClient so tests can
 * reuse their own connection (see test/reset-db.ts).
 */
export async function seed(prisma: PrismaClient): Promise<void> {
  for (const vertical of VERTICALS) {
    await prisma.vertical.upsert({
      where: { code: vertical.code },
      update: {},
      create: vertical,
    });
  }

  const hrVertical = await prisma.vertical.findUniqueOrThrow({
    where: { code: 'HR' },
  });
  const provisioningTypes = [
    { name: 'Laptop', requiresScmFulfillment: true, approverType: ProvisioningApproverType.SUPER_ADMIN, approverVerticalId: null },
    { name: 'Email ID Creation', requiresScmFulfillment: false, approverType: ProvisioningApproverType.SUPER_ADMIN, approverVerticalId: null },
    { name: 'ID Card', requiresScmFulfillment: true, approverType: ProvisioningApproverType.VERTICAL_OWNER, approverVerticalId: hrVertical.id },
    { name: 'Business Card', requiresScmFulfillment: true, approverType: ProvisioningApproverType.VERTICAL_OWNER, approverVerticalId: hrVertical.id },
    { name: 'Joining Kit', requiresScmFulfillment: true, approverType: ProvisioningApproverType.VERTICAL_OWNER, approverVerticalId: hrVertical.id },
  ];
  for (const item of provisioningTypes) {
    await prisma.provisioningItemType.upsert({
      where: { name: item.name },
      update: {
        requiresScmFulfillment: item.requiresScmFulfillment,
        approverType: item.approverType,
        approverVerticalId: item.approverVerticalId,
      },
      create: { ...item, isActive: true },
    });
  }

  // Milestone templates — standard checkpoints per delivery flow type, driving
  // the kickoff milestone dropdown. `name` is unique within a flow type, so the
  // same milestone intentionally recurs across NPD / IN_HOUSE / VENDOR.
  const milestoneTemplates: Array<{
    flowType: OrderLineDeliveryType;
    names: string[];
  }> = [
    {
      flowType: OrderLineDeliveryType.NPD,
      names: [
        'Design Concept Finalisation',
        'Design Review Sign-off',
        'Drawing Finalisation',
        'Prototype/Sample Approval',
        'Material Ready',
        'Production Start',
        'Packing Standard Finalised',
        'Label & Branding',
        'QC Sign-off',
        'Logistics & Delivery',
      ],
    },
    {
      flowType: OrderLineDeliveryType.IN_HOUSE,
      names: [
        'Material Ready',
        'Production Start',
        'Packing Standard Finalised',
        'Label & Branding',
        'QC Sign-off',
        'Logistics & Delivery',
      ],
    },
    {
      flowType: OrderLineDeliveryType.VENDOR,
      names: [
        'Material Ready (Vendor Confirmed)',
        'Production Start (Vendor)',
        'Packing Standard Finalised',
        'Label & Branding',
        'QC Sign-off',
        'Logistics & Delivery',
      ],
    },
  ];
  for (const { flowType, names } of milestoneTemplates) {
    for (let i = 0; i < names.length; i += 1) {
      const name = names[i];
      const displayOrder = i + 1;
      await prisma.milestoneTemplate.upsert({
        where: { flowType_name: { flowType, name } },
        update: { displayOrder },
        create: { flowType, name, displayOrder, isActive: true },
      });
    }
  }

  for (const bu of BUSINESS_UNITS) {
    await prisma.businessUnit.upsert({
      where: { code: bu.code },
      // Refresh descriptive fields on re-seed, but leave isActive alone so a
      // deliberately deactivated unit is never silently reactivated.
      update: {
        name: bu.name,
        description: bu.description,
        displayOrder: bu.displayOrder,
        colorHex: bu.colorHex,
      },
      create: bu,
    });
  }

  for (const leaveType of LEAVE_TYPES) {
    await prisma.leaveType.upsert({
      where: { code: leaveType.code },
      update: {},
      create: leaveType,
    });
  }

  // Default store/warehouse location for the inventory MVP. Idempotent upsert
  // on the unique code — the stock-availability feature needs at least one
  // location to hold balances against.
  for (const store of STORE_LOCATIONS) {
    await prisma.storeLocation.upsert({
      where: { code: store.code },
      update: {},
      create: store,
    });
  }

  for (const currency of CURRENCIES) {
    await prisma.currency.upsert({
      where: { code: currency.code },
      update: {
        name: currency.name,
        symbol: currency.symbol,
        isBase: currency.isBase,
        isActive: true,
      },
      create: currency,
    });
  }

  // Seed the Bid/No-Bid questionnaire only when empty (no unique key to
  // upsert on) — preserves any Admin edits on re-seed.
  const questionCount = await prisma.bidAssessmentQuestion.count();
  if (questionCount === 0) {
    for (const q of BID_ASSESSMENT_QUESTIONS) {
      await prisma.bidAssessmentQuestion.create({
        data: {
          text: q.text,
          type: q.type,
          options: q.options ?? undefined,
          displayOrder: q.displayOrder,
        },
      });
    }
  }

  const email =
    process.env.SEED_ADMIN_EMAIL ?? 'nithin.gangadhar@phaze-dynamics.com';
  const password = process.env.SEED_ADMIN_PASSWORD ?? 'ChangeMe123!';
  const passwordHash = await bcrypt.hash(password, 10);

  const existing = await prisma.employee.findUnique({ where: { email } });
  const superAdmin =
    existing ??
    (await prisma.employee.create({
      data: {
        employeeId: await nextEmployeeId(prisma),
        email,
        passwordHash,
        firstName: 'Super',
        lastName: 'Admin',
        role: Role.SUPER_ADMIN,
        accessStatus: AccessStatus.ACTIVE,
      },
    }));

  for (const account of BASE_ACCOUNTS) {
    await prisma.ledgerAccount.upsert({
      where: { code: account.code },
      update: {},
      create: { ...account, createdById: superAdmin.id },
    });
  }

  // Tally-style account groups: create each GRP-* header ledger (idempotent —
  // `update: {}` leaves an existing row untouched), then reparent every base
  // account under its group via parentId. Re-running is a no-op once applied:
  // the reparent update only fires when parentId is actually different.
  // `GRP-CASH` has no member yet — code '1000' ("Cash and Bank") is a single
  // combined account today; a future dedicated cash ledger would join
  // GRP-CASH instead. Both groups are flagged bank/cash-eligible for Contra.
  const groupIdByCode = new Map<string, string>();
  for (const group of ACCOUNT_GROUPS) {
    const row = await prisma.ledgerAccount.upsert({
      where: { code: group.code },
      update: {},
      create: {
        code: group.code,
        name: group.name,
        accountType: group.accountType,
        normalBalance: group.normalBalance,
        createdById: superAdmin.id,
      },
    });
    groupIdByCode.set(group.code, row.id);
  }
  for (const [accountCode, groupCode] of Object.entries(ACCOUNT_GROUP_MEMBERSHIP)) {
    const groupId = groupIdByCode.get(groupCode);
    if (!groupId) continue;
    const account = await prisma.ledgerAccount.findUnique({ where: { code: accountCode } });
    if (account && account.parentId !== groupId) {
      await prisma.ledgerAccount.update({ where: { code: accountCode }, data: { parentId: groupId } });
    }
  }

  // Employee expense categories — each resolves its mapped expense ledger by
  // code. Idempotent by unique name (`update: {}` leaves an existing category's
  // ledger mapping and active flag untouched, so re-seeding never overrides an
  // admin's later remap or deactivation).
  for (const category of EXPENSE_CATEGORIES) {
    const ledger = await prisma.ledgerAccount.findUnique({
      where: { code: category.ledgerCode },
    });
    if (!ledger) continue;
    await prisma.expenseCategory.upsert({
      where: { name: category.name },
      update: {},
      create: { name: category.name, defaultExpenseLedgerId: ledger.id },
    });
  }

  // Default Vault folders — owned by the SUPER_ADMIN, seeded idempotently
  // (created only when an identical DEFAULT folder isn't already present).
  let foldersCreated = 0;
  for (const f of DEFAULT_FOLDERS) {
    const scopeVerticalId = f.verticalCode
      ? (
          await prisma.vertical.findUniqueOrThrow({
            where: { code: f.verticalCode },
          })
        ).id
      : null;
    const visibilityScope = f.verticalCode
      ? VaultVisibilityScope.VERTICAL
      : VaultVisibilityScope.COMPANY_WIDE;

    const alreadyThere = await prisma.vaultFolder.findFirst({
      where: {
        type: VaultFolderType.DEFAULT,
        name: f.name,
        visibilityScope,
        scopeVerticalId,
      },
    });

    // Cross-vertical read grants are upserted even for a folder that already
    // exists, so adding a grant to an existing entry takes effect on re-seed.
    let folder = alreadyThere;
    if (!folder) {
      folder = await prisma.vaultFolder.create({
        data: {
          name: f.name,
          type: VaultFolderType.DEFAULT,
          ownerId: superAdmin.id,
          visibilityScope,
          scopeVerticalId,
          versioningEnabled: f.versioningEnabled,
          maxVersionsRetained: f.maxVersionsRetained,
        },
      });
      foldersCreated += 1;
    }

    for (const code of f.readGrantVerticalCodes ?? []) {
      const grantee = await prisma.vertical.findUniqueOrThrow({
        where: { code },
      });
      await prisma.vaultFolderPermission.upsert({
        where: {
          folderId_granteeType_granteeId: {
            folderId: folder.id,
            granteeType: VaultGranteeType.VERTICAL,
            granteeId: grantee.id,
          },
        },
        update: { canRead: true },
        create: {
          folderId: folder.id,
          granteeType: VaultGranteeType.VERTICAL,
          granteeId: grantee.id,
          canRead: true,
          grantedById: superAdmin.id,
        },
      });
    }
  }

  // ── Finance prerequisites ────────────────────────────────────────────
  // Without these the finance "approve → post → file → close" half is
  // unreachable: journal posting hard-requires an OPEN accounting period, and
  // approvals require a designated Accounts Head (the Super Admin is a finance
  // USER but is deliberately NOT an approver). Seed them idempotently so a
  // fresh `db seed` yields a genuinely operable finance environment.
  const accountsVertical = await prisma.vertical.findUniqueOrThrow({
    where: { code: 'ACCOUNTS' },
  });

  // A designated Accounts Head (the sole approver) + a separate Accounts clerk
  // (the maker). Two distinct users so maker-checker — creator cannot approve
  // their own document — is demonstrable out of the box.
  const financeUsers = [
    {
      email: 'accounts.head@phaze-dynamics.com',
      firstName: 'Accounts',
      lastName: 'Head',
      isAccountsHead: true,
    },
    {
      email: 'accounts.clerk@phaze-dynamics.com',
      firstName: 'Accounts',
      lastName: 'Clerk',
      isAccountsHead: false,
    },
  ];
  const financePasswordHash = await bcrypt.hash(password, 10);
  // Exactly one employee may hold isAccountsHead (partial unique index
  // employees_single_accounts_head_idx). A live environment normally has a REAL
  // Accounts Head by now, so the seed must never try to take the designation:
  // it would fail with P2002 and abort the rest of the seed. The demo head is
  // then created without the designation instead.
  const currentAccountsHead = await prisma.employee.findFirst({
    where: { isAccountsHead: true },
    select: { email: true },
  });
  for (const u of financeUsers) {
    const claimsHead =
      u.isAccountsHead &&
      (!currentAccountsHead || currentAccountsHead.email === u.email);
    if (u.isAccountsHead && !claimsHead) {
      console.log(
        `Accounts Head designation left with ${currentAccountsHead?.email} — ` +
          `${u.email} seeded without it.`,
      );
    }
    const existingUser = await prisma.employee.findUnique({
      where: { email: u.email },
    });
    if (existingUser) {
      // Keep the designation/vertical correct on re-seed without disturbing
      // anything else about an existing row.
      await prisma.employee.update({
        where: { id: existingUser.id },
        data: {
          verticalId: accountsVertical.id,
          isAccountsHead: claimsHead,
        },
      });
    } else {
      await prisma.employee.create({
        data: {
          employeeId: await nextEmployeeId(prisma),
          email: u.email,
          passwordHash: financePasswordHash,
          firstName: u.firstName,
          lastName: u.lastName,
          role: Role.EMPLOYEE,
          accessStatus: AccessStatus.ACTIVE,
          verticalId: accountsVertical.id,
          isAccountsHead: claimsHead,
          reportingManagerId: superAdmin.id,
        },
      });
    }
  }

  // Minimal company/tax settings so an invoice can be raised + GST computed.
  await prisma.financeCompanySettings.upsert({
    where: { id: 'INDIA' },
    update: {},
    create: {
      id: 'INDIA',
      legalName: 'Phaze Dynamics Pvt Ltd',
      gstin: '29AAACP0000A1Z5',
      addressLine1: '1 Industrial Area',
      city: 'Bengaluru',
      state: 'Karnataka',
      stateCode: '29',
      postalCode: '560001',
      pan: 'AAACP0000A',
      tan: 'BLRP00000A',
    },
  });

  // Current India fiscal year (Apr 1 – Mar 31) with 12 OPEN monthly periods.
  // Journal posting resolves the period by date range, so all 12 open means any
  // in-year entry can post. FY name e.g. "FY 2026-27".
  const now = new Date();
  const fyStartYear =
    now.getUTCMonth() >= 3 ? now.getUTCFullYear() : now.getUTCFullYear() - 1;
  const fyName = `FY ${fyStartYear}-${String((fyStartYear + 1) % 100).padStart(2, '0')}`;
  const fiscalYear = await prisma.fiscalYear.upsert({
    where: { name: fyName },
    update: {},
    create: {
      name: fyName,
      startsOn: new Date(Date.UTC(fyStartYear, 3, 1)),
      endsOn: new Date(Date.UTC(fyStartYear + 1, 2, 31)),
      createdById: superAdmin.id,
    },
  });
  const MONTHS = [
    'April', 'May', 'June', 'July', 'August', 'September',
    'October', 'November', 'December', 'January', 'February', 'March',
  ];
  let periodsCreated = 0;
  for (let i = 0; i < 12; i++) {
    // Period i (0-based) is calendar month (3 + i) of fyStartYear, rolling into
    // the next calendar year for Jan–Mar.
    const monthIndex = (3 + i) % 12;
    const calYear = 3 + i < 12 ? fyStartYear : fyStartYear + 1;
    const startsOn = new Date(Date.UTC(calYear, monthIndex, 1));
    const endsOn = new Date(Date.UTC(calYear, monthIndex + 1, 0)); // last day of month
    const existingPeriod = await prisma.accountingPeriod.findUnique({
      where: {
        fiscalYearId_periodNumber: {
          fiscalYearId: fiscalYear.id,
          periodNumber: i + 1,
        },
      },
    });
    if (!existingPeriod) {
      await prisma.accountingPeriod.create({
        data: {
          fiscalYearId: fiscalYear.id,
          periodNumber: i + 1,
          name: `${MONTHS[i]} ${calYear}`,
          startsOn,
          endsOn,
        },
      });
      periodsCreated += 1;
    }
  }

  console.log(
    `Seed complete. Verticals: ${VERTICALS.length}. Leave types: ${LEAVE_TYPES.length}. ` +
      `Super admin: ${email}. Default vault folders created this run: ${foldersCreated} ` +
      `(of ${DEFAULT_FOLDERS.length} total). Finance: Accounts Head + clerk seeded, ` +
      `company settings set, ${fyName} with ${periodsCreated} new open period(s).`,
  );
}

// CLI entry point (`prisma db seed` / `npm run seed`). When imported as a
// module (e.g. by the e2e reset harness) this block is skipped.
if (require.main === module) {
  const prisma = new PrismaClient();
  seed(prisma)
    .catch((e) => {
      console.error(e);
      process.exit(1);
    })
    .finally(async () => {
      await prisma.$disconnect();
    });
}
