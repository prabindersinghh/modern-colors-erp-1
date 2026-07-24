# Modern Colours — Factory Quick Cards

One card per role. Print, cut along the lines, hand to each person. Passwords are written
on paper by whoever sets them — **never printed here**. Current to commit `8fae4d6`.

> First login for everyone: change your password. The system will still work if you don't,
> but your account is not yours until you do.

---

### ✂️ ─────────────────  GATE  ─────────────────

**Login:** `gate@moderncolours.local`   **Password:** ____________________

**Your one screen: Invoice Upload.**
1. **Take a photo** of the supplier's invoice. (Arrival time is recorded and locked for you.)
2. Check the read-back lines against the paper. Fix anything wrong.
3. Press **Confirm & hand over to Store**. This generates the unit codes (MC-…) and puts
   them on the Good Receipt Note.
4. Print the **Good Receipt Note** and hand it over with the truck.

You do not receive, weigh, or print stickers — that is Store's.

### ✂️ ────────────────  STORE  ────────────────

**Login:** `admin@moderncolours.local`   **Password:** ____________________

**Your dashboard shows the receiving slips the Gate handed over.**
1. **Review & accept** a slip — it already carries the MC- codes. **Accept & print**.
2. **Receive Stock** → press **Start**, scan the sacks in, press **Done**.
3. **Scan & Issue** to move stock to production (Start/Done the same way).
4. **Master Catalogue** for SKUs and min-stock levels. **Audit Log** for your own actions.

### ✂️ ───────────────  ADMIN (owner)  ───────────────

**Login:** `oversight@moderncolours.local`   **Password:** ____________________

**You see everything, and change almost nothing (by design).**
- Dashboards, stock, batches, requests, the packing desk, all scan sessions, all slips,
  and the full audit trail — read-only.
- You approve **label reprints**, and you flip the two switches
  (`STORE_INWARD_ACCESS`, `PACKING_STAGE`). Nothing else.

### ✂️ ──────────  PRODUCTION HEAD (PU / Enamel / Powder)  ──────────

**Login:** `pu@` / `enamel@` / `powder@` `moderncolours.local`   **Password:** ____________

**You see only your own department.**
1. **Batches** → create a batch, issue raw materials into it.
2. **Production Output** → record what was made, including **hardener** and **thinner** (each
   with its own size + unit). **Confirm**.
3. **Generate QR codes** → paint (FG-), hardener (FGHD-), thinner (FGTH-) in one run.

### ✂️ ───────────────  DISPATCH  ───────────────

**Login:** `dispatch@moderncolours.local`   **Password:** ____________________

**Your one screen: Dispatch.**
1. Press **Start**, then scan each finished-goods unit (FG-/FGHD-/FGTH-) to ship it. **Done**
   closes with a count.
2. If packed goods are in use, scan the carton's **PG-** code to ship the whole carton.
3. **Returns** → scrap or refurbish a unit that was dispatched and came back.

A drum a packer is packing cannot be shipped alone — ship its carton.

### ✂️ ───────────────  PACKER  ───────────────

**Login:** `packer@moderncolours.local`   **Password:** ____________________

**Your one screen: Packing desk.**
1. **Scan** finished goods **in** (FG-/FGHD-/FGTH-).
2. Build **one list**: add **straights** (a single drum) and **combos** (chosen sets).
3. **Confirm list** → every entry gets a PG- code at once. **Print all labels** (one PDF).
4. **Seal** each carton (scan its PG). To fix a wrong one: **Void** it (say why) and repack.

### ✂️ ───────────────  REVIEWER  ───────────────

**Login:** `pallavi@` / `rupinder@` `moderncolours.local`   **Password:** ____________

**Your one screen: Inward.**
- Read each inward: the invoice document beside its digital slip. You check; you do not
  change anything.

### ✂️ ────────────────────────────────────────
