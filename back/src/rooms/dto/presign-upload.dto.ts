import { IsIn, IsInt, IsString, Max, MaxLength, Min } from 'class-validator';

const ALLOWED_TYPES = [
  'image/png',
  'image/jpeg',
  'image/webp',
  'image/gif',
] as const;

export class PresignUploadDto {
  @IsString()
  @IsIn([...ALLOWED_TYPES])
  contentType!: (typeof ALLOWED_TYPES)[number];

  @IsString()
  @MaxLength(240)
  fileName!: string;

  @IsInt()
  @Min(1)
  @Max(15 * 1024 * 1024)
  fileSize!: number;
}
