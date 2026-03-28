import {
  IsArray,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  MinLength,
} from 'class-validator';

export class ImportRoomDto {
  @IsNumber()
  version!: number;

  @IsOptional()
  @IsString()
  exportedAt?: string;

  @IsString()
  @MinLength(3)
  title!: string;

  @IsObject()
  canvas!: object;

  @IsOptional()
  @IsArray()
  diceLogs?: unknown[];

  @IsOptional()
  @IsArray()
  canvasHistory?: unknown[];

  @IsOptional()
  @IsArray()
  chatMessages?: unknown[];

  @IsOptional()
  @IsObject()
  participantAcl?: Record<string, unknown>;
}
