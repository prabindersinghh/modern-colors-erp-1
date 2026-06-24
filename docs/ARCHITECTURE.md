# Modern Colours — Phase 1 Architecture Map (LIVING DOCUMENT)

> **Purpose:** This is the single source of truth for the system's shape. It must
> stay alive across coding sessions. **Whenever a structural decision, module
> boundary, data model, or contract changes, update THIS file in the same change.**
> Read this first at the start of any new session before touching code.
>
> Companion file: [`PROGRESS.md`](./PROGRESS.md) tracks what has actually been built.
> Source of truth for scope: [`Modern_Colours_PRD_Phase1_Final (1).docx`](./Modern_Colours_PRD_Phase1_Final%20(1).docx) (PRD v3.0, FINAL).

---

## 1. What this system is

Digitizes raw-material inward at a paint factory. The flow:

```
Operator uploads PO bill (PDF/img/scan)
   → Claude API extracts structured fields (PO#, supplier, materials, qty, unit, batch, date)
   → Each material validated against Master Catalogue (exact / similar / no-match)
   → Operator REVIEWS & CORRECTS, then EXPLICITLY CONFIRMS  (HARD GATE — nothing saved before this)
   → Backend registers ONE material record PER PHYSICAL UNIT, each with unique ID MC-000001…
   → ONE QR code per physical unit + printable label sheets (PDF)
   → Truck arrives → operator SCANS each QR → manually enters ONE confirmed weight
   → Unit reaches "Ready for Production"
   → Live dashboard reflects everything
```

## 2. Scope guardrails (DO NOT CROSS)

**Phase 1 ONLY.** Explicitly OUT OF SCOPE (these are Phase 2 — building them is scope creep):
- Production work orders, batch scheduling, recipe/BOM.
- Production consumption (scan → scale → pour → Initial−Final → auto inventory deduction).
- Live weighing-machine hardware integration (USB/RS-232/Ethernet/WiFi/BT/SDK). **Phase 1 weight is a single MANUAL entry only.**
- Inventory forecasting, demand prediction, AI optimization.
- Worker lot/task views, printable work instructions.

> The pre-existing frontend prototype was modeled on this Phase 2 product
> (Production/Warehouse/consumption). It has been **fully removed from the active app**
> and preserved intact on the **`phase2-draft` git branch** (commit where the prototype
> last existed). Nothing Phase 2 — pages, types, routes, services, components — is reachable,
> imported, or wired into the Phase 1 codebase. When Phase 2 starts, branch from `phase2-draft`.
> Do NOT re-add Phase 2 code to `phase-1`.

## 3. Non-negotiable invariants (enforced + tested)

| # | Invariant | Where enforced |
|---|-----------|----------------|
| I1 | **No auto-save of AI output.** Materials persist ONLY after explicit operator confirm. | `purchase-order` confirm endpoint + service; integration test |
| I2 | **Claude API key encrypted at rest**, never returned in full to frontend (masked `sk-ant-…xxxx`). | `settings` module crypto; unit test on masking |
| I3 | **QR is 1:1 with physical units**, not line items. 50 bags ⇒ 50 IDs + 50 QRs. | `material` registration service; test asserts count |
| I4 | **Audit log is append-only.** Corrections = new entries referencing the original; never overwrite/delete. | `audit` module; DB has no update/delete path for AuditLog |
| I5 | **RBAC enforced server-side** on every protected endpoint (not just UI hiding). | Nest `RolesGuard` + `@Roles()`; e2e tests per role |
| I6 | **Master Catalogue never gates operations.** No-match materials can still be confirmed. | validation returns status only; confirm has no catalogue hard-block |
| I7 | **Claude failure ⇒ manual fallback**, operator never blocked. | extraction service returns fallback flag; PO can be confirmed from manual entry |
| I8 | **Unique IDs are sequential, zero-padded** `MC-000001`. | DB sequence/counter in `material` service; concurrency-safe |
| I9 | **Scans/weights tolerate offline**, queue locally, sync on reconnect — no silent data loss. | frontend IndexedDB queue + idempotent backend endpoints |

## 4. Tech stack (locked)

**Monorepo root** = `d:/modern-colors-erp`

```
modern-colors-erp/
├── frontend/          Vite 6 + React 19 + TS + Tailwind 3 + shadcn/ui + react-router 7 + recharts
├── backend/           NestJS + TypeScript + Prisma + PostgreSQL  (built fresh)
├── docs/              ARCHITECTURE.md (this) + PROGRESS.md + PRD + phase2 notes
└── README.md
```

> **DATABASE = Neon (hosted Postgres, free tier). NOT Docker.** The client does not have
> Docker installed and will not install it for this project. There is intentionally **no
> `docker-compose.yml`** and no local-Postgres setup. `DATABASE_URL` points at the Neon
> connection string (keep `sslmode=require`). **Do not reintroduce a Docker-based Postgres
> in any future session.**

- **Backend:** NestJS + TS, **Neon** PostgreSQL + Prisma ORM, JWT auth + RBAC, REST (no GraphQL).
- **AI:** Anthropic official SDK `@anthropic-ai/sdk` (no hand-rolled HTTP).
- **QR:** `qrcode` for generation, `pdf-lib` for printable label sheets.
- **File storage:** **Cloudflare R2** (S3 API) in prod, abstracted behind `StorageService`.
  Local dev uses a **disk fallback driver** when R2 creds are absent, so dev is never blocked.
- **Frontend:** kept on existing Vite stack (NOT migrated to Next.js — would violate the
  "don't introduce a second UI framework" rule). Design system / layout / shadcn primitives reused.

## 5. Backend module map

NestJS modules (each = folder under `backend/src/modules/`):

| Module | Responsibility | Key endpoints (REST) |
|--------|----------------|----------------------|
| `auth` | JWT login, token issue/verify, password hashing | `POST /auth/login`, `GET /auth/me` |
| `users` | User CRUD (Admin), role assignment, seed admin | `GET/POST/PATCH /users` |
| `catalogue` | Master Catalogue import (Excel/CSV/PDF) + CRUD + match lookup | `POST /catalogue/import`, `GET /catalogue`, `GET /catalogue/match?q=` |
| `settings` | Claude API key: encrypt/store/mask/validate/remove (Admin only) | `GET /settings/api-key`, `PUT /settings/api-key`, `DELETE /settings/api-key` |
| `purchase-order` | PO upload, lifecycle, history, **confirm gate** | `POST /purchase-orders` (upload), `POST /:id/confirm`, `GET /purchase-orders` |
| `ai-extraction` | Call Claude via stored key, parse JSON, run catalogue validation, fallback flag | invoked by purchase-order; `POST /:id/extract` |
| `material` | Register 1 record/unit, unique ID gen, status transitions | `GET /materials`, `GET /materials/:id` |
| `qr` | Generate QR per unit, build printable label PDF, decode/scan resolve | `GET /materials/:id/qr`, `POST /qr/labels` (PDF), `POST /qr/scan` |
| `receiving` | Scan resolve + manual weight entry + status → Weighed → Ready | `POST /receiving/scan`, `POST /receiving/:unitId/weight` |
| `dashboard` | Aggregated metrics, supplier/material stats, search & filters | `GET /dashboard/summary`, `GET /dashboard/search` |
| `audit` | Append-only log writer + reader (Supervisor/Admin) | `GET /audit` (read-only) |

Cross-cutting: `common/` (guards, decorators, interceptors, crypto util), `prisma/` (PrismaService).

## 6. Data model (Prisma) — canonical entities

> Full schema lives in `backend/prisma/schema.prisma`. This is the conceptual map.

- **User** `{ id, email, passwordHash, name, role(enum ADMIN|SUPERVISOR|OPERATOR), active, createdAt }`
- **MasterCatalogueItem** `{ id, materialName, sku(unique), category, unit, standardPackaging, metadata Json?, createdAt }`
- **PurchaseOrder** `{ id, poNumber?, supplier?, fileKey(storage), status(POStatus), source(AI|MANUAL), extractedJson Json?, deliveryDate?, uploadedById, confirmedById?, confirmedAt?, createdAt }`
  - `POStatus`: `PO_UPLOADED → AI_EXTRACTED → OPERATOR_VERIFIED → REGISTERED`
- **POLineItem** (draft, pre-confirm working set) `{ id, poId, materialName, sku?, quantity, unit, batchNumber?, matchType(EXACT|SIMILAR|NONE), matchedCatalogueId?, edited }`
- **Material** (ONE per physical unit) `{ id, uniqueId(unique, "MC-000001"), poId, materialName, sku?, supplier?, batchNumber?, unit, status(MaterialStatus), receivedWeight?, weighedById?, weighedAt?, createdAt }`
  - `MaterialStatus`: `REGISTERED → ARRIVED → SCANNED → WEIGHED → READY_FOR_PRODUCTION`
- **QrCode** `{ id, materialId(unique), payload Json (uniqueId, name, sku, supplier, poNumber, batch, date), imageRef, createdAt }`
- **Setting** (singleton-ish, key/value) — Claude key stored here: `{ id, key, valueEncrypted, valueMasked, iv, updatedById, updatedAt }`
- **AuditLog** (APPEND-ONLY) `{ id, entityType, entityId, action, actorId, beforeJson?, afterJson?, correctionOfId?, createdAt }`

> **Status note:** PRD lists a combined lifecycle `PO Uploaded → AI Extracted → Operator Verified →
> Material Registered/QR → Arrived → Scanned/Unloaded → Weighed → Ready for Production`.
> We model it as **PO-level statuses** (first 3 + registered) and **per-unit Material statuses**
> (registered → arrived → scanned → weighed → ready), since post-registration the unit is the
> tracked entity. "Arrived" is contextual; "Ready for Production" is set on weight confirmation.

## 7. Key flows / sequence

**Extraction + confirm (the hard gate):**
1. `POST /purchase-orders` (Operator) → file to storage, PO row `PO_UPLOADED`, audit.
2. `POST /:id/extract` → settings.getDecryptedKey → Claude SDK → JSON → POLineItems with match status → PO `AI_EXTRACTED`. On failure: return `{ fallback: true }`, PO stays `PO_UPLOADED`, operator enters manually.
3. Operator edits line items (working set only — **not** Materials yet).
4. `POST /:id/confirm` → **only now** create N Material rows (N = Σ quantities), unique IDs, QRs; PO `OPERATOR_VERIFIED`→`REGISTERED`; audit each. *(I1)*

**Receiving:**
1. `POST /receiving/scan` `{ uniqueId }` → resolve Material, status `ARRIVED`→`SCANNED`, audit. Idempotent (offline-safe). *(I9)*
2. `POST /receiving/:unitId/weight` `{ weight }` → set receivedWeight, status `WEIGHED`→`READY_FOR_PRODUCTION`, audit. *(I9)*

## 8. Conventions

- REST, JSON, `kebab` URL segments. All write endpoints emit an AuditLog entry.
- Auth: `Authorization: Bearer <jwt>`. Guards: `JwtAuthGuard` + `RolesGuard`.
- Errors: Nest exception filters → `{ statusCode, message, code }`.
- Tests: critical invariants (I1–I9) get tests before/with implementation (TDD where it counts).
- Frontend talks to backend via `frontend/src/services/api.ts` (base URL from `VITE_API_URL`).
- Env: every secret via env var; `.env.example` committed, `.env` ignored.

## 9. Open / deferred decisions

- Exact catalogue import column mapping — to confirm against client's real file; importer is column-tolerant with a mapping step.
- QR label physical dimensions — default to a printable A4 grid of labels; adjustable.
- "Ready for Production" = auto on weigh (chosen default) vs. separate confirm tap — using auto for now.

---
_Last updated: 2026-06-24 — initial architecture established post-discovery._
