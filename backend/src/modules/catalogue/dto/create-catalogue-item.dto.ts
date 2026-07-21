import { IsNumber, IsOptional, IsString, Min, MinLength } from 'class-validator';

export class CreateCatalogueItemDto {
  @IsString()
  @MinLength(1)
  materialName!: string;

  // Optional: operators adding a brand-new SKU on the fly may not have an
  // official code yet — one is auto-generated (provisional) if omitted.
  @IsOptional()
  @IsString()
  sku?: string;

  @IsOptional()
  @IsString()
  hsnCode?: string;

  @IsOptional()
  @IsString()
  category?: string;

  @IsOptional()
  @IsString()
  unit?: string;

  @IsOptional()
  @IsString()
  standardPackaging?: string;

  // Admin-set stock thresholds, in the material's OWN unit (kg or L). They drive the
  // stock-percentage display and low-stock alerts. null clears a threshold.
  @IsOptional()
  @IsNumber()
  @Min(0)
  minLevel?: number | null;

  @IsOptional()
  @IsNumber()
  @Min(0)
  maxLevel?: number | null;
}
