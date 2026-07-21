import { IsIn, IsNumber, IsOptional, IsPositive, IsString, MaxLength, MinLength } from 'class-validator';

/**
 * An audited correction to a finished-goods record.
 *
 * DELIBERATELY NARROW: identity fields do not exist here — no uniqueId, no status, no
 * batch/output linkage, no dispatch/return facts. A correction fixes what a record SAYS
 * about a drum (name, size, note), never what the drum IS or what happened to it.
 */
export class CorrectFinishedGoodDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  productName?: string;

  @IsOptional()
  @IsNumber()
  @IsPositive()
  sizePerPackage?: number;

  @IsOptional()
  @IsIn(['L', 'Kg'])
  sizeUnit?: string;

  /** null clears the note. */
  @IsOptional()
  @IsString()
  @MaxLength(500)
  dispatchNote?: string | null;

  /** Why the correction is being made — required, goes into the audit trail. */
  @IsString()
  @MinLength(1)
  @MaxLength(500)
  note!: string;
}
