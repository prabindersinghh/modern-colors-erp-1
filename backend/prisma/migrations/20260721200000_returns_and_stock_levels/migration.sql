-- Returns lifecycle + Admin-set stock thresholds (all additive, no defaults changed).

-- Two terminal statuses for a returned finished-goods unit.
ALTER TYPE "FgStatus" ADD VALUE 'SCRAPPED';
ALTER TYPE "FgStatus" ADD VALUE 'REFURBISHED';

-- Return details on the unit; who/when/why is ALSO in the append-only audit log.
ALTER TABLE "FinishedGood" ADD COLUMN "returnedAt" TIMESTAMP(3);
ALTER TABLE "FinishedGood" ADD COLUMN "returnNote" TEXT;
ALTER TABLE "FinishedGood" ADD COLUMN "returnedById" TEXT;
ALTER TABLE "FinishedGood" ADD COLUMN "refurbishedFromId" TEXT;

ALTER TABLE "FinishedGood" ADD CONSTRAINT "FinishedGood_returnedById_fkey"
  FOREIGN KEY ("returnedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "FinishedGood" ADD CONSTRAINT "FinishedGood_refurbishedFromId_fkey"
  FOREIGN KEY ("refurbishedFromId") REFERENCES "FinishedGood"("id") ON DELETE SET NULL ON UPDATE CASCADE;
-- A unit can be refurbished into exactly one replacement.
CREATE UNIQUE INDEX "FinishedGood_refurbishedFromId_key" ON "FinishedGood"("refurbishedFromId");

-- Admin-set min/max stock levels per catalogue material, in the material's own unit.
ALTER TABLE "MasterCatalogueItem" ADD COLUMN "minLevel" DOUBLE PRECISION;
ALTER TABLE "MasterCatalogueItem" ADD COLUMN "maxLevel" DOUBLE PRECISION;
