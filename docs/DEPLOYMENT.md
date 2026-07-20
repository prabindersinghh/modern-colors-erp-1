# Deployment Guide — Modern Colours (managed cloud)

> **Document version:** 2.0  
> **Last updated:** 2026-07-21  
> **Describes:** The live managed-cloud deployment: Vercel + Railway + Neon + Cloudflare R2.  
> **Earlier versions:** see [`docs/archive/`](./archive/) · full history in [`CHANGELOG.md`](./CHANGELOG.md)


> **For an on-premise factory handoff, use [`SELF-HOSTING.md`](./SELF-HOSTING.md)** — everything on one
> server the client owns (local PostgreSQL + local disk storage, no cloud accounts).
> This file describes the **managed-cloud** setup, which is what is **currently live**.

**Live since 2026-07-03.**

Production topology:

```
Browser ──HTTPS──▶ Vercel   (frontend: Vite/React SPA — Ambreen's Vercel account)
                      │  calls VITE_API_URL
                      ▼
                   Railway  (backend: NestJS API, always-on container, Singapore)
                      ├── Neon             (PostgreSQL 18.4, Singapore)
                      └── Cloudflare R2    (PO docs + QR label PDFs)
                                  └── Claude API (key entered in Settings)
```

Both the backend and the database are in **Singapore** — closest region to the factory, and keeping
them in the same region keeps query latency low.

**Auto-deploy:** pushing to `main` redeploys both ends. Vercel builds the frontend; Railway rebuilds
the backend container. There is no manual deploy step for ordinary changes.

Why split hosting: Vercel's serverless functions cap request bodies at ~4.5 MB (multi-MB phone PO
photos would fail) and have an ephemeral filesystem. Running NestJS as a normal long-running
container on **Railway** avoids both and matches how the app is built.

> **Note on `render.yaml`:** the repo still contains a Render blueprint from an earlier evaluation.
> The live backend runs on **Railway** from [`backend/Dockerfile`](../backend/Dockerfile). Treat the
> Dockerfile as the source of truth; `render.yaml` is a leftover alternative, not what is deployed.

---

## 1. Cloudflare R2 (file storage)

1. Cloudflare dashboard → **R2** → create a bucket, e.g. `modern-colours`.
2. **R2 → Manage API Tokens** → create a token with **Object Read & Write** for the bucket.
3. Note these values for the backend env:
   - `R2_BUCKET` = the bucket name
   - `R2_ACCESS_KEY_ID` / `R2_SECRET_ACCESS_KEY` = the token credentials
   - `R2_ACCOUNT_ID` = your Cloudflare account ID
   - `R2_ENDPOINT` = `https://<R2_ACCOUNT_ID>.r2.cloudflarestorage.com`

> The app uses R2 when `STORAGE_DRIVER=r2` and the R2 vars are set; otherwise it falls back to
> local disk (dev only). Production **must** use R2.

## 2. Neon (database) — two URLs, and why

Neon gives you two connection strings, and this app needs **both**:

| Variable | Which Neon host | Used for |
|---|---|---|
| `DATABASE_URL` | the **pooled** host (`...-pooler...`) | the running app — many short-lived connections |
| `DIRECT_URL` | the **direct**, non-pooled host | `prisma migrate` only |

Both need `sslmode=require`.

> ⚠️ **This is not optional.** Migrations take Postgres **advisory locks**, and PgBouncer (which fronts
> the pooled endpoint) does not support them — running `prisma migrate deploy` against the pooled URL
> **hangs indefinitely** rather than failing fast. This was hit during the go-live. Prisma is configured
> with `directUrl = env("DIRECT_URL")` in [`schema.prisma`](../backend/prisma/schema.prisma) precisely
> so migrations route around the pooler.

**Migrations are deliberately NOT run by the container start command.** Run them yourself against the
direct URL when a release includes a schema change:

```bash
cd backend
DATABASE_URL="$DIRECT_URL" npx prisma migrate deploy
```

## 3. Backend → Railway

1. Generate two secrets locally:
   ```bash
   openssl rand -hex 32   # JWT_SECRET     (≥32 chars)
   openssl rand -hex 32   # ENCRYPTION_KEY (exactly 64 hex chars)
   ```
   > ⚠️ Keep `ENCRYPTION_KEY` **stable forever** — it decrypts the stored Claude API key. Changing it
   > makes the saved key unreadable (just re-enter the key in Settings if you ever rotate it).
2. Railway → **New Project → Deploy from GitHub repo** → select this repo.
   - **Root directory:** `backend`
   - **Builder:** Dockerfile (`backend/Dockerfile`). Nixpacks was tried first and failed with a
     cache-mount `EBUSY`; the Dockerfile pins Node 20 and builds deterministically.
   - **Region:** Singapore.
3. Set the environment variables (see the reference table below).

   > ⚠️ **Stage the variables *before* the deploy that reads them.** Railway starts the container as
   > soon as the build finishes; the app **fails fast** on missing or placeholder secrets by design, so
   > a deploy triggered before the vars exist will crash-loop and look like a build problem when it is
   > only a missing value. Set every variable first, then deploy.
4. Deploy. Health check: `GET /api/health`. The API base is the Railway public URL + `/api`.
5. Run migrations + seed once, from your machine, against the **direct** Neon URL:
   ```bash
   cd backend
   DATABASE_URL="$DIRECT_URL" npx prisma migrate deploy
   DATABASE_URL="$DIRECT_URL" npm run seed     # admin — idempotent
   ```
   The Phase 2 and Phase 3 logins have their own idempotent seeds
   ([`seed-phase2-roles.ts`](../backend/prisma/seed-phase2-roles.ts) — oversight + the three
   department heads; [`seed-phase3-dispatch.ts`](../backend/prisma/seed-phase3-dispatch.ts) —
   dispatch). Run them the same way, against the direct URL.

### IPv6 note

Railway's healthchecks and private network are **IPv6-only**, while its public edge is IPv4. The app
binds dual-stack `'::'` (which serves both) and falls back to `0.0.0.0` if IPv6 is unavailable — see
[`backend/src/main.ts`](../backend/src/main.ts). A backend that binds `0.0.0.0` only will pass builds
but fail Railway's healthcheck, which is easy to misread as a crash.

## 4. Frontend → Vercel

1. Vercel → **Add New → Project** → import this repo. *(The live project sits in Ambreen's Vercel
   account — deploy from there, not a personal one, or the URL changes and CORS breaks.)*
2. **Root Directory: `frontend`** (Vercel auto-detects Vite from `vercel.json`).
3. Add an environment variable:
   - `VITE_API_URL` = `https://<your-railway-service>.up.railway.app/api`
   > `VITE_*` values are **baked in at build time**, not read at runtime. Changing this requires a
   > **redeploy**, not just a restart.
4. Deploy. Note the app URL.

## 5. Connect the two (CORS)

Set `CORS_ORIGIN` on **Railway** to the exact Vercel origin from step 4 and redeploy the backend.
Comma-separate to allow several (e.g. a custom domain, or a preview URL you actually need).

### The mobile-data incident — read this before debugging a "site is down" report

Shortly after go-live the app worked on office WiFi but appeared broken for users on **Jio mobile
data**. It presented as a CORS error in the browser console, which sent the first round of debugging
after the CORS config — where the bug was not.

What actually mattered:

- **`CORS_ORIGIN` must be the exact origin** — scheme + host, **no trailing slash**, no path. A
  trailing slash makes the string comparison fail and every request is rejected.
- **A Vercel preview/branch deploy has a different origin** than production. If a user is on a preview
  URL that isn't in `CORS_ORIGIN`, only they see the failure — which looks like "it's broken on my
  phone" rather than a config gap.
- **A blocked or failed preflight looks identical to a CORS misconfiguration** in the console. On a
  flaky mobile connection the `OPTIONS` request can fail on its own; the browser still reports CORS.

Resilience fixes made in response: the API client retries transient network failures instead of
surfacing the first blip as a hard error, and the origin list is explicit rather than wildcarded, so a
missing origin is a visible config value rather than silent permissiveness.

**Debug order when someone reports the live site failing:** confirm which URL they are on (production
or a preview) → check `GET /api/health` directly from that device → only then look at `CORS_ORIGIN`.

## 6. First run

1. Open the Vercel URL → log in with `SEED_ADMIN_EMAIL` / `SEED_ADMIN_PASSWORD`.
2. **Change the admin password** (or create a new admin and disable the seed one). The Phase 2/3 seed
   logins default to `ChangeMe123!` — that default is published in
   [`PHASE2_UAT.md`](./PHASE2_UAT.md), so **every one of them must be changed before real use**.
3. **Settings** → paste the factory's **Claude API key** (validated, encrypted at rest).
4. **Master Catalogue** → import the SKU CSV/Excel.
5. Run a PO end-to-end (camera or file → review → confirm → labels → scan → weigh), then a request →
   issue → batch → output → dispatch pass.

---

## Environment variable reference

**Backend (Railway)**

| Variable | Required | Notes |
|---|---|---|
| `DATABASE_URL` | ✅ | Neon **pooled** string (`...-pooler...`, `sslmode=require`) |
| `DIRECT_URL` | ✅ | Neon **direct** string — migrations only; the pooler hangs on advisory locks |
| `JWT_SECRET` | ✅ | ≥32 chars; boot fails if weak/placeholder |
| `ENCRYPTION_KEY` | ✅ | 64 hex chars; **never change** once keys are stored — see [HANDOVER.md](./HANDOVER.md) for why a change is unrecoverable |
| `CORS_ORIGIN` | ✅ | exact Vercel origin(s), comma-separated, **no trailing slash** |
| `SEED_ADMIN_EMAIL` / `SEED_ADMIN_PASSWORD` | ✅ | initial admin (seeded once) |
| `STORAGE_DRIVER` | ✅ | `r2` in production |
| `R2_ACCOUNT_ID` / `R2_ACCESS_KEY_ID` / `R2_SECRET_ACCESS_KEY` / `R2_BUCKET` / `R2_ENDPOINT` | ✅ | Cloudflare R2 |
| `SEED_PHASE2_PASSWORD` | – | overrides the `ChangeMe123!` default for the Phase 2 seed logins (oversight + the three department heads) |
| `SEED_PHASE3_PASSWORD` | – | overrides the `ChangeMe123!` default for the Phase 3 `dispatch` login |
| `JWT_EXPIRES_IN` | – | default `12h` |
| `CLAUDE_MODEL` | – | default `claude-opus-4-8` |
| `PORT` | – | injected by Railway |

**Frontend (Vercel)**

| Variable | Required | Notes |
|---|---|---|
| `VITE_API_URL` | ✅ | full Railway API URL incl. `/api`; baked in at **build** time |

---

## Notes & options
- **Custom domain:** add it in Vercel, then append it to `CORS_ORIGIN` on Railway and redeploy.
- **Phone camera:** works automatically in production — Vercel serves HTTPS, which satisfies the
  browser's secure-context requirement for `getUserMedia`. For LAN testing during development, set
  `VITE_HTTPS=true` so the dev server also serves a secure context.
- **Rotating the seed passwords** before go-live is not optional — the defaults are published in the
  UAT script.
- **Hardening to consider** (not enabled): login rate-limiting (`@nestjs/throttler`).

---

_Last updated: 2026-07-20 — reflects the live Railway deployment._
