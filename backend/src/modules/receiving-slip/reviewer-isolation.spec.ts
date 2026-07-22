import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { Role } from '@prisma/client';

/**
 * REVIEWER is view-only BY CONSTRUCTION, the same way OVERSIGHT is.
 *
 * Two people outside the factory's operations — pallavi@ and rupinder@ — can see the
 * invoice beside the digital slip, and nothing else. That is a compliance surface, so it
 * is asserted structurally rather than trusted to code review: this sweeps every
 * controller in the application and fails if REVIEWER ever appears on a mutating route
 * or acquires a named door.
 *
 * OVERSIGHT earned three named doors over time because the owner genuinely needed to
 * write. REVIEWER has none, and this spec is what makes adding a fourth door for it a
 * conscious act rather than a one-line drive-by.
 */

const SRC = join(__dirname, '..', '..');

const controllerFiles = (() => {
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir)) {
      const p = join(dir, entry);
      if (statSync(p).isDirectory()) walk(p);
      else if (/\.controller\.ts$/.test(entry)) out.push(p);
    }
  };
  walk(SRC);
  return out;
})();

/** Every route handler, with the roles that can reach it and any door decorator. */
const routes = controllerFiles.flatMap((file) =>
  // Split PER @Controller, not per file. Several files declare TWO controllers on
  // different base paths (this one, and label-reprint) — taking the first path for the
  // whole file silently mis-attributes the second controller's routes, which is exactly
  // what this parser did on its first run.
  readFileSync(file, 'utf8')
    .split(/(?=@Controller\()/)
    .slice(1)
    .flatMap((block) => {
      const controller = /@Controller\('([^']*)'\)/.exec(block)?.[1] ?? '';
      // Class-level @Roles applies to any handler that does not declare its own.
      const classRoles = /@Controller[\s\S]{0,400}?@Roles\(([^)]*)\)[\s\S]{0,200}?export class/.exec(block)?.[1];
      return block
        .split(/\n  @(?=Get|Post|Patch|Delete|Put)/)
        .slice(1)
        .flatMap((chunk) => {
          const verb = /^(Get|Post|Patch|Delete|Put)\('?([^')]*)'?\)/.exec(chunk);
          if (!verb) return [];
          const head = chunk.split('\n').slice(0, 6).join('\n');
          const own = /@Roles\(([^)]*)\)/.exec(head)?.[1];
          const roles = (own ?? classRoles ?? '').match(/Role\.([A-Z_]+)/g)?.map((s) => s.slice(5)) ?? [];
          return [
            {
              name: `${verb[1].toUpperCase()} /${controller}${verb[2] ? `/${verb[2]}` : ''}`.replace('//', '/'),
              method: verb[1].toUpperCase(),
              roles,
              door: /@Allow([A-Za-z]+)\(\)/.exec(head)?.[1] ?? null,
            },
          ];
        });
    }),
);

describe('the controller sweep itself is sound', () => {
  it('found the whole application, not a subset', () => {
    // A parser that silently matched nothing would make every assertion below vacuous.
    expect(controllerFiles.length).toBeGreaterThan(10);
    expect(routes.length).toBeGreaterThan(90);
  });
});

describe('REVIEWER is view-only by construction', () => {
  it('appears on NO mutating route anywhere in the application', () => {
    const offenders = routes
      .filter((r) => r.method !== 'GET' && r.roles.includes(Role.REVIEWER))
      .map((r) => r.name);
    expect(offenders).toEqual([]);
  });

  it('holds NO named door', () => {
    // The three doors belong to OVERSIGHT. Reviewer has none and must acquire none.
    const doors = routes.filter((r) => r.door && r.roles.includes(Role.REVIEWER)).map((r) => r.name);
    expect(doors).toEqual([]);
  });

  it('reaches only the inward review surface — invoice, slips, and nothing else', () => {
    const reachable = routes.filter((r) => r.roles.includes(Role.REVIEWER)).map((r) => r.name).sort();
    // Deliberately an exact list: widening the Reviewer must be a visible diff here.
    expect(reachable).toEqual([
      'GET /inwards',
      'GET /inwards/:poId/slip',
      'GET /receiving-slips',
      'GET /receiving-slips/:id',
      'GET /receiving-slips/by-po/:poId',
      // The document itself — the other half of the side-by-side review.
      'GET /purchase-orders/:id/file',
    ].sort());
  });

  it('cannot reach stock, requests, batches, dispatch, users or settings', () => {
    const forbidden = ['/stock', '/production-requests', '/batches', '/finished-goods', '/admin/users', '/settings'];
    for (const prefix of forbidden) {
      const hit = routes.filter((r) => r.roles.includes(Role.REVIEWER) && r.name.includes(prefix));
      expect({ prefix, hit: hit.map((h) => h.name) }).toEqual({ prefix, hit: [] });
    }
  });
});
