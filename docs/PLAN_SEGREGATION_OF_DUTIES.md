# Plan — Segregation of duties: Gate, Reviewer, and commercial invisibility for Store

> **Status:** PLAN ONLY — nothing built, nothing migrated.
> **Prepared:** 2026-07-22, against commit `ffc92ac`.
> **Every claim below was verified against the code at planning time.** Where I checked
> something and found the brief's premise did not match the code, it says so explicitly.

---

## 0. Three findings that change the shape of the work

Read these first; the rest of the plan depends on them.

### 0.1 There is no price data in this system to hide

I searched every model in `schema.prisma` for a price, rate, amount, total, cost or tax
column. **There are none.** `POLineItem` holds `materialName, sku, hsnCode, quantity, unit,
weight, batchNumber, matchType` — and nothing commercial. `PurchaseOrder` holds
`poNumber, supplier, fileKey, fileName, status, source, extractedJson, deliveryDate`.

I also checked the extraction contract: the tool schema in `ai-extraction.service.ts`
asks Claude for exactly eight fields per line, and **price is not among them**. So
`extractedJson` — despite the brief listing it as a price channel — contains no prices
either. And I checked the audit rows: `PO_UPLOADED` stores `{fileName}`, `AI_EXTRACTED`
stores `{lineItemCount}`, `MATERIALS_REGISTERED` stores `{unitCount}`. **No extraction
payload is ever serialized into an audit row.**

**Consequence:** the commercial secret in this system is *the invoice document itself* —
the PDF/image in R2 — plus, arguably, the HSN tax codes. That makes the job far more
tractable than a field-level redaction sweep, and it moves the real risk to exactly two
things: who can fetch the file, and who can see a link to it.

I still propose the structural test the brief asks for (§5.4), because "no price column
exists today" is a fact that must be *kept* true, not assumed.

### 0.2 Two fields ARE leaking today, to every Phase-1 role

`PurchaseOrderService.list()` and `findOne()` both use Prisma `include` with **no
`select`**. Prisma returns all scalars by default, so every caller of
`GET /purchase-orders` and `GET /purchase-orders/:id` currently receives:

- **`fileKey`** — the raw R2 storage key
- **`extractedJson`** — the full extraction result

Both are named in the brief's forbidden set. Neither contains prices, but `fileKey` is an
infrastructure identifier we deliberately stripped from error messages back on 20 July
(`44df396`) and are handing out in a JSON body. **This is a real finding and I would fix
it regardless of this restructure.**

### 0.3 The receiving slip you want to "extend" does not exist server-side

The brief says: *do not invent a new artifact — extend the existing receiving-session
closing summary / printable slip (`8619cea`)*, and it must *surface in Store's dashboard*
and be *listed historically*.

`frontend/src/lib/receivingSession.ts` says, in its own header comment:

> *Deliberately CLIENT-SIDE ONLY. … State lives in localStorage.*

There is no session model, no session table, and no session endpoint. The backend
`receiving` module has `scan`, `recent` and `weight` — nothing else. The existing slip is
rendered in the Gate's browser from localStorage and vanishes if they clear it.

**Consequence:** "extend, don't invent" can be honoured for the slip's *content and print
path* — I will reuse the summary's shape, its kg/L splitting and its print route — but a
**new server-side model is unavoidable** if Store is to see it and history is to exist.
I am flagging this rather than quietly building a table you told me not to build.

There is a second wrinkle in the same requirement: *"generated automatically when Review &
Confirm completes and finalized at session Done"* names two moments with two different
data sources. Registration is server-side and knows the unit ID ranges; session Done is
currently client-side and knows what was physically scanned. §4 proposes how to bridge
that.

---

## 1. Role matrix (target state)

Six enum values become seven; six actors become eight.

| Enum | UI label | Home | Capability | Change |
|---|---|---|---|---|
| `OPERATOR` | **Gate** | `/` | Entire Phase-1 inward flow: invoice upload → extraction → Review & Confirm → QR mint → label print → scan-to-receive. Raises reprint requests. | **Relabelled + becomes the only inward actor** |
| `ADMIN` | **Store** | `/store` | Request inbox, scan & issue, stock levels & ledger, catalogue, settings, user management, receiving slips (read). **No invoice, no Review & Confirm, no QR/labels.** | **Loses inward** |
| `OVERSIGHT` | **Admin** (owner) | `/oversight` | Factory-wide view-only + three named write doors. **Retains full commercial visibility including the invoice document.** | Unchanged |
| `SUPERVISOR` | Supervisor | `/` | Phase-1 read + audit log | **Open question Q3** |
| `PRODUCTION_HEAD` | *Dept* Head | `/my` | Department-scoped requests, batches, output | Unchanged |
| `DISPATCH` | Dispatch | `/dispatch` | Finished goods only | Unchanged |
| `REVIEWER` **(new)** | Reviewer | `/review-inwards` | **Strictly view-only:** invoice document + digital slip, side by side, per inward. Nothing else. | **New enum value** |

### 1.1 Verdict on reusing OPERATOR for Gate — reuse, unchanged

The brief asked me to verify before committing. I enumerated OPERATOR's complete route
surface by parsing every controller: **29 routes**. Against the Gate target:

| OPERATOR route group | Correct for Gate? |
|---|---|
| Invoice list / findOne / file | ✅ Gate must read the invoice |
| Invoice upload, manual, extract, line-item CRUD, confirm | ✅ the inward flow |
| `materials`, `materials/needs-weight`, `materials/:id`, `purchase-orders/:poId/units` | ✅ post-registration review |
| `materials/:id/qr.png`, `labels.pdf`, `labels.zip`, `labels.csv` | ✅ printing moves to Gate |
| `receiving/scan`, `receiving/recent`, `receiving/:uniqueId/weight` | ✅ scan-to-receive |
| `purchase-orders/:poId/pack-weight` | ✅ but see **Q2** |
| `label-reprints` status / request / list | ✅ Gate prints, so Gate requests |
| `dashboard/summary`, `dashboard/search` | ✅ the Phase-1 inward overview |
| `POST /catalogue` | ✅ **keep** — adding a no-match SKU mid-review is exactly what `810c8ee` built this for |

**Nothing in OPERATOR's current surface is wrong for Gate.** No enum change, no guard
change, no delta. Gate is `OPERATOR` with a new UI label and a seeded login. This is the
cheapest correct answer and I recommend it.

`OPERATOR` is genuinely dormant: `op1@moderncolours.local` is the only such login and has
been deactivated since before 21 July.

---

## 2. Endpoint-by-endpoint access changes

### 2.1 Store (ADMIN) loses — 13 routes

| Route | Old | New |
|---|---|---|
| `GET /purchase-orders` | ADMIN, OPERATOR, SUPERVISOR, OVERSIGHT | OPERATOR, OVERSIGHT, REVIEWER *(Q3)* |
| `GET /purchase-orders/:id` | ″ | ″ |
| `GET /purchase-orders/:id/file` | ″ | ″ |
| `POST /purchase-orders` | ADMIN, OPERATOR | OPERATOR |
| `POST /purchase-orders/manual` | ADMIN, OPERATOR | OPERATOR |
| `POST /purchase-orders/:id/extract` | ADMIN, OPERATOR | OPERATOR |
| `POST /purchase-orders/:id/manual` | ADMIN, OPERATOR | OPERATOR |
| `POST /purchase-orders/:id/line-items` | ADMIN, OPERATOR | OPERATOR |
| `PATCH /purchase-orders/:id/line-items/:itemId` | ADMIN, OPERATOR | OPERATOR |
| `DELETE /purchase-orders/:id/line-items/:itemId` | ADMIN, OPERATOR | OPERATOR |
| `POST /purchase-orders/:id/confirm` | ADMIN, OPERATOR | OPERATOR |
| `GET /purchase-orders/:poId/labels.{pdf,zip,csv}` | ADMIN, OPERATOR, SUPERVISOR, OVERSIGHT | OPERATOR, OVERSIGHT |
| `GET /materials/:id/qr.png` | ″ | OPERATOR, OVERSIGHT |

### 2.2 Store (ADMIN) keeps — explicitly

`GET /materials`, `/materials/needs-weight`, `/materials/:id`,
`GET /purchase-orders/:poId/units`, all of `/stock/*`, `/production-requests/*`,
`/catalogue/*`, `/settings/*`, `/admin/users/*`, `/analytics/*`, `/dashboard/*`.

This is what preserves `462d07a`'s guarantee: **received material stays findable by Store
everywhere, immediately** — the material records are untouched, only the commercial
wrapper is removed. `GET /purchase-orders/:poId/units` returns unit rows, not invoice
data, and is the join Store uses to see what an inward delivered; I propose keeping it and
**renaming the route** in a later pass rather than breaking it now.

### 2.3 REVIEWER gains — 3 routes, all GET

| Route | Purpose |
|---|---|
| `GET /inwards` *(new)* | List of inwards: supplier, date, slip ID, invoice presence |
| `GET /inwards/:id` *(new)* | One inward: the digital slip payload + invoice metadata |
| `GET /purchase-orders/:id/file` | The invoice document itself |

REVIEWER appears in **no mutating route anywhere**, asserted by a sweep test (§5.3).

### 2.4 Receiving — unresolved, see Q1

`POST /receiving/scan`, `GET /receiving/recent`, `POST /receiving/:uniqueId/weight` are
`[ADMIN, OPERATOR]` today. Item 1 gives scan-to-receive to Gate; item 2 says Store loses
"exactly four things" and receiving is not one of them. **These conflict.** I have not
assumed. See Q1.

---

## 3. Schema diff and migration SQL

Additive only. Two changes.

```sql
-- 1. The Reviewer role. Precedent: 20260721200000 added FgStatus values the same way.
--    PG 12+ permits ADD VALUE inside a transaction provided the value is not USED in the
--    same transaction; this migration only declares it.
ALTER TYPE "Role" ADD VALUE 'REVIEWER';

-- 2. The digital receiving slip. One row per inward, created at registration.
--    NOT a replacement for the client-side session: that stays exactly as it is, and
--    finalisation posts its summary here.
CREATE TYPE "SlipStatus" AS ENUM ('DRAFT', 'FINALIZED');

CREATE TABLE "ReceivingSlip" (
    "id"            TEXT           NOT NULL,
    "poId"          TEXT           NOT NULL,
    "slipNumber"    TEXT           NOT NULL,   -- human reference, e.g. RS-000001
    "supplier"      TEXT,
    "receivedDate"  TIMESTAMP(3)   NOT NULL,
    -- Denormalised, price-free snapshot of what arrived. Frozen at generation so a later
    -- catalogue edit cannot rewrite what the gate guard handed over on paper.
    "lines"         JSONB          NOT NULL,   -- [{materialName, sku, quantity, unit,
                                               --   packWeight, measure, idFrom, idTo}]
    "unitCount"     INTEGER        NOT NULL,
    "status"        "SlipStatus"   NOT NULL DEFAULT 'DRAFT',
    "generatedById" TEXT           NOT NULL,
    "generatedAt"   TIMESTAMP(3)   NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finalizedById" TEXT,
    "finalizedAt"   TIMESTAMP(3),
    "scannedCount"  INTEGER,                   -- from the gate's session at Done
    CONSTRAINT "ReceivingSlip_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ReceivingSlip_poId_key"       ON "ReceivingSlip"("poId");
CREATE UNIQUE INDEX "ReceivingSlip_slipNumber_key" ON "ReceivingSlip"("slipNumber");
CREATE INDEX        "ReceivingSlip_status_idx"     ON "ReceivingSlip"("status");

ALTER TABLE "ReceivingSlip" ADD CONSTRAINT "ReceivingSlip_poId_fkey"
    FOREIGN KEY ("poId") REFERENCES "PurchaseOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ReceivingSlip" ADD CONSTRAINT "ReceivingSlip_generatedById_fkey"
    FOREIGN KEY ("generatedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ReceivingSlip" ADD CONSTRAINT "ReceivingSlip_finalizedById_fkey"
    FOREIGN KEY ("finalizedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Counts are never negative.
ALTER TABLE "ReceivingSlip" ADD CONSTRAINT "ReceivingSlip_counts_sane"
    CHECK ("unitCount" >= 0 AND ("scannedCount" IS NULL OR "scannedCount" >= 0));
```

**No new column on any existing table.** `lines` is JSONB and deliberately denormalised:
the slip is a *record of what was handed over*, so it must not change when the catalogue
or a material record is later edited.

**Store's inward flip needs no schema change** — see §6.

### 3.1 Flush

`ReceivingSlip` references `PurchaseOrder` and `User`, so it goes **immediately before
`PurchaseOrder`** in `DELETE_ORDER` — concretely, directly after `Material`. Because
`flush-plan.spec.ts` derives parents from the schema, getting this wrong fails a test
rather than the handover; I will prove it by running the spec, not by asserting it.

---

## 4. The digital receiving slip

### 4.1 Lifecycle

| Moment | Actor | What happens |
|---|---|---|
| Review & Confirm completes (registration) | Gate | Slip auto-generated `DRAFT` with supplier, date, every line, quantities **with units kept separate**, pack weights, and unit ID ranges (`MC-000101–MC-000150`) — all of which the server knows at registration |
| Gate presses **Done** on the session | Gate | Existing client summary posts `scannedCount`; slip → `FINALIZED`. Audited |
| Any time after generation | Store | Sees the slip on its dashboard per inward; can print it |
| Any time | Reviewer | Sees invoice + slip side by side |

The gate guard prints the slip and walks a paper copy to Store; Store has the same
document on screen, which is the point.

### 4.2 What it must never contain

No prices, no amounts, no HSN-linked totals, no invoice image, no `fileKey`, no
`extractedJson`. The `lines` payload is built by an explicit allow-list — a mapper that
names each field it copies — not by spreading a Prisma record. Asserted in §5.4.

### 4.3 Reuse, not reinvention

The slip's *content and layout* come from the existing closing summary: same kg/L
splitting via `formatUnitTotals`, same print route, same visual language. What is new is
persistence and the two read surfaces. `receivingSession.ts` itself stays client-side and
unchanged.

---

## 5. Test plan

| Spec | Change |
|---|---|
| `phase1-access.spec.ts` | **Inverts.** Line 98 currently asserts *"Store (ADMIN) retains access to every Phase 1 endpoint"*. Becomes: Store reaches **no** inward endpoint; Gate (OPERATOR) reaches all of them; DISPATCH still reaches none |
| `roles.guard.spec.ts` | Add REVIEWER; assert it is admitted nowhere it is not listed |
| `nav.spec.ts` | GATE and REVIEWER home routes in `ROUTE_ROLES`; the App.tsx-parsing drift test must still pass; **back-navigation for a Reviewer can never resolve to a priced screen** |
| `label-reprint.spec.ts` | "Store approval 403" → **"Store print 403"**; Gate print/request paths; Gate cannot approve; Oversight-only approval and no-fallback stance unchanged |
| `user-admin.spec.ts` | Three named doors unchanged; `CREATABLE_ROLES` updated per Q4 |
| `flush-plan.spec.ts` | `ReceivingSlip` accounted for and correctly ordered |
| **`commercial-isolation.spec.ts`** *(new)* | §5.4 |
| **`reviewer-isolation.spec.ts`** *(new)* | §5.3 |

### 5.3 Reviewer sweep

Modelled on the named-door sweep: walk every controller, and for every non-GET handler
assert `REVIEWER` appears in no `@Roles` list and holds no door decorator. Reviewer's
view-only property becomes machine-checked exactly the way OVERSIGHT's is, so a future
edit that hands Reviewer a write fails a test.

### 5.4 Commercial isolation

Two layers, because one is not enough:

1. **Structural (no DB needed).** Assert that no service passes `fileKey` or
   `extractedJson` into a response: `PurchaseOrderService.list/findOne` must use an
   explicit `select`, and a source-level test asserts the forbidden identifiers appear in
   no controller or service return path outside the file-download handler. Also asserts
   the schema still contains **no** price/rate/amount/total column — so if someone adds
   one later, they are forced to decide who sees it.
2. **Serialization (belt and braces).** A response interceptor strips the forbidden key
   set for any role outside the allow-list (`OPERATOR`, `REVIEWER`, `OVERSIGHT`, and
   `SUPERVISOR` per Q3). Unit-tested against a nested fixture, so a field buried three
   levels deep in a trace response is still removed.

I checked the channels the brief names. Findings, all verified rather than assumed:

| Channel | Finding |
|---|---|
| `/batches/:id/trace` | Walks to units and suppliers, **not** to `PurchaseOrder` scalars. No leak today |
| Stock & dispatch analytics, Company Brain | Aggregate over materials/FG. No PO scalars |
| `/dashboard/search` | Filters *by* `po.poNumber`; returns material rows |
| CSV / label exports | Contain `hsnCode` — see Q5 |
| **Audit log views** | `PO_UPLOADED` → `{fileName}`; `AI_EXTRACTED` → `{lineItemCount}`; `MATERIALS_REGISTERED` → `{unitCount}`. **No payload, no prices.** Nothing to redact, so §9's redaction-on-read is not needed — and I will not modify stored rows |
| **`GET /purchase-orders` and `/:id`** | **LEAKING `fileKey` + `extractedJson`.** Fix in this change |

---

## 6. The reversible flip

**Recommendation: a `Setting` row, not an env flag and not a capability table.**

`Setting` already exists and is already the encrypted key/value store. One row —
`STORE_INWARD_ACCESS = "on" | "off"` — read by a tiny guard that runs after `RolesGuard`
on the 13 routes in §2.1.

- **Flip (revoke):** one authenticated call by Oversight, or one SQL `UPDATE`. Effective
  within the cache TTL.
- **Flip back (restore):** identical, opposite value.
- **Cache:** 10-second in-memory TTL, invalidated immediately on write. Ten seconds is
  short enough to feel instant and long enough that the guard is not a per-request query.

Why not the alternatives: an **env flag** needs a Railway redeploy to change — with build
times observed between 28 seconds and 30 minutes, "instantly reversible" would be a lie.
A **role-capability table** is the right shape for ten flags and overbuilt for one.

Both directions are audited (`STORE_INWARD_ACCESS_CHANGED`).

---

## 7. Cutover sequence

Non-negotiable order. **At no point can the factory be unable to receive a truck.**

| # | Step | Reversal |
|---|---|---|
| 1 | Backup — schema snapshot, per-table row counts, full row exports of `PurchaseOrder`, `POLineItem`, `Material`, `User`, via raw SQL (pg_dump 17.6 refuses the 18.4 server; no Neon API key). Confirm host = `ap-southeast-1`, non-pooled | — |
| 2 | Install `preDeployCommand` in `railway.json` (§8) | Revert commit |
| 3 | Apply migration | Drop table + `DROP TYPE`; the enum value is additive and harmless |
| 4 | Deploy backend + frontend **with Store access UNCHANGED** (flag defaults `on`) | Redeploy previous |
| 5 | Seed/mint `gate@`, `pallavi@`, `rupinder@` | Deactivate |
| 6 | **Live end-to-end as Gate on one real invoice:** upload → extract → confirm → labels → receive → slip appears in Store's dashboard and in Reviewer's list | — |
| 7 | **Only after 6 passes:** flip `STORE_INWARD_ACCESS = off` | Flip back — seconds |

Step 6 is the gate on step 7 and I will not propose the flip until it has passed live.

---

## 8. Railway pre-deploy

Per my own 22 July report, item 6. Add to `railway.json`:

```json
"deploy": {
  "preDeployCommand": "npx prisma migrate deploy",
  "healthcheckPath": "/api/health",
  ...
}
```

Railway runs it after build, before the new container takes traffic; a failure aborts the
release and the old deployment keeps serving. **This migration is the proving run.** One
caveat I will verify rather than assume: the pre-deploy command must use a **non-pooled**
`DIRECT_URL`, because `prisma migrate deploy` hangs forever on Neon's pooled endpoint
(`d0dba20`, 3 July). If `DIRECT_URL` is not set in Railway's variables, this silently
becomes the 3 July hang — I will check before enabling it.

---

## 9. Deploy-skew tolerance

Vercel lands in ~30 s, Railway in 28 s–30 min, so the new UI will talk to the old API.
Rules for this change: the slip endpoint returning 404 renders "slip not available yet",
never a crash; `GET /inwards` failing degrades the Reviewer screen to an empty state;
Store's dashboard slip card is absent, not broken, when the field is missing. Precedent
and reasoning: `6883b6d`.

---

## 10. Open questions — I need answers before building

**Q1 — Does Store lose receiving?** Item 1 gives scan-to-receive to Gate; item 2 says
Store loses exactly four things and receiving is not among them. Today
`/receiving/*` is `[ADMIN, OPERATOR]`. *My proposal:* receiving is inward, so it moves to
Gate and Store comes off it — but this is your call, and if Store keeps it you have two
actors receiving the same truck.

**Q2 — Does Store keep `POST /purchase-orders/:poId/pack-weight`?** It is the *only* way
to unblock a unit that arrived with no usable pack weight, and `GET /materials/needs-weight`
— Store's queue for exactly that problem — stays with Store. If Store loses it, Store can
see blocked units but cannot unblock them; if Store keeps it, Store retains one write on a
PO-scoped route. *My proposal:* Store keeps it, and I rename the route away from the
`purchase-orders/` prefix so the boundary reads honestly.

**Q3 — Where does SUPERVISOR stand?** The brief never mentions it. Today Supervisor reads
invoices *and downloads the invoice file*. *My proposal:* Supervisor loses the invoice
file and the PO reads, matching Store — otherwise "Store cannot see prices" is defeated by
logging in as Supervisor.

**Q4 — Can the Users tab mint GATE and REVIEWER logins?** `CREATABLE_ROLES` is currently
`[PRODUCTION_HEAD, DISPATCH]`. *My proposal:* extend it to include both, so the owner is
not dependent on a developer to add a second gate guard — with the same protections
(server-composed domain, no escalation, seeded/default-password labelling). **And on
lockout:** Gate must be added to the cannot-deactivate set. If Gate is deactivated with no
second gate login, **no truck can be received at all** — a worse outage than the Store/Admin
lockout the rule already protects against.

**Q5 — Is HSN a commercial secret?** `hsnCode` is a tax classification code carried onto
`Material` and into the label CSV. It is not a price, but it is tax metadata and the brief
forbids "HSN-linked totals". *My proposal:* HSN stays visible to Store (it is on the
material, not the invoice, and removing it would change label exports the factory already
uses) — but it is **excluded from the slip**.

**Q6 — Reviewer home route.** Reviewer has no dashboard. *My proposal:* `/review-inwards`
as both home and only screen, so `resolveBack` has a valid role home and back-navigation
can never resolve anywhere priced.

---

## 11. What I will report at the end

Per standing practice: what was verified against the running production system versus only
in tests — with the step-6 live gate-flow run stated explicitly, because §7 makes it the
precondition for the flip.
