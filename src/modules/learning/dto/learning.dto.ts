import {
  IsArray,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  MinLength,
} from 'class-validator';

export class CreateLearningCourseDto {
  @IsString() @MinLength(3) @MaxLength(160) title!: string;
  @IsString() @MinLength(3) @MaxLength(500) summary!: string;
  @IsUUID() verticalId!: string;
  @IsObject() content!: Record<string, unknown>;
}

export class UpdateLearningCourseDto {
  @IsOptional() @IsString() @MinLength(3) @MaxLength(160) title?: string;
  @IsOptional() @IsString() @MinLength(3) @MaxLength(500) summary?: string;
  @IsOptional() @IsObject() content?: Record<string, unknown>;
}

export class UpdateLearningProgressDto {
  @IsArray() @IsString({ each: true }) completedLessonKeys!: string[];
}
