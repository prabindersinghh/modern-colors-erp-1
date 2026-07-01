# Deployment Guide — Modern Colours Phase 1 (cloud option)

> **For the factory handoff, use [`SELF-HOSTING.md`](./SELF-HOSTING.md)** — run everything on one
> on‑premise server the client owns (local PostgreSQL + local disk storage, no cloud accounts).
> This file below is the optional **managed‑cloud** alternative (Vercel + Render + Neon + R2).

Production topology:

```
Browser ──HTTPS──▶ Vercel  (frontend: Vite/React SPA)
                      │  calls VITE_API_URL
                      ▼
                   Render  (backend: NestJS API, always-on)
                      ├── Neon            (PostgreSQL)
                      └── Cloudflare R2    (PO docs + QR label PDFs)
                                  └── Claude API (key entered in Settings)
```

Why split hosting: Vercel's serverless functions cap request bodies at ~4.5 MB (multi‑MB phone
PO photos would fail) and have an ephemeral filesystem. Running NestJS as a normal long‑running
service on **Render** avoids both and matches how the app is built.

The repo already contains the config: [`frontend/vercel.json`](../frontend/vercel.json) and
[`render.yaml`](../render.yaml).

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

## 2. Neon (database)

Use your existing Neon project (or create one). Copy the **pooled** connection string
(`...-pooler...`, `sslmode=require`) — this becomes `DATABASE_URL`. Migrations run automatically on
each Render deploy.

## 3. Backend → Render

1. Generate two secrets locally:
   ```bash
   openssl rand -hex 32   # JWT_SECRET     (≥32 chars)
   openssl rand -hex 32   # ENCRYPTION_KEY (exactly 64 hex chars)
   ```
   > ⚠️ Keep `ENCRYPTION_KEY` **stable forever** — it decrypts the stored Claude API key. Changing it
   > makes the saved key unreadable (just re‑enter the key in Settings if you ever rotate it).
2. Render → **New → Blueprint** → connect this GitHub repo. Render reads `render.yaml`
   (service `modern-colours-api`, root `backend/`).
3. Set the `sync: false` env vars in the Render dashboard:

   | Variable | Value |
   |---|---|
   | `DATABASE_URL` | Neon pooled string (`sslmode=require`) |
   | `JWT_SECRET` | the 32‑byte hex from step 1 |
   | `ENCRYPTION_KEY` | the 64‑hex‑char value from step 1 |
   | `CORS_ORIGIN` | your Vercel URL (set after step 4), e.g. `https://modern-colours.vercel.app` |
   | `SEED_ADMIN_EMAIL` | e.g. `admin@moderncolours.com` |
   | `SEED_ADMIN_PASSWORD` | a strong password (change after first login) |
   | `R2_ACCOUNT_ID` / `R2_ACCESS_KEY_ID` / `R2_SECRET_ACCESS_KEY` / `R2_BUCKET` / `R2_ENDPOINT` | from step 1 |

   (`NODE_ENV`, `JWT_EXPIRES_IN`, `STORAGE_DRIVER=r2`, `CLAUDE_MODEL`, `SEED_ADMIN_NAME` are preset in `render.yaml`.)
4. Deploy. The build runs `prisma migrate deploy` (schema) + `npm run seed` (creates the admin once,
   idempotent) + `nest build`. Note the service URL, e.g. `https://modern-colours-api.onrender.com`.
   The API base is that URL + `/api`. Health check: `GET /api/health`.

> Free tier sleeps after ~15 min idle; the first request cold‑starts (the API retries the DB connect
> on boot, so this is handled). Upgrade the plan to keep it warm for production.

## 4. Frontend → Vercel

1. Vercel → **Add New → Project** → import this repo.
2. **Root Directory: `frontend`** (Vercel auto‑detects Vite from `vercel.json`).
3. Add an environment variable:
   - `VITE_API_URL` = `https://<your-render-service>.onrender.com/api`
4. Deploy. Note the app URL, e.g. `https://modern-colours.vercel.app`.

## 5. Connect the two (CORS)

Set `CORS_ORIGIN` on **Render** to the exact Vercel URL from step 4 (comma‑separate multiple, e.g.
to also allow a custom domain) and redeploy the backend. Both ends are HTTPS, so the camera works
and there's no mixed‑content issue.

## 6. First run

1. Open the Vercel URL → log in with `SEED_ADMIN_EMAIL` / `SEED_ADMIN_PASSWORD`.
2. **Change the admin password** (or create a new admin and disable the seed one).
3. **Settings** → paste the factory's **Claude API key** (validated, encrypted at rest).
4. **Master Catalogue** → import the SKU CSV/Excel.
5. Run a PO end‑to‑end (camera or file → review → confirm → labels → scan → weigh).

---

## Environment variable reference

**Backend (Render)**

| Variable | Required | Notes |
|---|---|---|
| `DATABASE_URL` | ✅ | Neon Postgres (`sslmode=require`) |
| `JWT_SECRET` | ✅ | ≥32 chars; boot fails if weak/placeholder |
| `ENCRYPTION_KEY` | ✅ | 64 hex chars; **never change** once keys are stored |
| `CORS_ORIGIN` | ✅ | Vercel app origin(s), comma‑separated |
| `SEED_ADMIN_EMAIL` / `SEED_ADMIN_PASSWORD` | ✅ | initial admin (seeded once) |
| `STORAGE_DRIVER` | ✅ | `r2` in production (preset) |
| `R2_ACCOUNT_ID` / `R2_ACCESS_KEY_ID` / `R2_SECRET_ACCESS_KEY` / `R2_BUCKET` / `R2_ENDPOINT` | ✅ | Cloudflare R2 |
| `JWT_EXPIRES_IN` | – | default `12h` (preset) |
| `CLAUDE_MODEL` | – | default `claude-opus-4-8` (preset) |
| `PORT` | – | set automatically by Render |

**Frontend (Vercel)**

| Variable | Required | Notes |
|---|---|---|
| `VITE_API_URL` | ✅ | full Render API URL incl. `/api` |

---

## Notes & options
- **Custom domain:** add it in Vercel, then append it to `CORS_ORIGIN` on Render.
- **Phone camera:** works automatically in production — Vercel serves HTTPS, which satisfies the
  browser's secure‑context requirement for `getUserMedia`.
- **Rotating the seed admin password** before go‑live is strongly recommended.
- **Hardening to consider** (not enabled): login rate‑limiting (`@nestjs/throttler`).
