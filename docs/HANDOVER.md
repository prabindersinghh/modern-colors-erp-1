# Handover runbook — Modern Colours

> **Document version:** 1.0  
> **Last updated:** 2026-07-21  
> **Describes:** The runbook for handover day, including the database flush.  
> **Earlier versions:** see [`docs/archive/`](./archive/) · full history in [`CHANGELOG.md`](./CHANGELOG.md)


The checklist for the day the system stops being ours and becomes the factory's.

Read it end to end **before** starting. The flush step is the only genuinely
irreversible action in the project.

---

## ⚠️ Two things that will hurt if you get them wrong

### 1. `ENCRYPTION_KEY` must never change

The factory's Claude API key is stored **AES-256-GCM encrypted** in the `Setting`
table. `ENCRYPTION_KEY` is the **only** thing that can decrypt it.

If it is changed, rotated, or lost:

- the stored Claude API key is **permanently unrecoverable** — restoring a database
  backup will **not** bring it back, because the ciphertext is useless without the key;
- invoice AI extraction stops working and silently falls back to manual entry;
- the only fix is for an Admin to re-enter the key in **Settings**.

Changing the **database** while keeping this key is safe. Changing **this key** is not.
It is documented in three places on purpose: here, in `backend/.env.example`, and in
[`DEPLOYMENT.md`](./DEPLOYMENT.md).

### 2. The flush deletes the audit log — a deliberate exception to invariant I4

Invariant **I4** says the audit log is append-only: the application never updates or
deletes a row, and corrections are new entries referencing the original.

`prisma/flush.ts` breaks that invariant **on purpose, exactly once**. The existing trail
documents *our* development and testing, not the factory's operations. Carrying it over
would mean their permanent compliance record opens with hundreds of entries about
material that never existed.

`prisma/flush.ts` is the **only** place in the codebase permitted to delete audit rows.
Wanting to delete audit rows anywhere else is a bug — corrections are new entries.

The flush writes one final entry, `SYSTEM_FLUSHED_FOR_HANDOVER`, explaining the gap, so
a future auditor sees why the log starts where it does rather than suspecting tampering.

---

## Before handover day

- [ ] Confirm the R2 token has **Object Read & Write** on `modern-colors-storage`
      → `GET /api/health/storage?deep=1` (Store/Admin login) returns `"ok": true`
- [ ] **Change every default password.** `ChangeMe123!` is published in
      [`PHASE2_UAT.md`](./PHASE2_UAT.md). The Admin's **Users** tab flags any login
      still using it — reset those, or deactivate the seeded heads you are not using
      and create your own.
- [ ] Decide which logins the factory actually wants. The Admin can create Production
      Head and Dispatch logins himself in **Users**; rows are marked *"Came with the
      system"* or *"Created by you"*. Logins are never deleted, only deactivated, so
      history stays attributed.
- [ ] Decide: is the Master Catalogue still demo data, or the factory's real
      ~500–600 SKUs? This decides `--flush-catalogue` below.
- [ ] Enter the factory's own Claude API key in **Settings**
- [ ] Take a **Neon branch/snapshot** — this is the rollback

## The flush

Wipes all transactional data. Keeps **every user account**, the encrypted Claude key,
and (by default) the catalogue.

```bash
cd backend

# 1. ALWAYS dry-run first. Writes nothing. Prints a before/after table.
npx ts-node prisma/flush.ts

# 2. Check the printed database host is the one you intend.

# 3. Real run — needs BOTH the env flag and the exact typed phrase.
ALLOW_FLUSH=yes npx ts-node prisma/flush.ts --confirm "FLUSH MODERN COLOURS"
```

| Flag | Effect |
|---|---|
| *(none)* | Dry run. Nothing is written. |
| `--flush-catalogue` | **Also** wipe the Master Catalogue. Only if it is demo data. |
| `--keep-files` | Do **not** delete uploaded invoices from R2. |
| `--yes-really` | Skip the 10-second abort window. |

**It will not run** unless `ALLOW_FLUSH=yes` **and** `--confirm "FLUSH MODERN COLOURS"`
are both present. Either alone gives a dry run.

### What it does

| Kept | Deleted |
|---|---|
| `User` (all 7 logins, roles, departments) | Purchase orders + line items |
| `Setting` (encrypted Claude key) | Materials + QR codes |
| `MasterCatalogueItem` *(unless `--flush-catalogue`)* | Stock transactions |
| | Production requests + items |
| | Batches, production outputs |
| | Finished goods + FG QRs |
| | **Audit log** (see the exception above) |
| | Uploaded invoices in R2 *(unless `--keep-files`)* |

It also **resets the unique-ID sequences**, so the factory's first sack is `MC-000001`
and not `MC-000351`. Without that the numbering is valid but confusing forever.

The delete order is foreign-key safe and is **verified by a test**
(`src/handover/flush-plan.spec.ts`) against the live schema — so adding a model that
would break the flush fails CI rather than handover day.

## After the flush

- [ ] Log in as each of the six roles and confirm each lands on its own screen
- [ ] Upload one real invoice end to end: upload → extract → review → confirm →
      labels → receive → issue
- [ ] Print one label on the **real** label printer and scan it with the **real**
      WiFi scanner (3×1.5in / 216×108pt — the one thing no test can prove)
- [ ] Import the factory's real catalogue (Master Catalogue → **Template** →
      fill → Import)
- [ ] Confirm `MC-000001` was the first unit created

---

## If something goes wrong

| Symptom | Cause | Fix |
|---|---|---|
| Invoice upload fails with "file storage is unavailable" | R2 token wrong/expired or lacks write | Cloudflare → R2 → Manage API Tokens → **Object Read & Write** on `modern-colors-storage`. Verify with `/api/health/storage?deep=1`. |
| AI extraction always falls back to manual | No Claude key, or `ENCRYPTION_KEY` changed | Re-enter the key in **Settings**. |
| A material cannot be issued — "no pack weight" | The invoice had no per-package size (bulk line) | Set the pack weight once on the PO line; every unit on that line inherits it. |
| Flush stops partway | A foreign key blocked a delete | Restore the Neon snapshot. Then fix `DELETE_ORDER` in `prisma/flush.ts` and re-run the plan test. |

The system is designed so **storage being down never blocks the factory** — invoices can
still be entered manually, and QR/FG labels are generated in-process and keep printing.
