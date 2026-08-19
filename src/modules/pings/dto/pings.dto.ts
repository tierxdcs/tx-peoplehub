import { ArrayMaxSize, ArrayMinSize, IsArray, IsEnum, IsOptional, IsString, MaxLength } from 'class-validator';
import { PingRecipientStatus } from '@prisma/client';

export class CreatePingDto {
  @IsString()
  @MaxLength(500)
  message!: string;

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(50)
  @IsString({ each: true })
  recipientIds!: string[];

  @IsOptional()
  @IsString()
  @MaxLength(60)
  linkedRecordType?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  linkedRecordId?: string;
}

export class UpdatePingStatusDto {
  @IsEnum(PingRecipientStatus)
  status!: PingRecipientStatus;
}

export class CreateContextualPingDto extends CreatePingDto {
  @IsOptional()
  @IsString()
  @MaxLength(40)
  verticalCode?: string;
}
