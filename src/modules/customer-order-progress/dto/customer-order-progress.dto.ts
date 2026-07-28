import { Transform } from 'class-transformer';
import {
  Equals,
  IsBoolean,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

export class CreateCustomerProgressLinkDto {
  @IsOptional()
  @IsString()
  @MinLength(4)
  @MaxLength(100)
  password?: string;
}

export class ResolveCustomerProgressDto {
  @IsOptional()
  @IsString()
  @MaxLength(100)
  password?: string;
}

export class CustomerDeliverySignoffDto extends ResolveCustomerProgressDto {
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  customerName!: string;

  @IsString()
  @MinLength(2)
  @MaxLength(120)
  designation!: string;

  @IsBoolean()
  @Equals(true, { message: 'Receipt confirmation is required' })
  receiptConfirmed!: true;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  comments?: string;

  @IsOptional()
  @Transform(({ value }) =>
    value === '' || value === null || value === undefined ? undefined : Number(value),
  )
  @IsInt()
  @Min(1)
  @Max(5)
  satisfactionRating?: number;
}
