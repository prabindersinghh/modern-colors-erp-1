import { Type } from 'class-transformer';
import {
  IsArray,
  IsInt,
  IsOptional,
  IsString,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';

export class ManualLineItemDto {
  @IsString()
  @MinLength(1)
  materialName!: string;

  @IsOptional()
  @IsString()
  sku?: string;

  @IsInt()
  @Min(1)
  quantity!: number;

  @IsOptional()
  @IsString()
  unit?: string;

  @IsOptional()
  @IsString()
  batchNumber?: string;
}

// Manual fallback entry (invariant I7) — used when AI extraction fails or the
// operator chooses to type the PO by hand.
export class ManualEntryDto {
  @IsOptional()
  @IsString()
  poNumber?: string;

  @IsOptional()
  @IsString()
  supplier?: string;

  @IsOptional()
  @IsString()
  deliveryDate?: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ManualLineItemDto)
  lineItems!: ManualLineItemDto[];
}
