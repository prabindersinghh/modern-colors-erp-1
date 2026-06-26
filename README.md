<p align="center">
  <img src="docs/_banner.png" alt="Modern Colours — Factory Material Inward Digitization Platform" width="100%" />
</p>

<h1 align="center">Modern Colours — Material Inward Digitization Platform</h1>

<p align="center">
  AI-powered Purchase-Order extraction, per-unit QR tracking, and receiving-weight confirmation
  for a paint manufacturing facility.
</p>

<p align="center">
  <img alt="Phase" src="https://img.shields.io/badge/Phase-1-3b82f6" />
  <img alt="Backend" src="https://img.shields.io/badge/Backend-NestJS%2011-e0234e" />
  <img alt="Frontend" src="https://img.shields.io/badge/Frontend-React%2019%20%2B%20Vite-646cff" />
  <img alt="DB" src="https://img.shields.io/badge/DB-PostgreSQL%20(Neon)-336791" />
  <img alt="ORM" src="https://img.shields.io/badge/ORM-Prisma%206-2d3748" />
  <img alt="AI" src="https://img.shields.io/badge/AI-Claude%20API-d97757" />
  <img alt="License" src="https://img.shields.io/badge/License-Proprietary-lightgrey" />
</p>

---

## Overview

Modern Colours receives raw materials (pigments, fillers, binders, solvents) against paper Purchase
Orders. This platform digitizes that inward process end-to-end:

> **Operator uploads a PO → Claude extracts the line items → the operator reviews & confirms →
> the system mints one QR-coded unit per physical item → each unit is scanned and weighed on arrival
> until it is _Ready for Production_ — with a live dashboard over everything.**

Nothing the AI extracts is persisted until an operator explicitly confirms it, every state change is
written to an append-only audit log, and the factory's own Claude API key is encrypted at rest and used
server-side only.

<p align="center">
  <img src="docs/architecture.png" alt="Architecture map" width="100%" />
</p>

---

## Features

### Material inward workflow
- **PO upload** — operators upload a Purchase Order (PDF, image, or scan).
- **AI extraction** — the PO is sent to the **Claude API** (using the factory's own stored key) and parsed
  into structured line items: PO number, supplier, material, SKU, quantity, unit, batch, delivery date.
- **Manual fallback** — if extraction fails (bad key, quota, unreadable scan), the operator can enter the
  PO by hand instead of being blocked.
- **Master-catalogue validation** — every extracted material is matched against the catalogue as
  **Exact / Similar / No-match**; matching is advisory and never blocks an entry.
- **Operator review & confirm (hard gate)** — an editable table of Material / SKU / Quantity / Unit /
  Validation status. **Nothing is written to the database until the operator confirms.**
- **Per-unit registration** — on confirm, one material record is created **per physical unit** with a
  sequential, zero-padded unique ID (`MC-000001`, `MC-000002`, …).

### QR & receiving
- **QR generation** — one QR code per physical unit, encoding unique ID, material, SKU, supplier, PO,
  batch, and date.
- **Printable label sheets** — generated as PDF for printing and attaching to each unit.
- **Scan on receiving** — operators scan each unit as it is unloaded; status advances automatically.
- **Manual receiving-weight entry** — a single confirmed weight per unit (a receiving confirmation, not a
  production measurement — no weighing-machine hardware in Phase 1).
- **Offline tolerance** — scans and weight entries queue locally and sync on reconnect, so a dropped
  factory-WiFi connection never loses data.

### Master Catalogue
- One-time **Excel/CSV import** of the factory's ~500–600 SKUs (column-tolerant header mapping).
- Full CRUD with soft-delete; fuzzy match lookup powering AI-extraction validation.
- **New SKUs are addable during daily operations** — when a PO line has no catalogue match, an operator
  can add the material (with confirmation); a provisional code is generated if no official SKU exists yet.

### Settings, roles & audit
- **Settings (Admin-only)** — the Claude API key is entered, validated against a live API call, **encrypted
  at rest (AES-256-GCM)**, masked in every response, and used server-side only.
- **Role-based access control** — **Admin** (full access incl. users, catalogue, API key), **Supervisor**
  (read-only dashboard, records, audit), **Operator** (upload, review/confirm, QR, scan, weigh). Enforced
  server-side on every endpoint, not just hidden in the UI.
- **Immutable audit trail** — every status change, PO entry, and weight entry is logged with timestamp and
  operator. Corrections are new audited entries that reference the original, never silent overwrites.

### Dashboard
- Live metrics: today's POs, materials received, pending scans/weighing, ready-for-production counts.
- Supplier-wise and material-wise statistics.
- Search & filters by date, PO number, supplier, material name/SKU, and status.

---

## Status lifecycle

```
PO Uploaded → AI Extracted → Operator Verified → Material Registered / QR Generated
   → Arrived → Scanned / Unloaded → Weighed → Ready for Production
```

The first four are **PO-level** statuses; once registered, each **physical unit** is tracked
independently through arrival, scan, weigh, and ready.

---

## Tech stack

| Layer        | Technology |
|--------------|------------|
| Frontend     | Vite 6 · React 19 · TypeScript · Tailwind CSS 3 · shadcn/ui (Radix) · React Router 7 · Recharts |
| Backend      | NestJS 11 · TypeScript · REST · JWT auth + RBAC guards |
| Database     | PostgreSQL (**Neon**, hosted) · Prisma 6 ORM |
| AI           | Claude API via the official `@anthropic-ai/sdk` |
| QR & PDF     | `qrcode` (generation) · `pdf-lib` (printable label sheets) |
| File storage | Cloudflare R2 (S3 API) in production · local-disk fallback for development |
| Security     | `bcryptjs` password hashing · AES-256-GCM secret encryption · fail-fast env validation |

> **No Docker.** The database is Neon (hosted Postgres) — there is intentionally no local-Postgres /
> docker-compose setup.

---

## Monorepo layout

```
modern-colors-erp/
├── frontend/          Vite + React 19 + TS + Tailwind + shadcn/ui  (UI)
│   └── src/
│       ├── components/  ui/ (design system) · common/ · layout/
│       └── pages/       Phase 1 screens
├── backend/           NestJS + Prisma + PostgreSQL  (API)
│   ├── prisma/          schema.prisma · seed.ts · migrations/
│   └── src/
│       ├── common/      guards · decorators · crypto · config (env validation)
│       ├── prisma/      PrismaService
│       └── modules/     auth · users · catalogue · settings · audit
│                        (+ purchase-order · ai-extraction · material · qr ·
│                           receiving · dashboard — added incrementally)
└── docs/              ARCHITECTURE.md · PROGRESS.md · architecture.png · PRD
```

> **Start here for context:** [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) is the living architecture map
> (modules, data model, invariants); [`docs/PROGRESS.md`](docs/PROGRESS.md) is the running build log.

---

## Data model

Eight Prisma models back the platform (full schema: [`backend/prisma/schema.prisma`](backend/prisma/schema.prisma)):

| Model | Purpose |
|-------|---------|
| `User` | Accounts with `ADMIN` / `SUPERVISOR` / `OPERATOR` roles |
| `MasterCatalogueItem` | Factory SKU reference (name, SKU, category, unit, packaging) |
| `PurchaseOrder` | Uploaded PO + lifecycle status + raw extraction JSON |
| `POLineItem` | Editable pre-confirm working set (never auto-promoted to a Material) |
| `Material` | **One row per physical unit**, with unique `MC-…` ID and per-unit status |
| `QrCode` | One QR payload + rendered image per material |
| `Setting` | Encrypted key/value store (the Claude API key lives here) |
| `AuditLog` | Append-only log; corrections reference the original entry |

---

## Non-negotiable invariants

The system is designed around nine guardrails, several backed by automated tests:

| # | Invariant |
|---|-----------|
| I1 | No auto-save of AI output — materials persist only after explicit operator confirm |
| I2 | Claude API key encrypted at rest; never returned in full to the frontend |
| I3 | QR codes are 1:1 with physical units, not line items |
| I4 | Audit log is append-only; corrections reference the original |
| I5 | RBAC enforced server-side on every protected endpoint |
| I6 | Master Catalogue never gates operations; no-match items are still confirmable |
| I7 | Claude failure falls back to manual entry — the operator is never blocked |
| I8 | Unique IDs are sequential and zero-padded (`MC-000001`) |
| I9 | Scans & weight entries tolerate offline, queue locally, and sync on reconnect |

---

## API surface (REST, prefix `/api`)

| Module | Representative endpoints |
|--------|--------------------------|
| `auth` | `POST /auth/login` · `GET /auth/me` |
| `users` | `GET/POST/PATCH/DELETE /users` *(Admin)* |
| `catalogue` | `POST /catalogue/import` *(Admin)* · `GET /catalogue` · `GET /catalogue/match?q=` · `POST /catalogue` *(Admin+Operator)* |
| `settings` | `GET/PUT/DELETE /settings/api-key` *(Admin)* |
| `audit` | `GET /audit` *(Admin/Supervisor)* |

_(purchase-order, material, qr, receiving, and dashboard endpoints are added as those modules land — see the
roadmap below.)_

---

## Getting started

**Prerequisites:** Node.js 20+ and a [Neon](https://neon.tech) Postgres connection string.

```bash
# 1. Backend
cd backend
cp .env.example .env          # paste your Neon DATABASE_URL; set JWT_SECRET, ENCRYPTION_KEY, SEED_ADMIN_*
npm install
npx prisma migrate dev        # applies the schema to Neon
npm run seed                  # creates the initial Admin from SEED_ADMIN_* env vars
npm run start:dev             # http://localhost:3000/api

# 2. Frontend
cd ../frontend
npm install
npm run dev                   # http://localhost:5173
```

Generate strong secrets:

```bash
openssl rand -hex 32          # JWT_SECRET (≥32 chars) and ENCRYPTION_KEY (exactly 64 hex chars)
```

> The backend **refuses to boot** if `JWT_SECRET`, `ENCRYPTION_KEY`, or `DATABASE_URL` are missing or weak
> (fail-fast env validation).

The Vite dev server proxies `/api` to the backend (same-origin — no CORS), so the frontend's
`VITE_API_URL` stays `/api`.

### Testing the camera on a phone

Scan & Weigh (QR) and PO Upload (document photo) use the device camera, which browsers only allow on a
**secure context (HTTPS)**. To test from a phone on the same Wi‑Fi:

```bash
cd frontend
VITE_HTTPS=true npm run dev     # serves HTTPS and binds to the LAN
```

Then on the phone open `https://<your-computer-LAN-IP>:5173` (the dev server prints the Network URLs on
start). Accept the self‑signed-certificate warning once, and allow camera access when prompted. The `/api`
proxy means the backend is reached through the same HTTPS origin — no extra network config. Use the rear
camera; for PO photos, fill the frame with the document and hold steady for a sharp, high‑resolution capture.

---

## Scripts

**Backend** (`backend/`):

| Script | Description |
|--------|-------------|
| `npm run start:dev` | Run the API in watch mode |
| `npm run build` | Compile to `dist/` |
| `npm run prisma:migrate` | Create & apply a migration |
| `npm run seed` | Seed the initial Admin user |
| `npm test` | Run the Jest unit/spec suite |

**Frontend** (`frontend/`):

| Script | Description |
|--------|-------------|
| `npm run dev` | Vite dev server |
| `npm run build` | Type-check + production build |
| `npm run preview` | Preview the production build |

---

## Testing

Automated tests focus on the non-negotiable invariants:

- `roles.guard.spec.ts` — server-side RBAC (I5)
- `crypto.service.spec.ts` — AES-256-GCM round-trip, unique IV, GCM tamper-detection, masking (I2)
- `match.util.spec.ts` — catalogue matching exact/similar/none, never-throws (I6)

```bash
cd backend && npm test
```

---

## Scope & roadmap

**Phase 1 (this repository):** master catalogue, settings/API-key, PO upload, AI extraction, operator
review/confirm, per-unit registration + QR, scan + manual weight, status lifecycle, dashboard, roles, audit.

**Explicitly out of scope (Phase 2):** production work orders & scheduling, production consumption tracking
(Initial − Final weighing), live weighing-machine hardware integration, inventory forecasting, and
worker-facing task views. The earlier prototype that targeted this scope is preserved on the
`phase2-draft` branch and is **not** wired into the Phase 1 application.

---

<p align="center"><sub>Prepared for Modern Colours · Phase 1 — AI-Powered PO Extraction, QR Tracking &amp; Receiving Weight</sub></p>
