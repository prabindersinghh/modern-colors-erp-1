import { Role } from '@prisma/client';
import { AuditController } from './audit.controller';
import { STORE_AUDIT_SCOPE } from './audit.service';

/**
 * The controller half of the audit confinement: the scope is decided HERE from the
 * caller's role, never from a query parameter. The Store desk (ADMIN) is handed the
 * STORE_AUDIT_SCOPE allow-list; the whole-factory readers (Oversight, Supervisor) are
 * handed no scope at all — the whole trail. Paired with audit-scope.spec, which proves
 * the engine cannot be widened once a scope is set.
 */
describe('audit controller role scoping', () => {
  const build = () => {
    const calls: any[] = [];
    const audit = {
      query: (p: any) => (calls.push({ m: 'query', p }), Promise.resolve({ data: [] })),
      summary: (p: any) => (calls.push({ m: 'summary', p }), Promise.resolve([])),
    };
    return { ctrl: new AuditController(audit as never), calls };
  };
  const asUser = (role: Role) => ({ id: `u-${role}`, role }) as never;

  it('confines the Store desk (ADMIN) to STORE_AUDIT_SCOPE on the list', async () => {
    const { ctrl, calls } = build();
    await ctrl.query(asUser(Role.ADMIN));
    expect(calls[0].p.actionScope).toEqual(STORE_AUDIT_SCOPE);
  });

  it('gives Oversight the whole trail — no scope', async () => {
    const { ctrl, calls } = build();
    await ctrl.query(asUser(Role.OVERSIGHT));
    expect(calls[0].p.actionScope).toBeUndefined();
  });

  it('gives Supervisor the whole trail — no scope', async () => {
    const { ctrl, calls } = build();
    await ctrl.query(asUser(Role.SUPERVISOR));
    expect(calls[0].p.actionScope).toBeUndefined();
  });

  it('applies the same confinement to the per-login summary', async () => {
    const { ctrl, calls } = build();
    await ctrl.summary(asUser(Role.ADMIN));
    expect(calls[0].p.actionScope).toEqual(STORE_AUDIT_SCOPE);
  });

  it('applies the same confinement to the legacy entity read', async () => {
    const { ctrl, calls } = build();
    await ctrl.entity(asUser(Role.ADMIN), 'FinishedGood', 'fg-1');
    expect(calls[0].p.actionScope).toEqual(STORE_AUDIT_SCOPE);
  });
});
