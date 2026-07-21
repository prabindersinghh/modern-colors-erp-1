-- Raw-material litre support (additive, non-destructive).
-- Both columns default to 'kg', so every existing row and all current behaviour is
-- unchanged until a unit is explicitly set to 'L'. Adding a column with a constant
-- default is a metadata-only change on PostgreSQL (no table rewrite, no long lock).

-- The measure a Material's balanceKg/weight are in ("kg" or "L").
ALTER TABLE "Material" ADD COLUMN "stockUnit" TEXT NOT NULL DEFAULT 'kg';

-- The unit of a request line's requestedKg/approvedKg/issuedKg ("kg" or "L").
ALTER TABLE "ProductionRequestItem" ADD COLUMN "unit" TEXT NOT NULL DEFAULT 'kg';
