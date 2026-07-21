import { IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

/** One returned FG unit being scrapped or refurbished. Reason is REQUIRED — a
 *  write-off or re-identification without a recorded why is an audit hole. */
export class ReturnDto {
  @IsString()
  uniqueId!: string; // "FG-000123"

  @IsString()
  @MinLength(1)
  @MaxLength(500)
  note!: string;

  @IsOptional()
  @IsString()
  device?: string;
}
