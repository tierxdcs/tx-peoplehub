import { IsOptional, IsString, MaxLength } from 'class-validator';

export class ProvisioningDecisionDto {
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  comment?: string;
}
