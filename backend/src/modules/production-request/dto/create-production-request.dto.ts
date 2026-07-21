import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsIn,
  IsNumber,
  IsOptional,
  IsPositive,
  IsString,
  MinLength,
  ValidateNested,
} from 'class-validator';

/** Amounts are measured in kilograms or litres (litres for solvents and other liquids). */
export const STOCK_UNITS = ['kg', 'L'] as const;
export type StockUnit = (typeof STOCK_UNITS)[number];

// One material line within a request.
export class RequestLineItemDto {
  @IsString()
  @MinLength(1)
  materialName!: string;

  @IsOptional()
  @IsString()
  sku?: string;

  @IsOptional()
  @IsString()
  catalogueItemId?: string;

  @IsNumber()
  @IsPositive()
  requestedKg!: number; // amount, in `unit` (kept in the requestedKg column for history)

  // "kg" or "L". Optional and defaults to kg, so older clients and existing lines are
  // unaffected. Liquids (solvents) are requested in litres.
  @IsOptional()
  @IsIn(STOCK_UNITS)
  unit?: StockUnit;

  // Phase 3 — the batch this LINE is for (per line, not per request: a head may order
  // for several batches at once). Must be an existing batch in the head's OWN
  // department; the server re-checks ownership. Optional for backwards compatibility.
  @IsOptional()
  @IsString()
  batchId?: string;
}

// A production head raises ONE request holding many material lines (a batch's worth).
// The department is NEVER accepted from the client — it is forced to the head's own.
export class CreateProductionRequestDto {
  @IsOptional()
  @IsString()
  note?: string;

  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => RequestLineItemDto)
  items!: RequestLineItemDto[];
}
