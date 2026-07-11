import {
  AccessStatus,
  BidAssessmentQuestionType,
  LeaveAccrualType,
  PrismaClient,
  Role,
  VaultFolderType,
  VaultVisibilityScope,
} from '@prisma/client';
import * as bcrypt from 'bcrypt';

const prisma = new PrismaClient();

const VERTICALS: Array<{ name: string; code: string }> = [
  { name: 'Sales', code: 'SALES' },
  { name: 'HR', code: 'HR' },
  { name: 'Production', code: 'PRODUCTION' },
  { name: 'SCM', code: 'SCM' },
  { name: 'R&D', code: 'RND' },
  { name: 'Accounts', code: 'ACCOUNTS' },
  { name: 'Design', code: 'DESIGN' },
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

async function nextEmployeeId(): Promise<string> {
  const [{ nextval }] = await prisma.$queryRaw<
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

async function main() {
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

  const email = process.env.SEED_ADMIN_EMAIL ?? 'nithin.gangadhar@phaze-dynamics.com';
  const password = process.env.SEED_ADMIN_PASSWORD ?? 'ChangeMe123!';
  const passwordHash = await bcrypt.hash(password, 10);

  const existing = await prisma.employee.findUnique({ where: { email } });
  const superAdmin =
    existing ??
    (await prisma.employee.create({
      data: {
        employeeId: await nextEmployeeId(),
        email,
        passwordHash,
        firstName: 'Super',
        lastName: 'Admin',
        role: Role.SUPER_ADMIN,
        accessStatus: AccessStatus.ACTIVE,
      },
    }));

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

  console.log(
    `Seed complete. Verticals: ${VERTICALS.length}. Leave types: ${LEAVE_TYPES.length}. ` +
      `Super admin: ${email}. Default vault folders created this run: ${foldersCreated} ` +
      `(of ${DEFAULT_FOLDERS.length} total).`,
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
