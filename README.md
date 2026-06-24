# Modern Colours — Factory Material Inward Digitization Platform (Phase 1)

AI-powered PO extraction, QR tracking & receiving-weight confirmation for a paint
manufacturing facility. Operators upload a Purchase Order, Claude extracts the
materials, the operator reviews & confirms, the system mints one QR-coded unit per
physical item, and each unit is scanned and weighed on arrival until it's
**Ready for Production** — all reflected on a live dashboard.

> **Start here for context:** [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) (the living map) ·
> [`docs/PROGRESS.md`](docs/PROGRESS.md) (what's built so far) ·
> ![architecture](docs/architecture.png)

## Monorepo layout

```
frontend/   Vite + React 19 + TS + Tailwind + shadcn/ui   (UI)
backend/    NestJS + Prisma + PostgreSQL                   (API)
docs/       Architecture map, progress log, PRD
docker-compose.yml   Local Postgres (+ services)
```

## Quick start (local dev)

```bash
# 1. Start Postgres
docker compose up -d

# 2. Backend
cd backend
cp .env.example .env          # fill in secrets
npm install
npx prisma migrate dev
npm run seed                  # seeds an initial Admin user
npm run start:dev             # http://localhost:3000

# 3. Frontend
cd ../frontend
npm install
npm run dev                   # http://localhost:5173
```

## Scope

**Phase 1 only.** Production consumption, weighing-machine hardware integration, and
inventory forecasting are **Phase 2 / out of scope** — see the guardrails in
[`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md).
