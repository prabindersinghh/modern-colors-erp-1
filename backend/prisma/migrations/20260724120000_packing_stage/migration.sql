-- Packing stage: hardener/thinner families, cartons (packed goods), the Packer role.
-- Fully ADDITIVE. Every existing FinishedGood backfills to family = FINISHED_GOOD via the
-- column default, so no existing query changes meaning and no data is rewritten.
--
-- Note on enum ADD VALUE: the new FgStatus / Role / LabelScope values are declared here but
-- NEVER used in this migration's DDL (they are only written at runtime), so there is no
-- "cannot use a new enum value in the same transaction" hazard. The two brand-new types
-- (FgFamily, CartonStatus) are CREATE TYPE, whose values MAY be used immediately.

-- 2.1 — the two new FG families, told apart by a discriminator (not two tables).
CREATE TYPE "FgFamily" AS ENUM ('FINISHED_GOOD', 'HARDENER', 'THINNER');
ALTER TABLE "FinishedGood" ADD COLUMN "family" "FgFamily" NOT NULL DEFAULT 'FINISHED_GOOD';

-- Pool queries filter by family; index it alongside status.
CREATE INDEX "FinishedGood_family_idx" ON "FinishedGood"("family");

-- Each family draws from its own sequence, so FG-/FGHD-/FGTH- never collide.
CREATE SEQUENCE IF NOT EXISTS "finished_good_hardener_seq" START 1;
CREATE SEQUENCE IF NOT EXISTS "finished_good_thinner_seq"  START 1;

-- Hardener/thinner quantities the head records, produced alongside the FG line.
-- Their OWN pack size + unit (kg/L never blended): nullable — an output may make neither.
ALTER TABLE "ProductionOutput" ADD COLUMN "hardenerCount" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "ProductionOutput" ADD COLUMN "thinnerCount"  INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "ProductionOutput" ADD COLUMN "hardenerSize"  DOUBLE PRECISION;
ALTER TABLE "ProductionOutput" ADD COLUMN "hardenerUnit"  TEXT;
ALTER TABLE "ProductionOutput" ADD COLUMN "thinnerSize"   DOUBLE PRECISION;
ALTER TABLE "ProductionOutput" ADD COLUMN "thinnerUnit"   TEXT;

-- 2.2 — the carton (packed goods) and its contents.
CREATE TYPE "CartonStatus" AS ENUM ('DRAFT', 'PACKED', 'DISPATCHED', 'VOIDED');

CREATE TABLE "Carton" (
    "id"             TEXT           NOT NULL,
    "uniqueId"       TEXT           NOT NULL,
    "status"         "CartonStatus" NOT NULL DEFAULT 'DRAFT',
    "packedById"     TEXT           NOT NULL,
    "createdAt"      TIMESTAMP(3)   NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "confirmedAt"    TIMESTAMP(3),
    "packedAt"       TIMESTAMP(3),
    "dispatchedAt"   TIMESTAMP(3),
    "dispatchedById" TEXT,
    "dispatchNote"   TEXT,
    "voidedAt"       TIMESTAMP(3),
    "voidedById"     TEXT,
    "voidReason"     TEXT,
    "note"           TEXT,
    "updatedAt"      TIMESTAMP(3)   NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Carton_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "Carton_uniqueId_key" ON "Carton"("uniqueId");
CREATE INDEX "Carton_status_idx" ON "Carton"("status");
CREATE INDEX "Carton_packedById_idx" ON "Carton"("packedById");

-- One join row per unit. The UNIQUE on finishedGoodId is the load-bearing invariant:
-- a unit is in AT MOST ONE carton, a database fact, not a convention.
CREATE TABLE "CartonItem" (
    "id"             TEXT NOT NULL,
    "cartonId"       TEXT NOT NULL,
    "finishedGoodId" TEXT NOT NULL,
    CONSTRAINT "CartonItem_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "CartonItem_finishedGoodId_key" ON "CartonItem"("finishedGoodId");
CREATE INDEX "CartonItem_cartonId_idx" ON "CartonItem"("cartonId");

ALTER TABLE "Carton" ADD CONSTRAINT "Carton_packedById_fkey"
    FOREIGN KEY ("packedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Carton" ADD CONSTRAINT "Carton_dispatchedById_fkey"
    FOREIGN KEY ("dispatchedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Carton" ADD CONSTRAINT "Carton_voidedById_fkey"
    FOREIGN KEY ("voidedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CartonItem" ADD CONSTRAINT "CartonItem_cartonId_fkey"
    FOREIGN KEY ("cartonId") REFERENCES "Carton"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CartonItem" ADD CONSTRAINT "CartonItem_finishedGoodId_fkey"
    FOREIGN KEY ("finishedGoodId") REFERENCES "FinishedGood"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE SEQUENCE IF NOT EXISTS "carton_unique_seq" START 1;

-- First-print-free lock for the carton mega label (reuses the reprint machinery).
ALTER TABLE "Carton" ADD COLUMN "labelPrintedAt" TIMESTAMP(3);
ALTER TABLE "LabelReprintRequest" ADD COLUMN "cartonId" TEXT;
ALTER TABLE "LabelReprintRequest" ADD CONSTRAINT "LabelReprintRequest_cartonId_fkey"
    FOREIGN KEY ("cartonId") REFERENCES "Carton"("id") ON DELETE CASCADE ON UPDATE CASCADE;
CREATE INDEX "LabelReprintRequest_cartonId_idx" ON "LabelReprintRequest"("cartonId");

-- 2.3 — new FG unit statuses (packer's in-progress and packed milestones).
ALTER TYPE "FgStatus" ADD VALUE IF NOT EXISTS 'UNDER_PACKING' BEFORE 'DISPATCHED';
ALTER TYPE "FgStatus" ADD VALUE IF NOT EXISTS 'PACKED' BEFORE 'DISPATCHED';

-- 2.4 — reprint scopes for the 3-family run and the carton mega label.
ALTER TYPE "LabelScope" ADD VALUE IF NOT EXISTS 'FG_OUTPUT_ALL_FAMILIES';
ALTER TYPE "LabelScope" ADD VALUE IF NOT EXISTS 'CARTON_LABEL';

-- 1. — the 8th role.
ALTER TYPE "Role" ADD VALUE IF NOT EXISTS 'PACKER';
