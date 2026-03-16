import { IsOptional, IsString, MinLength } from 'class-validator';

export class JoinRoomDto {
  @IsOptional()
  @IsString()
  @MinLength(2)
  guestName?: string;
}
