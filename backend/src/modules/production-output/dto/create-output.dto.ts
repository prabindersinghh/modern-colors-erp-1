import {
  IsDateString,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsPositive,
  IsString,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

/**
 * What a production head actually produced from a batch. Recorded as a DRAFT — nothing
 * is final until the head explicitly confirms it (the review gate), and FG QR codes
 * cannot be generated before that.
 */
export class CreateOutputDto {
  @IsString()
  batchId!: string; // the batch whose raw materials went into this product

  @IsString()
  @MinLength(1)
  @MaxLength(200)
  productName!: string;

  @IsInt()
  @Min(1)
  packageCount!: number; // drums/packages produced → one FG QR each

  @IsNumber()
  @IsPositive()
  sizePerPackage!: number; // e.g. 20

  @IsOptional()
  @IsIn(['L', 'Kg'])
  sizeUnit?: 'L' | 'Kg';

  @IsDateString()
  productionDate!: string; // ISO date

  @IsOptional()
  @IsString()
  @MaxLength(120)
  shade?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  productSku?: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  notes?: string;

  // Packing stage — hardener/thinner produced alongside the paint line, each with its OWN
  // pack size + unit (kg/L never blended). Zero/absent = this output made none.
  @IsOptional() @IsInt() @Min(0) hardenerCount?: number;
  @IsOptional() @IsNumber() @IsPositive() hardenerSize?: number;
  @IsOptional() @IsIn(['L', 'Kg']) hardenerUnit?: 'L' | 'Kg';
  @IsOptional() @IsInt() @Min(0) thinnerCount?: number;
  @IsOptional() @IsNumber() @IsPositive() thinnerSize?: number;
  @IsOptional() @IsIn(['L', 'Kg']) thinnerUnit?: 'L' | 'Kg';
}

/** Edits to a draft output (blocked once confirmed). */
export class UpdateOutputDto {
  @IsOptional() @IsString() @MinLength(1) @MaxLength(200) productName?: string;
  @IsOptional() @IsInt() @Min(1) packageCount?: number;
  @IsOptional() @IsNumber() @IsPositive() sizePerPackage?: number;
  @IsOptional() @IsIn(['L', 'Kg']) sizeUnit?: 'L' | 'Kg';
  @IsOptional() @IsDateString() productionDate?: string;
  @IsOptional() @IsString() @MaxLength(120) shade?: string;
  @IsOptional() @IsString() @MaxLength(120) productSku?: string;
  @IsOptional() @IsString() @MaxLength(1000) notes?: string;
  @IsOptional() @IsInt() @Min(0) hardenerCount?: number;
  @IsOptional() @IsNumber() @IsPositive() hardenerSize?: number;
  @IsOptional() @IsIn(['L', 'Kg']) hardenerUnit?: 'L' | 'Kg';
  @IsOptional() @IsInt() @Min(0) thinnerCount?: number;
  @IsOptional() @IsNumber() @IsPositive() thinnerSize?: number;
  @IsOptional() @IsIn(['L', 'Kg']) thinnerUnit?: 'L' | 'Kg';
}
