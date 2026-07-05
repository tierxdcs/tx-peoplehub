import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcrypt';

const prisma = new PrismaClient();

async function main() {
  const email = process.env.SEED_ADMIN_EMAIL ?? 'admin@peoplehub.local';
  const password = process.env.SEED_ADMIN_PASSWORD ?? 'ChangeMe123!';

  // Ensure the admin role exists.
  const adminRole = await prisma.role.upsert({
    where: { name: 'admin' },
    update: {},
    create: { name: 'admin', description: 'Full system access' },
  });

  // Also seed a baseline non-privileged role for future modules.
  await prisma.role.upsert({
    where: { name: 'user' },
    update: {},
    create: { name: 'user', description: 'Standard authenticated user' },
  });

  const passwordHash = await bcrypt.hash(password, 10);

  await prisma.user.upsert({
    where: { email },
    update: {},
    create: {
      email,
      passwordHash,
      firstName: 'Admin',
      lastName: 'User',
      roles: { connect: { id: adminRole.id } },
    },
  });

  console.log(`Seed complete. Admin user: ${email}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
