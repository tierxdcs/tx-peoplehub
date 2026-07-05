import { PrismaClient, Role } from '@prisma/client';
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
      },
    });
  }

  console.log(`Seed complete. Verticals: ${VERTICALS.length}. Super admin: ${email}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
