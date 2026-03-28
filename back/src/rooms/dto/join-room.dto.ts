import { IsOptional, IsString, IsUUID, MinLength } from 'class-validator';

export class JoinRoomDto {
  @IsOptional()
  @IsString()
  @MinLength(2)
  guestName?: string;

  @IsOptional()
  @IsUUID('4')
  guestKey?: string;

  /** Guest GM reconnect secret (shown once at room creation) */
  @IsOptional()
  @IsString()
  @MinLength(32)
  hostSecret?: string;
}
