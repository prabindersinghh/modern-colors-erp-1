import { Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsInt,
  IsOptional,
  IsString,
  MaxLength,
  ValidateNested,
  ArrayMaxSize,
} from 'class-validator';

/** One catalogue row as reviewed (and possibly edited) in the preview. */
export class ImportRowDto {
  @IsString()
  @MaxLength(300)
  materialName!: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  sku?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  hsnCode?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  category?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  unit?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(160)
  standardPackaging?: string | null;
}

/**
 * Commit a reviewed set of rows.
 *
 * Capped at 5,000 to match the 10 MB upload limit — a factory catalogue is ~500-600
 * SKUs, so anything near the cap is a mistake worth rejecting rather than processing.
 */
export class ImportRowsDto {
  @IsArray()
  @ArrayMaxSize(5000)
  @ValidateNested({ each: true })
  @Type(() => ImportRowDto)
  rows!: ImportRowDto[];
}

/** A row being re-checked after an in-place edit. Carries its preview row number. */
export class RevalidateRowDto extends ImportRowDto {
  @IsInt()
  row!: number;
}

export class RevalidateRowsDto {
  @IsArray()
  @ArrayMaxSize(5000)
  @ValidateNested({ each: true })
  @Type(() => RevalidateRowDto)
  rows!: RevalidateRowDto[];

  /** false = deterministic checks only; skips the API call for small edits. */
  @IsOptional()
  @IsBoolean()
  ai?: boolean;
}
