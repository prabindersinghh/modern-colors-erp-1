-- Packer scanning joins the server-side ScanSession system, like Receive Stock and
-- Dispatch. A packer's scan-in is refused outside an open session of this new kind.
-- Additive: one enum value on the existing type; no table change.
ALTER TYPE "ScanKind" ADD VALUE IF NOT EXISTS 'PACKING';
