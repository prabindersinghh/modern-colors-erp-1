-- Store's ACCEPT step. Gate now mints the MC- codes at hand-over, so the slip reaches
-- Store already carrying them; Store reviews the Good Receipt Note, ACCEPTS custody, and
-- prints. These record that acceptance (distinct from Gate's mint `confirmedAt` and from
-- the later physical-receiving `finalizedAt`). Fully additive, nullable — existing slips
-- are simply un-accepted until Store acts.
ALTER TABLE "ReceivingSlip" ADD COLUMN "acceptedAt" TIMESTAMP(3);
ALTER TABLE "ReceivingSlip" ADD COLUMN "acceptedById" TEXT;
ALTER TABLE "ReceivingSlip" ADD CONSTRAINT "ReceivingSlip_acceptedById_fkey"
    FOREIGN KEY ("acceptedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
