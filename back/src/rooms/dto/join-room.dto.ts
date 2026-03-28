import { Allow, IsOptional, IsString, MinLength } from 'class-validator';

export class JoinRoomDto {
  @IsOptional()
  @IsString()
  @MinLength(2)
  guestName?: string;

  @Allow()
  @IsOptional()
  @IsString()
  guestKey?: string;

  /** Guest GM reconnect secret (shown once at room creation) */
  @Allow()
  @IsOptional()
  @IsString()
  @MinLength(32)
  hostSecret?: string;
}
