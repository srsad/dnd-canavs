import { Allow, IsOptional, IsString, MinLength } from 'class-validator';

export class CreateRoomDto {
  @IsString()
  @MinLength(3)
  title!: string;

  @IsOptional()
  @IsString()
  @MinLength(2)
  guestName?: string;

  /**
   * Stable guest identity (UUID v4); omit to let server assign.
   * @Allow() keeps this on the whitelist with forbidNonWhitelisted + transform.
   */
  @Allow()
  @IsOptional()
  @IsString()
  guestKey?: string;
}
