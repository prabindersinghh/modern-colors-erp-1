/**
 * Packing stage — seed the single PACKER login.
 *
 * Idempotent and non-destructive:
 *  - creates packer@moderncolours.local if missing
 *  - if it already exists, leaves it completely alone (no password reset, no
 *    re-activation) so a live account is never silently changed by a re-run
 *  - never logs the password
 *
 * Password defaults to ChangeMe123! — override with SEED_PACKER_PASSWORD.
 * Run:  npx tsx prisma/seed-packer.ts
 */
import { PrismaClient, Role } from '@prisma/client';
import * as bcrypt from 'bcryptjs';

const prisma = new PrismaClient();
const PW = process.env.SEED_PACKER_PASSWORD ?? 'ChangeMe123!';
const BCRYPT_ROUNDS = 10;

const PACKER_EMAIL = 'packer@moderncolours.local';

async function main() {
  const existing = await prisma.user.findUnique({ where: { email: PACKER_EMAIL } });

  if (existing) {
    console.log(`• ${PACKER_EMAIL} already exists (role ${existing.role}) — left untouched.`);
    return;
  }

  const user = await prisma.user.create({
    data: {
      email: PACKER_EMAIL,
      name: 'Packer',
      role: Role.PACKER,
      department: null, // packing spans every department's finished goods
      passwordHash: await bcrypt.hash(PW, BCRYPT_ROUNDS),
      active: true,
    },
  });

  await prisma.auditLog.create({
    data: {
      entityType: 'User',
      entityId: user.id,
      action: 'USER_SEEDED',
      afterJson: { email: user.email, role: user.role },
    },
  });

  console.log(`✓ Created ${PACKER_EMAIL} (PACKER).`);
  console.log('  Password: set via SEED_PACKER_PASSWORD (default ChangeMe123!). Change it after first login.');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
