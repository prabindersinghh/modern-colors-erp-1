-- Set when a correction changes a field that is printed on the physical label
-- (product name / size). Cleared when the unit's label is reprinted.
ALTER TABLE "FinishedGood" ADD COLUMN "qrReprintNeeded" BOOLEAN NOT NULL DEFAULT false;
