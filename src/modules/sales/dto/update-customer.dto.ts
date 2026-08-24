import { ApiPropertyOptional } from '@nestjs/swagger';
import { CustomerStatus } from '@prisma/client';
import {
  IsArray,
  IsBoolean,
  IsEmail,
  IsEnum,
  IsOptional,
  IsString,
  IsUUID,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { IsAddress } from './is-address.validator';

export class UpdateCustomerContactDto {
  @ApiPropertyOptional({
    description: 'Existing contact ID; omit for a new contact',
  })
  @IsOptional()
  @IsUUID()
  id?: string;

  @IsString()
  @MinLength(1)
  name!: string;

  @IsOptional()
  @IsEmail()
  email?: string;

  @IsOptional()
  @IsString()
  phone?: string;

  @IsOptional()
  @IsString()
  designation?: string;

  @IsOptional()
  @IsBoolean()
  isPrimary?: boolean;
}

export class UpdateCustomerDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MinLength(1)
  name?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  gstin?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsAddress()
  billingAddress?: Record<string, unknown> | string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsAddress()
  shippingAddress?: Record<string, unknown> | string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  industry?: string;

  @ApiPropertyOptional({ enum: CustomerStatus })
  @IsOptional()
  @IsEnum(CustomerStatus)
  status?: CustomerStatus;

  @ApiPropertyOptional({
    description: 'Reassign owner (MANAGER/SUPER_ADMIN only)',
  })
  @IsOptional()
  @IsUUID()
  ownerId?: string;

  @ApiPropertyOptional({
    type: [UpdateCustomerContactDto],
    description:
      'Complete replacement contact list. Existing IDs are updated, omitted IDs are removed, and entries without IDs are created.',
  })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => UpdateCustomerContactDto)
  contacts?: UpdateCustomerContactDto[];
}
