-- Packing lists: the packer composes ONE list of entries (straight drums + combos),
-- then ONE confirm mints a PG for every entry together. Fully additive — every entry is
-- still a Carton row, so all packing invariants (one-carton UNIQUE, freeze, void/repack,
-- Gap A) are unchanged. The list is just a grouping over cartons.

CREATE TYPE "PackingListStatus" AS ENUM ('DRAFT', 'CONFIRMED');

CREATE TABLE "PackingList" (
    "id"          TEXT                NOT NULL,
    "status"      "PackingListStatus" NOT NULL DEFAULT 'DRAFT',
    "packedById"  TEXT                NOT NULL,
    "createdAt"   TIMESTAMP(3)        NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "confirmedAt" TIMESTAMP(3),
    "note"        TEXT,
    "updatedAt"   TIMESTAMP(3)        NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PackingList_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "PackingList_packedById_idx" ON "PackingList"("packedById");
CREATE INDEX "PackingList_status_idx" ON "PackingList"("status");
ALTER TABLE "PackingList" ADD CONSTRAINT "PackingList_packedById_fkey"
    FOREIGN KEY ("packedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- A carton MAY belong to a list (null = a standalone carton composed the old one-at-a-time
-- way, still supported). ON DELETE SET NULL so deleting a list never cascades to cartons.
ALTER TABLE "Carton" ADD COLUMN "packingListId" TEXT;
ALTER TABLE "Carton" ADD CONSTRAINT "Carton_packingListId_fkey"
    FOREIGN KEY ("packingListId") REFERENCES "PackingList"("id") ON DELETE SET NULL ON UPDATE CASCADE;
CREATE INDEX "Carton_packingListId_idx" ON "Carton"("packingListId");
