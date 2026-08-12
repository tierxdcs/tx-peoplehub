import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsDateString,
  IsEnum,
  IsOptional,
  IsString,
  IsUUID,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { BidStrategyActionStatus, KickoffMeetingMode } from '@prisma/client';

export class BidStrategyAttendeeDto {
  @IsOptional() @IsUUID() employeeId?: string;
  @IsOptional() @IsString() @MinLength(1) externalName?: string;
}

export class BidStrategyActionItemDto {
  @IsString() @MinLength(1) description!: string;
  @IsUUID() ownerId!: string;
  @IsOptional() @IsDateString() dueDate?: string;
}

export class CreateBidStrategyMeetingDto {
  @IsDateString() meetingDate!: string;
  @IsEnum(KickoffMeetingMode) meetingMode!: KickoffMeetingMode;
  @IsOptional() @IsString() meetingLink?: string;
  @IsString() @MinLength(1) notes!: string;
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => BidStrategyAttendeeDto)
  attendees!: BidStrategyAttendeeDto[];
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => BidStrategyActionItemDto)
  actionItems?: BidStrategyActionItemDto[];
}

export class UpdateBidStrategyActionStatusDto {
  @IsEnum(BidStrategyActionStatus)
  status!: BidStrategyActionStatus;
}
