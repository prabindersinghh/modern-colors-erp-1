# Self-Hosting Guide — Modern Colours (on-premise factory server)

> **Document version:** 1.0  
> **Last updated:** 2026-07-21  
> **Describes:** Alternative on-premise deployment. NOT what is currently live.  
> **Earlier versions:** see [`docs/archive/`](./archive/) · full history in [`CHANGELOG.md`](./CHANGELOG.md)


This is the **recommended handoff path**: run the entire platform on one server the factory owns and
controls, on the local network. No cloud accounts required. The same codebase supports this with only
environment configuration — **local PostgreSQL** instead of Neon, and **local disk storage** instead of
Cloudflare R2 (no code changes).

> A cloud alternative (Vercel + Render + Neon + R2) is documented separately in
> [`DEPLOYMENT.md`](./DEPLOYMENT.md) if the client ever prefers managed hosting.

```
Factory LAN
  └─ One server (Linux or Windows)
       ├─ Nginx (HTTPS)  ── serves the built frontend + proxies /api → backend
       ├─ NestJS API     ── node (kept alive by systemd / pm2 / NSSM)
       ├─ PostgreSQL     ── local database
       └─ ./storage/     ── PO documents + QR label PDFs (backed up)
```

Phones/tablets/PCs on the same Wi‑Fi open `https://<server-name>/` in a browser.

---

## 0. Prerequisites (install once on the server)
- **Node.js 20 LTS+**
- **PostgreSQL 14+**
- **Nginx** (or IIS on Windows) as the HTTPS reverse proxy
- A process manager: **systemd** (Linux) / **pm2** or **NSSM** (Windows)

## 1. Database (local PostgreSQL)
```sql
CREATE DATABASE modern_colours;
CREATE USER mc_app WITH PASSWORD 'a-strong-db-password';
GRANT ALL PRIVILEGES ON DATABASE modern_colours TO mc_app;
```
`DATABASE_URL` = `postgresql://mc_app:a-strong-db-password@localhost:5432/modern_colours?schema=public`

## 2. Backend (NestJS API)
```bash
cd backend
cp .env.example .env          # then edit .env (see the table below)
npm ci
npx prisma migrate deploy     # create the schema
npm run seed                  # create the initial admin (idempotent)
npm run build                 # compile to dist/
npm run start:prod            # runs node dist/main.js on PORT (default 3000)
```

**`backend/.env` for on‑prem:**

| Variable | Value |
|---|---|
| `DATABASE_URL` | the local Postgres URL from step 1 |
| `PORT` | `3000` |
| `JWT_SECRET` | `openssl rand -hex 32` (≥32 chars) |
| `ENCRYPTION_KEY` | `openssl rand -hex 32` (exactly 64 hex chars) — **never change once keys are stored** |
| `JWT_EXPIRES_IN` | `12h` |
| `CORS_ORIGIN` | `https://<server-name>` (same origin as the site) |
| `SEED_ADMIN_EMAIL` / `SEED_ADMIN_PASSWORD` / `SEED_ADMIN_NAME` | initial admin |
| `STORAGE_DRIVER` | `disk` |
| `CLAUDE_MODEL` | `claude-opus-4-8` |

> With `STORAGE_DRIVER=disk`, uploaded PO files + QR label PDFs are written to `backend/.storage/`.
> Put that folder on a **backed‑up** volume (see §6). R2 vars are not needed on‑prem.

**Keep it running** — example systemd unit (`/etc/systemd/system/modern-colours-api.service`):
```ini
[Unit]
Description=Modern Colours API
After=network.target postgresql.service

[Service]
WorkingDirectory=/opt/modern-colors-erp/backend
ExecStart=/usr/bin/node dist/main.js
EnvironmentFile=/opt/modern-colors-erp/backend/.env
Restart=always
User=modern
[Install]
WantedBy=multi-user.target
```
`sudo systemctl enable --now modern-colours-api`
(Windows: run `node dist/main.js` as a service via **NSSM**, or use **pm2** + `pm2 startup`.)

## 3. Frontend (static build)
```bash
cd frontend
# VITE_API_URL="/api" (default) — served same-origin behind Nginx, so no CORS.
npm ci
npm run build                 # outputs static files to frontend/dist/
```
Copy `frontend/dist/` to where Nginx serves it (e.g. `/var/www/modern-colours`).

## 4. Nginx — HTTPS + serve frontend + proxy /api

**The camera (QR scan + PO photo) requires HTTPS** on any non‑localhost address. Use a TLS certificate:
an internal CA / company cert if available, otherwise a self‑signed cert (browsers show a one‑time
warning that operators accept).

```nginx
server {
    listen 443 ssl;
    server_name modern-colours.factory.local;      # your server hostname

    ssl_certificate     /etc/ssl/modern-colours.crt;
    ssl_certificate_key /etc/ssl/modern-colours.key;

    client_max_body_size 30m;                        # allow full-res PO photos

    root /var/www/modern-colours;                    # the frontend/dist you copied
    index index.html;

    location /api/ {
        proxy_pass http://127.0.0.1:3000;            # the NestJS backend
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-For $remote_addr;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    location / {                                     # SPA client-side routing
        try_files $uri /index.html;
    }
}
# Optional: redirect http→https
server { listen 80; server_name modern-colours.factory.local; return 301 https://$host$request_uri; }
```
Self‑signed cert (if no internal CA):
```bash
openssl req -x509 -newkey rsa:2048 -nodes -days 825 \
  -keyout /etc/ssl/modern-colours.key -out /etc/ssl/modern-colours.crt \
  -subj "/CN=modern-colours.factory.local"
```

## 5. First run
1. Open `https://<server-name>/` on a device on the LAN (accept the cert warning if self‑signed).
2. Log in with `SEED_ADMIN_EMAIL` / `SEED_ADMIN_PASSWORD`, then **change the admin password**.
3. **Settings** → paste the factory's **Claude API key** (validated, encrypted at rest).
4. **Master Catalogue** → import the SKU CSV/Excel.
5. Run a PO end‑to‑end: PO Upload (camera or file) → Review & Confirm → QR Labels (print) → Receive Stock.

## 6. Backups & maintenance
- **Database:** schedule `pg_dump modern_colours > backup-$(date +%F).sql` (daily).
- **Files:** back up `backend/.storage/` (contains PO documents + generated labels).
- **Secrets:** keep `backend/.env` safe; **`ENCRYPTION_KEY` must never change** or the stored Claude key
  becomes unreadable (just re‑enter it in Settings if you must rotate).
- **Updates:** `git pull` → `cd backend && npm ci && npx prisma migrate deploy && npm run build && systemctl restart modern-colours-api` → `cd frontend && npm ci && npm run build` → copy `dist/`.

## 7. Optional hardening
- Restrict access to the factory LAN / VPN (the app has no public exposure by default).
- Consider login rate‑limiting (`@nestjs/throttler`) before wider rollout.
- Use a proper internal‑CA certificate so no browser warning appears on operator devices.
