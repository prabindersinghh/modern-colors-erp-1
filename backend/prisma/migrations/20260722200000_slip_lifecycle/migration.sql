-- The slip moves EARLIER: it is now born at extraction as the digital PO, and is what
-- Store confirms FROM rather than something produced by confirming. Additive only.

-- Gate proofreads a DRAFT against the paper, then hands over.
ALTER TYPE "SlipStatus" ADD VALUE 'AWAITING_STORE' BEFORE 'FINALIZED';

-- At extraction no unit exists yet, so the count cannot be known.
ALTER TABLE "ReceivingSlip" ALTER COLUMN "unitCount" DROP NOT NULL;

ALTER TABLE "ReceivingSlip" ADD COLUMN "confirmedAt"  TIMESTAMP(3);
ALTER TABLE "ReceivingSlip" ADD COLUMN "handedOverAt" TIMESTAMP(3);

-- The existing CHECK allowed unitCount >= 0; it must now tolerate NULL.
ALTER TABLE "ReceivingSlip" DROP CONSTRAINT IF EXISTS "ReceivingSlip_counts_sane";
ALTER TABLE "ReceivingSlip" ADD CONSTRAINT "ReceivingSlip_counts_sane" CHECK (
    ("unitCount" IS NULL OR "unitCount" >= 0) AND ("scannedCount" IS NULL OR "scannedCount" >= 0)
);
