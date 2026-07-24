import { IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

/** Scan a finished-goods unit into the packer's hands (→ UNDER_PACKING). */
export class ScanInDto {
  @IsString()
  @MinLength(3)
  uniqueId!: string;

  @IsOptional()
  @IsString()
  device?: string;
}

/** Add a unit to a DRAFT carton. */
export class AddItemDto {
  @IsString()
  @MinLength(3)
  uniqueId!: string;
}

/** Void a confirmed carton — a reason is required (it releases the contents). */
export class VoidCartonDto {
  @IsString()
  @MinLength(3)
  @MaxLength(500)
  reason!: string;
}

/** Scan a carton's PG- code (mark packed, or dispatch). */
export class CartonScanDto {
  @IsString()
  @MinLength(3)
  uniqueId!: string;

  @IsOptional()
  @IsString()
  device?: string;

  @IsOptional()
  @IsString()
  note?: string;
}
