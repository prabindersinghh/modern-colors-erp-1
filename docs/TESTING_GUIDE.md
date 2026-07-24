# Modern Colours ERP — Testing Guide

**System as built, current to commit `8fae4d6` (2026-07-24).** Live at
`https://modern-colors-erp-tau.vercel.app` (frontend) / Railway API + Neon Postgres.

This guide is how you tap through the whole system, login by login, and see what each
role does. It covers everything through the packing stage, the packed-goods (PG) lists,
the Good Receipt Note, Gate-side unit-code minting, and the Oversight total-visibility
sweep.

---

## Passwords — read first

- Every account was seeded with a **placeholder default that MUST BE CHANGED** before real
  use. **No real or current password is written in this guide, or in any doc, log or
  commit** — that is a standing rule.
- Change each password at first login (Admin → User Management, or the account's own
  settings). Write the chosen passwords on paper, not in this repo.
- The two operational flags below stay **OFF** until the owner explicitly flips them.

| Flag | State | What it does when ON |
|---|---|---|
| `STORE_INWARD_ACCESS` | **OFF** | Lets Store (Admin) do the inward flow again (upload/extract/hand-over). OFF = inward is the Gate's. |
| `PACKING_STAGE` | **OFF** | Switches Dispatch's home to packed-goods (PG) carton cards. OFF = Dispatch ships FG drums directly. |

---

## The 11 accounts

| # | Login (email) | Role (enum) | Called | Department | Password |
|---|---|---|---|---|---|
| 1 | `admin@moderncolours.local` | ADMIN | **Store** | — | _seed default — MUST BE CHANGED_ |
| 2 | `oversight@moderncolours.local` | OVERSIGHT | **Admin** (owner) | — | _seed default — MUST BE CHANGED_ |
| 3 | `gate@moderncolours.local` | OPERATOR | **Gate** | — | _seed default — MUST BE CHANGED_ |
| 4 | `pu@moderncolours.local` | PRODUCTION_HEAD | PU Head | PU | _seed default — MUST BE CHANGED_ |
| 5 | `enamel@moderncolours.local` | PRODUCTION_HEAD | Enamel Head | ENAMEL | _seed default — MUST BE CHANGED_ |
| 6 | `powder@moderncolours.local` | PRODUCTION_HEAD | Powder Head | POWDER | _seed default — MUST BE CHANGED_ |
| 7 | `dispatch@moderncolours.local` | DISPATCH | Dispatch | — | _seed default — MUST BE CHANGED_ |
| 8 | `packer@moderncolours.local` | PACKER | **Packer** | — | _seed default — MUST BE CHANGED_ |
| 9 | `pallavi@moderncolours.local` | REVIEWER | Reviewer | — | _seed default — MUST BE CHANGED_ |
| 10 | `rupinder@moderncolours.local` | REVIEWER | Reviewer | — | _seed default — MUST BE CHANGED_ |
| 11 | `op1@moderncolours.local` | OPERATOR | (legacy, **inactive**) | — | _inactive — do not use_ |

Roles that carry real power (ADMIN, OVERSIGHT, SUPERVISOR) are **seed-only** — they can
never be minted through User Management.

---

## Master tap-through — screen → action → what you should see

### 1. Gate — `gate@` (OPERATOR)
Lands on **Invoice Upload** (its only screen).
- **Photograph the invoice** → take a photo / choose a file. Arrival date & time are
  **captured automatically and locked** (a read-only note; nobody can edit them).
- The invoice is read automatically; the extracted lines appear to **proofread** against
  the paper. Fix anything misread.
- **Confirm & hand over to Store** → this is now the **minting act**: it generates the
  `MC-` unit codes and puts them on the Good Receipt Note. You should see
  _"N unit codes generated — they now show on the receiving slip."_
- **Your scan history** shows the invoices you handed over, each with its arrival time.
- Gate can print the **Good Receipt Note** (logo, GOOD RECEIPT NOTE, Supplier + Date of
  Receipt, table Sr No / Material+code / Quantity Received / Pack Size / **Unit (Codes)**,
  Gate + Store signatures) — the codes now show as ranges, e.g. `MC-001 - MC-078`.

### 2. Store — `admin@` (ADMIN)
Lands on the **Store dashboard**.
- **Inward — receiving slips**: the 3 most recent, with **See all** for the rest. A
  handed-over slip shows **"Review & accept"**.
- **Review & accept** → the slip already carries the `MC-` codes (Gate minted them).
  **Accept & print** records custody (no re-minting) and prints the GRN.
- **Scan & Issue**, **Receive Stock** → both gated by a **Start/Done session**: a scan is
  refused by the server until you press **Start**; **Done** closes it with a count.
- **Master Catalogue** → the **Quantity** column shows size + unit only (e.g. "200 LTR");
  **Min stock** shows the min with its unit (e.g. "60 kg"). Add SKUs, fix provisional (TMP-) codes.
- **Audit Log** → Store sees **only its own** actions (inward, stock, issue, slips) — never
  other desks' or the owner's.
- **Stock Levels**, **Requests** (review production requests), **Settings**.

### 3. Admin / owner — `oversight@` (OVERSIGHT) — VIEW-ONLY, sees EVERYTHING
Lands on the **Oversight dashboard**.
- **Inward** (invoice beside slip, every status, historically), **Stock Levels**,
  **Batches**, **Requests**.
- **Total visibility (read-only)**: the packing desk (pool, lists, every carton at every
  status incl. **void reasons**), **all scan sessions** (who, from/to, counts), all GRN
  slips, arrival times.
- **Audit** — the whole trail: packing/GRN actions (`CARTON_*`, `MATERIALS_REGISTERED`,
  `STORE_INWARD_ACCEPTED`, `SCAN_SESSION_*`, `PACKING_LIST_CONFIRMED`) with unit ids.
- **The two named doors the owner holds**: approve/reject label **reprints**, and **flip
  the flags** (`STORE_INWARD_ACCESS`, `PACKING_STAGE`) — both through the one access-flip
  door. Oversight can write **nothing else** (every mutation is refused with 403).

### 4. Production Head — `pu@` / `enamel@` / `powder@` (PRODUCTION_HEAD)
Lands on **My Department** (scoped to its own department only).
- **Batches** → create a batch, thread raw materials into it.
- **Production Output** → record what was produced. Now with **hardener & thinner** inputs
  (each with its own pack size + unit — kg/L never blended). Confirm the output.
- **Generate FG QR codes** → mints all three families in one run: paint **FG-**, hardener
  **FGHD-**, thinner **FGTH-**, each from its own sequence. One label run prints all three.

### 5. Dispatch — `dispatch@` (DISPATCH) — three tabs: Scan · Packed (PG) · Returns
- **Scan** → **Start** a dispatch session, then **scan** an `FG-`/`FGHD-`/`FGTH-` unit **or**
  a carton **PG-** to ship it. **Done** closes with a count. A voided PG is refused; a unit a
  packer has taken into a carton (`UNDER_PACKING`/`PACKED`) is refused on a direct scan (ship
  the carton). Carton scans go through the **same session gate** as unit scans.
- **Packed (PG)** → one card per confirmed packing list: its contents summary (how many
  straights, how many combos, per-family totals with size+unit) and a **0–100% progress bar
  = PGs dispatched / PGs in the list**, all server-computed. Tap a card for the PG-level
  detail (each PG, its contents, its status).
- **Returns** → scrap or refurbish a **dispatched** unit (refurbish keeps the family).

### 6. Packer — `packer@` (PACKER) — two tabs: Batches · New List
- **Batches (home)** → one card per production batch with units to pack, showing the batch's
  **per-family counts with size+unit** (e.g. "32 × 6L Paint (FG) · 5 × 6kg Hardener (FGHD) ·
  2 × 6L Thinner (FGTH)" — kg/L never blended) and a **0–100% progress bar = units scanned
  into UNDER_PACKING / total**, all server-computed. Tap a card for unit detail. Fully
  scanned-in batches drop to a done section.
  - **Scan finished goods in**: press **Start** (a packing session, same system as Receive
    Stock), scan each `FG-`/`FGHD-`/`FGTH-` unit — the batch bars move as you scan — press
    **Done**. A scan outside an open session is **refused** by the server.
- **New List** → build **one packed-goods list**: add **straights** (a single drum) and
  **combos** (checked sets) from the pool. **Confirm list** → a **PG-** code for **every**
  entry at once. **Print all labels** → one PDF, each label showing its contents in detail.
  **Seal** (scan the PG) / **Void** a wrong entry (reason; units released; PG retired) live
  here too. Past lists are shown under the tab.
- Packer reaches **nothing else** — no raw stock, requests, batches, invoices, dispatch.

### 7. Reviewer — `pallavi@` / `rupinder@` (REVIEWER) — VIEW-ONLY
Lands on **Inward** (its only screen).
- Every inward: the **invoice document beside its digital slip**, every status,
  historically. The Reviewer reads and holds **no write anywhere**.

---

## Quick regression checklist

- [ ] Gate hand-over mints `MC-` codes; the GRN shows ranges, not "pending".
- [ ] Store accept does not re-mint; receiving is session-gated; stock carries opening balance.
- [ ] Head output with hardener/thinner mints FG-/FGHD-/FGTH- in one run.
- [ ] Packer: list of straights + combos → one confirm → sequential PGs → one label PDF.
- [ ] Void a PG → units released → voided PG refused at dispatch → repack into a fresh PG.
- [ ] Oversight reads every surface; is refused every write (403); doors still four.
- [ ] Both flags OFF. Label reprints need Oversight approval (first print free).
