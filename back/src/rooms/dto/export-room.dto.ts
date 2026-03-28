import { IsOptional, IsString } from 'class-validator';

export class ExportRoomDto {
  @IsOptional()
  @IsString()
  hostSecret?: string;
}
