-- Phase 2 scope change: a production request becomes a HEADER holding many material
-- LINE ITEMS (ProductionRequestItem). Restructures the Phase-2-only request tables and
-- migrates the existing test request into a one-line item — no data lost. Phase 1 tables
-- are untouched. (This is coordinated with the refactored code in the same deploy.)

-- 1. New parent-only overall status value.
ALTER TYPE "RequestStatus" ADD VALUE IF NOT EXISTS 'IN_PROGRESS';

-- 2. Parent gains an optional batch label/note.
ALTER TABLE "ProductionRequest" ADD COLUMN "note" TEXT;

-- 3. New line-item table.
CREATE TABLE "ProductionRequestItem" (
    "id" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "materialName" TEXT NOT NULL,
    "sku" TEXT,
    "catalogueItemId" TEXT,
    "requestedKg" DOUBLE PRECISION NOT NULL,
    "status" "RequestStatus" NOT NULL DEFAULT 'PENDING',
    "approvedKg" DOUBLE PRECISION,
    "rejectionReason" TEXT,
    "issuedKg" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "reviewedAt" TIMESTAMP(3),
    "fulfilledAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ProductionRequestItem_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "ProductionRequestItem_requestId_idx" ON "ProductionRequestItem"("requestId");
CREATE INDEX "ProductionRequestItem_status_idx" ON "ProductionRequestItem"("status");

-- 4. Migrate every existing request's single material into a one-line item (preserves data).
INSERT INTO "ProductionRequestItem" (
    "id", "requestId", "materialName", "sku", "catalogueItemId", "requestedKg",
    "status", "approvedKg", "rejectionReason", "issuedKg", "reviewedAt", "fulfilledAt",
    "createdAt", "updatedAt"
)
SELECT
    gen_random_uuid(), "id", "materialName", "sku", "catalogueItemId", "requestedKg",
    "status", "approvedKg", "rejectionReason", "issuedKg", "reviewedAt", "fulfilledAt",
    "createdAt", CURRENT_TIMESTAMP
FROM "ProductionRequest";

ALTER TABLE "ProductionRequestItem"
    ADD CONSTRAINT "ProductionRequestItem_requestId_fkey"
    FOREIGN KEY ("requestId") REFERENCES "ProductionRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- 5. Repoint the stock ledger from the request to the LINE item (no ledger rows exist yet).
ALTER TABLE "StockTransaction" DROP CONSTRAINT "StockTransaction_requestId_fkey";
DROP INDEX "StockTransaction_requestId_idx";
ALTER TABLE "StockTransaction" DROP COLUMN "requestId";
ALTER TABLE "StockTransaction" ADD COLUMN "requestItemId" TEXT;
CREATE INDEX "StockTransaction_requestItemId_idx" ON "StockTransaction"("requestItemId");
ALTER TABLE "StockTransaction"
    ADD CONSTRAINT "StockTransaction_requestItemId_fkey"
    FOREIGN KEY ("requestItemId") REFERENCES "ProductionRequestItem"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- 6. Drop the per-material columns now moved onto the line item (data already copied above).
ALTER TABLE "ProductionRequest"
    DROP COLUMN "materialName",
    DROP COLUMN "sku",
    DROP COLUMN "catalogueItemId",
    DROP COLUMN "requestedKg",
    DROP COLUMN "approvedKg",
    DROP COLUMN "rejectionReason",
    DROP COLUMN "issuedKg",
    DROP COLUMN "fulfilledAt";
