import { IsNumber, IsOptional, IsString, Min, MaxLength } from 'class-validator';

/**
 * Set the per-package weight for one PO line.
 *
 * Receiving no longer weighs each sack, so a unit's opening stock balance comes from
 * the PO's per-package weight. When an invoice genuinely states no pack size (a bulk
 * line like "2,300 KG"), the operator supplies it ONCE for the line and every un-moved
 * unit on that line becomes issuable — ~5 entries per invoice instead of one weighing
 * per sack across a 2,500-sack truckload.
 */
export class SetPackWeightDto {
  /** Identifies the line together with sku. Required — sku alone may be null. */
  @IsString()
  @MaxLength(300)
  materialName!: string;

  /** Supplier item code when the line has one; null matches the name-only line. */
  @IsOptional()
  @IsString()
  @MaxLength(120)
  sku?: string | null;

  /** Weight of ONE package in kg. Must be positive — 0 is not "unknown", it is empty. */
  @IsNumber()
  @Min(0.001)
  weightKg!: number;
}
