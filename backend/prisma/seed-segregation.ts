/**
 * Segregation of duties — seed the Gate and the two Reviewers.
 *
 * Idempotent and non-destructive, matching seed-phase2-roles / seed-phase3-dispatch:
 *  - creates each login only if missing
 *  - if it already exists, leaves it completely alone (no password reset, no
 *    re-activation) so a live account is never silently changed by a re-run
 *  - never logs a password
 *
 * The Gate reuses the dormant OPERATOR role: its documented capability is exactly
 * "Phase 1 inward operations", and a route-by-route audit confirmed all 29 of its
 * endpoints are correct for the gate desk with nothing to add or remove. The UI labels
 * it "Gate"; the enum stays OPERATOR so no guard, spec or migration had to move.
 *
 * The two Reviewers are strictly view-only — invoice document beside the digital slip,
 * and nothing else. REVIEWER appears on no mutating route anywhere in the application,
 * which reviewer-isolation.spec.ts asserts by sweeping every controller.
 *
 * Password defaults to ChangeMe123! — override with SEED_SEGREGATION_PASSWORD.
 * Run:  npx tsx prisma/seed-segregation.ts
 */
import { PrismaClient, Role } from '@prisma/client';
import * as bcrypt from 'bcryptjs';

const prisma = new PrismaClient();
const PW = process.env.SEED_SEGREGATION_PASSWORD ?? 'ChangeMe123!';
const BCRYPT_ROUNDS = 10;

/** Spellings confirmed by the owner and seeded exactly as given. */
const LOGINS: { email: string; name: string; role: Role }[] = [
  { email: 'gate@moderncolours.local', name: 'Gate', role: Role.OPERATOR },
  { email: 'pallavi@moderncolours.local', name: 'Pallavi', role: Role.REVIEWER },
  { email: 'rupinder@moderncolours.local', name: 'Rupinder', role: Role.REVIEWER },
];

async function main() {
  for (const { email, name, role } of LOGINS) {
    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing) {
      console.log(`• ${email} already exists (role ${existing.role}) — left untouched.`);
      continue;
    }

    const user = await prisma.user.create({
      data: {
        email,
        name,
        role,
        department: null, // neither the gate nor a reviewer is department-scoped
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

    console.log(`✓ Created ${email} (${role}${role === Role.OPERATOR ? ' — labelled "Gate"' : ''}).`);
  }

  console.log('\n  Passwords: set via SEED_SEGREGATION_PASSWORD (default ChangeMe123!).');
  console.log('  Change them after first login — the Users tab flags any login still on a default.');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
