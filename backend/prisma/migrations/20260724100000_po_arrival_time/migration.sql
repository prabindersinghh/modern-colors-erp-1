-- The truck's arrival time on the invoice. Additive, nullable — pre-existing invoices
-- have no recorded arrival and the UI falls back to createdAt for them. createdAt (the
-- row-creation instant) is never touched.
ALTER TABLE "PurchaseOrder" ADD COLUMN "arrivedAt" TIMESTAMP(3);
