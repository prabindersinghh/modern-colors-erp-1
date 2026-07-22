#!/usr/bin/env node
/**
 * Railway pre-deploy: apply pending migrations before the new container takes traffic.
 *
 * Railway runs this after the build and before the release. A non-zero exit aborts the
 * release and the PREVIOUS deployment keeps serving — which is the whole point: the
 * database and the code can never again go live in the wrong order.
 *
 * Why this wrapper instead of `npx prisma migrate deploy` directly:
 *
 *   `prisma migrate deploy` HANGS FOREVER on Neon's pooled endpoint, because PgBouncer
 *   has no advisory locks. That cost us most of 3 July (d0dba20) and the symptom is
 *   indistinguishable from a slow build — no error, no output, just a release that never
 *   finishes and eventually trips the healthcheck.
 *
 *   So this refuses to start unless it has been given a NON-POOLED url. A missing or
 *   pooled DIRECT_URL fails in under a second with an explanation, instead of hanging.
 *   Loud and immediate beats silent and stuck.
 */
const { execFileSync } = require('node:child_process');

const direct = (process.env.DIRECT_URL ?? '').trim();
const fail = (msg) => {
  console.error(`\n[pre-deploy] REFUSING TO MIGRATE\n[pre-deploy] ${msg}\n`);
  process.exit(1);
};

if (!direct) {
  fail(
    'DIRECT_URL is not set on this service.\n' +
      '[pre-deploy] Prisma needs a NON-POOLED Neon URL for migrations; on the pooled\n' +
      '[pre-deploy] endpoint `migrate deploy` hangs forever rather than failing.\n' +
      '[pre-deploy] Fix: add DIRECT_URL in Railway = the DATABASE_URL host with "-pooler" removed.',
  );
}

if (direct.includes('-pooler')) {
  fail(
    'DIRECT_URL points at the POOLED endpoint (it contains "-pooler").\n' +
      '[pre-deploy] Migrations would hang. Fix: remove "-pooler" from the host.',
  );
}

// Prisma reads DIRECT_URL itself via schema.prisma's `directUrl`; passing it explicitly
// here would risk the two disagreeing.
console.log('[pre-deploy] DIRECT_URL present and non-pooled — applying migrations…');
try {
  execFileSync('npx', ['prisma', 'migrate', 'deploy'], { stdio: 'inherit', shell: process.platform === 'win32' });
  console.log('[pre-deploy] migrations applied; releasing.');
} catch {
  // execFileSync already streamed Prisma's own error to the log.
  console.error('\n[pre-deploy] migration FAILED — aborting the release. The previous deployment keeps serving.\n');
  process.exit(1);
}
