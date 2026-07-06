import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsDefined,
  IsEmail,
  IsOptional,
  IsString,
  IsUUID,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { IsAddress } from './is-address.validator';

export class CustomerContactDto {
  @ApiProperty()
  @IsString()
  @MinLength(1)
  name!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsEmail()
  email?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  phone?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  designation?: string;

  @ApiPropertyOptional({ default: false })
  @IsOptional()
  @IsBoolean()
  isPrimary?: boolean;
}

export class CreateCustomerDto {
  @ApiProperty({ example: 'Acme Corp' })
  @IsString()
  @MinLength(1)
  name!: string;

  @ApiPropertyOptional({ example: '29ABCDE1234F1Z5' })
  @IsOptional()
  @IsString()
  gstin?: string;

  @ApiProperty({
    description:
      'Billing address — a JSON object (e.g. {line1, city, state}) or a plain string',
    example: { line1: '123 MG Road', city: 'Bengaluru', state: 'Karnataka' },
  })
  @IsDefined()
  @IsAddress()
  billingAddress!: Record<string, unknown> | string;

  @ApiPropertyOptional({
    description: 'Shipping address — defaults to billing when omitted',
  })
  @IsOptional()
  @IsAddress()
  shippingAddress?: Record<string, unknown> | string;

  @ApiPropertyOptional({ example: 'Manufacturing' })
  @IsOptional()
  @IsString()
  industry?: string;

  @ApiPropertyOptional({
    description:
      'Owning Sales rep. Defaults to the creating user when omitted; only a MANAGER/SUPER_ADMIN may assign a different owner.',
  })
  @IsOptional()
  @IsUUID()
  ownerId?: string;

  @ApiPropertyOptional({ type: [CustomerContactDto] })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CustomerContactDto)
  contacts?: CustomerContactDto[];
}
