import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsOptional, IsString, MinLength } from 'class-validator';

export class CreateVerticalDto {
  @ApiProperty({ example: 'Sales' })
  @IsString()
  @MinLength(2)
  name!: string;

  @ApiProperty({ example: 'SALES' })
  @IsString()
  @MinLength(2)
  code!: string;

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
