# Phase 2 — User Acceptance Test (UAT) Script

> **Document version:** 1.1  
> **Last updated:** 2026-07-21  
> **Describes:** Manual UAT script for Phase 2 (requests, approval, stock movement). Still valid.  
> **Earlier versions:** see [`docs/archive/`](./archive/) · full history in [`CHANGELOG.md`](./CHANGELOG.md)


Manual end-to-end test for **Production Requests, Store Approval & Stock Movement**.
Run against the live deployment (or a local build). Nothing here is destructive to
Phase 1 data. Tick each ☐ as you go; note any ✗ with what you saw.

## 0. Logins (all six roles, all live in the database)

| Role (display)      | Email                          | Password        | Dept   | Sees |
|---------------------|--------------------------------|-----------------|--------|------|
| **Store** (`ADMIN`) | `admin@moderncolours.local`    | *(your admin pw)* | —    | Everything except other users' settings |
| **Admin** (`OVERSIGHT`, view-only) | `oversight@moderncolours.local` | `ChangeMe123!`¹ | — | All departments, read-only |
| **PU Head**         | `pu@moderncolours.local`       | `ChangeMe123!`¹ | PU     | PU only |
| **Enamel Head**     | `enamel@moderncolours.local`   | `ChangeMe123!`¹ | ENAMEL | ENAMEL only |
| **Powder Head**     | `powder@moderncolours.local`   | `ChangeMe123!`¹ | POWDER | POWDER only |
| **Dispatch**        | `dispatch@moderncolours.local` | `ChangeMe123!`¹ | —      | Finished goods only (Phase 3) |

¹ Unless overridden when the seed was run — `SEED_PHASE2_PASSWORD` for the oversight and department-head
logins, `SEED_PHASE3_PASSWORD` for dispatch.
**Change every one of these after first login before a real go-live** — the default is
published in this document, so it must not survive into production use.

> Phase 1 also has `SUPERVISOR` and `OPERATOR` logins for the receiving floor; they are
> unchanged by Phase 2/3 and are covered by the Phase 1 checks, not this script.

> Tip: use separate browsers / private windows so you can stay logged in as more
> than one role at once (Store in one, PU Head in another).

---

## 1. Production Head — raise a multi-material request

Log in as **PU Head**.

- ☐ You land on **Requests** (not the Phase 1 dashboard).
- ☐ The sidebar shows **only** Requests — no Invoice Upload / Receive Stock / Stock / Oversight.
- ☐ Click **Raise a material request**. Add **3+ material lines** from the catalogue
  picker, each with a KG amount (e.g. Titanium Dioxide 10, Iron Oxide Red 5, Calcium
  Carbonate 6). Add a note (optional). Submit.
- ☐ The new request appears in your list as **one card with all the lines**, status
  **Pending**, department **PU**.
- ☐ You **cannot** see any ENAMEL or POWDER requests (log in as Enamel Head in another
  window and confirm they see a different/empty list — no PU requests).

**Negative / isolation**
- ☐ As PU Head, there is no way to pick a department other than PU when raising a
  request (it's forced to yours).

---

## 2. Store — review each line (Accept / Partial / Reject)

Log in as **Store** (`admin@…`).

- ☐ Sidebar shows **Requests** (labelled inbox), **Scan & Issue**, **Stock Levels**
  (plus all the Phase 1 items). No **Oversight**.
- ☐ Open **Requests** — the PU request shows an **Action** column and an
  **"N to action"** badge.
- ☐ On line 1 click **Accept** → line goes **Approved**, approved KG = requested KG.
- ☐ On line 2 click **Partial**, enter a KG **less than** requested, confirm → line
  goes **Partial** with the lower approved KG.
- ☐ On line 3 click **Reject**, enter a reason, confirm → line goes **Rejected** and
  the reason shows under the material name.
- ☐ The **parent request status** recomputes correctly:
  - all still pending → **Pending**
  - some actioned, some pending → **In progress**
  - all accepted → **Approved**
  - all rejected → **Rejected**
  - mixed (your accept + partial + reject) → **Partial**
- ☐ Approved/Partial lines now show an **Issue** button; Rejected shows "decided".

**Negative**
- ☐ Try a Partial equal to or above the requested KG → rejected with a message.
- ☐ Try a Reject with an empty reason → rejected (reason required).

**Isolation (server-side, not just UI)**
- ☐ Log in as **PU Head** and confirm you **cannot** review your own lines (no
  Accept/Partial/Reject controls — only Store sees them). The review endpoint is
  Store-only even if called directly.

---

## 3. Store — scan a unit & move stock (Add / Deduct / Discard)

Still as **Store**, open **Scan & Issue**.

Use a unit that **has a stock balance**. Since 2026-07-20 the balance comes from the
**PO pack weight** at registration, not from weighing at receiving — so most units have one
already. Known good units at time of writing: **MC-000296** (Titanium Dioxide, 24 kg),
**MC-000306** (Calcium Carbonate, 2 kg), **MC-000001** (Titanium Dioxide, 24.8 kg).
You can also scan the printed QR with the camera.

- ☐ Scan/enter a unit that has a balance → the unit card shows **material, SKU, PO, live balance**.
- ☐ All three actions **Add / Deduct / Discard** are always offered.
- ☐ **Add** e.g. 5 kg to a department → balance goes **up** by 5; a row appears in the
  unit's **movement history**.
- ☐ **Deduct** e.g. 3 kg for a department → balance goes **down** by 3.
- ☐ **Discard** e.g. 1 kg → balance goes down; no department field is required.
- ☐ **Over-deduction is blocked**: try to Deduct (or Discard) **more than the balance**
  → rejected with "only X kg remain". Balance never goes negative.

**Negative**
- ☐ Scan a unit whose PO line carried **no pack weight** (balance null) → blocked with
  *"has no pack weight from its invoice, so its stock balance is unknown"*. A few units are
  **deliberately left in this state** so this path stays testable — see [`HANDOVER.md`](./HANDOVER.md).
- ☐ Add/Deduct with **no department** selected → blocked.
- ☐ Quantity 0 or negative → blocked.

---

## 4. Store — issue against an approved request line (QR-verify)

Still as **Store**, open **Requests** and find an **Approved** or **Partial** PU line.

- ☐ Click **Issue** on that line → you're taken to **Scan & Issue** with a blue
  "Issuing a request line" banner (material, approved KG, issued KG, remaining), the
  action pre-set to **Deduct**, the department pre-filled to the request's department,
  and the quantity pre-filled to the remaining approved KG.
- ☐ Scan the **correct** material's unit → it's accepted; confirm the Deduct.
- ☐ The line's **issued KG** goes up; when fully issued it shows **fulfilled**.
- ☐ **Hard QR-verify**: start an Issue for the line, then scan a unit of a **different**
  material → **rejected** ("Scanned … but this line requested …"). You cannot issue the
  wrong material against a line.

**Negative**
- ☐ Try to issue **more than the approved KG** across one or more scans → the amount
  over the approved cap is blocked.

---

## 5. Store / Admin — live stock levels & the append-only ledger

Open **Stock Levels** (as **Store**, then repeat as **Admin**).

- ☐ **Live levels** tab: each material shows total **on-hand KG** and unit count;
  expand a row to see individual units and their balances; the header shows the
  factory-wide total.
- ☐ The totals reflect the Add/Deduct/Discard you just did in §3–§4.
- ☐ **Movement ledger** tab: every movement you made appears, newest first, with type,
  unit, material, qty, department, balance-after, and who did it.
- ☐ Filter by **type**, **department**, and **unit ID** — results narrow correctly.
- ☐ The ledger is **read-only** — there is no edit/delete anywhere, and it's labelled
  "Append-only — corrections are new entries."

---

## 6. Admin (Oversight) — the factory-wide dashboard

Log in as **Admin** (`oversight@…`).

- ☐ You land on **Oversight**. Sidebar shows **Oversight, Requests, Stock Levels** —
  **no** Scan & Issue, no Phase 1 action screens.
- ☐ **Snapshot cards**: on-hand stock, and Added / Deducted / Discarded (30-day +
  all-time) — numbers match what you did.
- ☐ **Requests by department** matrix shows PU's counts across the statuses.
- ☐ **Fulfilment by department** bars show issued / requested with the approved figure.
- ☐ **Recent movements** and **Recent request reviews** feeds are populated.
- ☐ Drill-through links (Requests, Stock Levels) work.

**View-only / isolation**
- ☐ As Admin you can open **Requests** but there are **no** Accept/Partial/Reject or
  Issue controls (view-only).
- ☐ As Admin you **cannot** reach Scan & Issue (no nav item; typing `/stock` in the URL
  is blocked).

---

## 7. Cross-role consistency (the "all 3 dashboards" check)

Do a final loop with three windows open (Store, Admin, PU Head):

- ☐ PU Head raises a fresh 2-line request → it appears in **Store's** inbox and is
  counted in **Admin's** Oversight matrix, but is invisible to **Enamel/Powder Heads**.
- ☐ Store accepts one line, partials the other → PU Head sees the updated statuses and
  approved KG on their own request; Admin's fulfilment/matrix update.
- ☐ Store issues stock against the accepted line → PU Head sees issued KG rise; Admin's
  Deducted total and recent-movements feed update; Stock Levels balance drops.
- ☐ Nothing a Head does can affect or reveal another department's data.

---

## 8. Phase 1 regression (must still work untouched)

Quickly confirm Phase 2 didn't disturb Phase 1, logged in as **Store**:

- ☐ Invoice Upload → AI extraction → Review & Confirm → QR Labels still work.
- ☐ **Receiving** still scans. Note it is now **scan-only and rapid-fire** — there is no
  per-unit weighing step in the flow (the weight endpoint survives only as a *correction* path).
- ☐ The **scanner mode toggle** switches between the phone camera and an external WiFi/USB
  scanner on every scan screen.
- ☐ Master Catalogue and Audit Log open normally.
- ☐ Operator / Supervisor logins (if used) still see only their Phase 1 screens.

---

### Notes / defects found

_Record anything that didn't match here:_

-
-
