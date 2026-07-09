import { IsNumber, IsOptional, IsPositive, IsString, MinLength } from 'class-validator';

// A production head raises a per-material request (Override 2). The department is NEVER
// accepted from the client — it is forced to the head's own department server-side.
export class CreateProductionRequestDto {
  @IsString()
  @MinLength(1)
  materialName!: string;

  @IsOptional()
  @IsString()
  sku?: string;

  // Optional link to the Master Catalogue item the head picked.
  @IsOptional()
  @IsString()
  catalogueItemId?: string;

  @IsNumber()
  @IsPositive()
  requestedKg!: number;
}
