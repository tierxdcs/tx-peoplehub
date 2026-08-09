import { ProvisioningApproverType } from '@prisma/client';
import { IsBoolean, IsEnum, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';

export class CreateProvisioningItemTypeDto {
  @IsString() @MaxLength(100) name!: string;
  @IsBoolean() requiresScmFulfillment!: boolean;
  @IsEnum(ProvisioningApproverType) approverType!: ProvisioningApproverType;
  @IsOptional() @IsUUID() approverVerticalId?: string | null;
}

export class UpdateProvisioningItemTypeDto {
  @IsOptional() @IsString() @MaxLength(100) name?: string;
  @IsOptional() @IsBoolean() requiresScmFulfillment?: boolean;
  @IsOptional() @IsEnum(ProvisioningApproverType) approverType?: ProvisioningApproverType;
  @IsOptional() @IsUUID() approverVerticalId?: string | null;
  @IsOptional() @IsBoolean() isActive?: boolean;
}
