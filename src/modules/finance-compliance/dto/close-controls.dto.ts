import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsIn, IsNotEmpty, IsOptional, IsString } from 'class-validator';

export class UpdateCloseTaskDto {
  @ApiProperty() @IsIn(['PENDING', 'COMPLETED', 'NOT_APPLICABLE']) status!: 'PENDING' | 'COMPLETED' | 'NOT_APPLICABLE';
  @ApiPropertyOptional() @IsOptional() @IsString() notes?: string;
}

export class ResolveExceptionDto {
  @ApiProperty() @IsIn(['RESOLVED', 'WAIVED']) status!: 'RESOLVED' | 'WAIVED';
  @ApiProperty() @IsString() @IsNotEmpty() resolutionNote!: string;
  @ApiPropertyOptional() @IsOptional() @IsString() assignedToId?: string;
}

export class AssignExceptionDto {
  @ApiProperty() @IsString() @IsNotEmpty() assignedToId!: string;
}
