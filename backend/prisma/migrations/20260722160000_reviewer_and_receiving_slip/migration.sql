-- Segregation of duties: the Reviewer role and the digital receiving slip.
--
-- Additive only. No existing column changes meaning, no existing row is rewritten, and
-- nothing here removes access from anyone — Store's inward access is revoked later by a
-- reversible Setting flip, NOT by this migration, so the factory can keep receiving
-- trucks throughout.

-- The Reviewer. Strictly view-only: invoice document + digital slip, nothing else.
-- Precedent for adding an enum value in a migration: 20260721200000 did the same for
-- FgStatus. PG 12+ permits ADD VALUE inside a transaction as long as the new value is
-- not USED in the same transaction; this only declares it.
ALTER TYPE "Role" ADD VALUE 'REVIEWER';

CREATE TYPE "SlipStatus" AS ENUM ('DRAFT', 'FINALIZED');

-- One slip per inward. Store no longer sees the invoice, so this is what tells Store
-- what arrived — deliberately free of prices, amounts, HSN and the invoice image.
CREATE TABLE "ReceivingSlip" (
    "id"            TEXT           NOT NULL,
    "slipNumber"    TEXT           NOT NULL,
    "poId"          TEXT           NOT NULL,
    "supplier"      TEXT,
    "receivedDate"  TIMESTAMP(3)   NOT NULL,
    -- Denormalised on purpose: a record of what was physically handed over, which a
    -- later catalogue or material edit must never be able to rewrite.
    "lines"         JSONB          NOT NULL,
    "unitCount"     INTEGER        NOT NULL,
    "status"        "SlipStatus"   NOT NULL DEFAULT 'DRAFT',
    "generatedById" TEXT           NOT NULL,
    "generatedAt"   TIMESTAMP(3)   NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finalizedById" TEXT,
    "finalizedAt"   TIMESTAMP(3),
    "scannedCount"  INTEGER,

    CONSTRAINT "ReceivingSlip_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ReceivingSlip_slipNumber_key"  ON "ReceivingSlip"("slipNumber");
CREATE UNIQUE INDEX "ReceivingSlip_poId_key"        ON "ReceivingSlip"("poId");
CREATE INDEX        "ReceivingSlip_status_idx"      ON "ReceivingSlip"("status");
CREATE INDEX        "ReceivingSlip_receivedDate_idx" ON "ReceivingSlip"("receivedDate");

ALTER TABLE "ReceivingSlip" ADD CONSTRAINT "ReceivingSlip_poId_fkey"
    FOREIGN KEY ("poId") REFERENCES "PurchaseOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ReceivingSlip" ADD CONSTRAINT "ReceivingSlip_generatedById_fkey"
    FOREIGN KEY ("generatedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ReceivingSlip" ADD CONSTRAINT "ReceivingSlip_finalizedById_fkey"
    FOREIGN KEY ("finalizedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Counts are physical facts and can never be negative.
ALTER TABLE "ReceivingSlip" ADD CONSTRAINT "ReceivingSlip_counts_sane"
    CHECK ("unitCount" >= 0 AND ("scannedCount" IS NULL OR "scannedCount" >= 0));

-- The slip's own human-readable sequence, alongside material_unique_seq and
-- finished_good_unique_seq. Reset by the handover flush so the factory's first real
-- slip is RS-000001.
CREATE SEQUENCE IF NOT EXISTS receiving_slip_seq START 1;
