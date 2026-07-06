import {
  AccessStatus,
  BidAssessmentQuestionType,
  LeaveAccrualType,
  PrismaClient,
  Role,
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

  const email = process.env.SEED_ADMIN_EMAIL ?? 'admin@peoplehub.local';
  const password = process.env.SEED_ADMIN_PASSWORD ?? 'ChangeMe123!';
  const passwordHash = await bcrypt.hash(password, 10);

  const existing = await prisma.employee.findUnique({ where: { email } });
  if (!existing) {
    const employeeId = await nextEmployeeId();
    await prisma.employee.create({
      data: {
        employeeId,
        email,
        passwordHash,
        firstName: 'Super',
        lastName: 'Admin',
        role: Role.SUPER_ADMIN,
        accessStatus: AccessStatus.ACTIVE,
      },
    });
  }

  console.log(
    `Seed complete. Verticals: ${VERTICALS.length}. Leave types: ${LEAVE_TYPES.length}. Super admin: ${email}`,
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
