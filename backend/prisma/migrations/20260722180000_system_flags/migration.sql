-- Operational flags. Additive; one row is created lazily on first write, and an absent
-- row reads as the safe default (STORE_INWARD_ACCESS = "on"), so this migration alone
-- changes nobody's access.
CREATE TABLE "SystemFlag" (
    "key"         TEXT         NOT NULL,
    "value"       TEXT         NOT NULL,
    "updatedById" TEXT,
    "updatedAt"   TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SystemFlag_pkey" PRIMARY KEY ("key")
);

ALTER TABLE "SystemFlag" ADD CONSTRAINT "SystemFlag_updatedById_fkey"
    FOREIGN KEY ("updatedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
