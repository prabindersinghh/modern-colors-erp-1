-- Server-side scan sessions. Additive — a new table only; no existing table is altered.
CREATE TYPE "ScanKind" AS ENUM ('RECEIVING', 'DISPATCH');

CREATE TABLE "ScanSession" (
    "id"         TEXT        NOT NULL,
    "kind"       "ScanKind"  NOT NULL,
    "openedById" TEXT        NOT NULL,
    "openedAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "closedAt"   TIMESTAMP(3),
    "scanCount"  INTEGER     NOT NULL DEFAULT 0,
    CONSTRAINT "ScanSession_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "ScanSession" ADD CONSTRAINT "ScanSession_openedById_fkey"
    FOREIGN KEY ("openedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE INDEX "ScanSession_openedById_idx" ON "ScanSession"("openedById");
CREATE INDEX "ScanSession_kind_closedAt_idx" ON "ScanSession"("kind", "closedAt");

-- At most ONE open session per (kind, user): the gate's core invariant, enforced by a
-- partial unique index rather than by application convention.
CREATE UNIQUE INDEX "ScanSession_one_open" ON "ScanSession"("kind", "openedById") WHERE "closedAt" IS NULL;
