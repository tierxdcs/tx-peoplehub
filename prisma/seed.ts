import {
  AccessStatus,
  AccountType,
  BidAssessmentQuestionType,
  LeaveAccrualType,
  PrismaClient,
  Role,
  NormalBalance,
  VaultFolderType,
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

async function nextEmployeeId(client: PrismaClient): Promise<string> {
  const [{ nextval }] = await client.$queryRaw<
    [{ nextval: bigint }]
  >`SELECT nextval('employee_id_seq')`;
  return `EMP-${nextval.toString().padStart(4, '0')}`;
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
    if (alreadyThere) continue;

    await prisma.vaultFolder.create({
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
  for (const u of financeUsers) {
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
          isAccountsHead: u.isAccountsHead,
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
          isAccountsHead: u.isAccountsHead,
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
