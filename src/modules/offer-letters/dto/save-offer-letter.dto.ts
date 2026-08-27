import { ApiProperty } from '@nestjs/swagger';
import { IsOptional, IsString, IsUUID } from 'class-validator';

export class SaveOfferLetterDto {
  @ApiProperty()
  @IsUUID()
  employeeId!: string;

  @ApiProperty({
    required: false,
    description:
      'Required when creating a new offer letter; omitted only for historical/existing-letter edits',
  })
  @IsOptional()
  @IsUUID()
  candidateRequisitionId?: string;

  @ApiProperty()
  @IsString()
  keyResponsibilities!: string;

  @ApiProperty()
  @IsString()
  kpis!: string;
}
