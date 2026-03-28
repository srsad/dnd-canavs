import { IsOptional, IsString, IsUUID, MinLength } from 'class-validator';

export class CreateRoomDto {
  @IsString()
  @MinLength(3)
  title!: string;

  @IsOptional()
  @IsString()
  @MinLength(2)
  guestName?: string;

  /** Stable guest identity (UUID v4); omit to let server assign */
  @IsOptional()
  @IsUUID('4')
  guestKey?: string;
}
