import { IsBoolean, IsOptional, IsString } from 'class-validator';

export class UpdateParticipantAclDto {
  @IsOptional()
  @IsBoolean()
  editCanvas?: boolean;

  @IsOptional()
  @IsBoolean()
  moveAnyToken?: boolean;

  @IsOptional()
  @IsBoolean()
  manageParticipants?: boolean;

  /** Remove all ACL overrides for this participant (back to role defaults). */
  @IsOptional()
  @IsBoolean()
  clear?: boolean;

  @IsOptional()
  @IsString()
  hostSecret?: string;
}
