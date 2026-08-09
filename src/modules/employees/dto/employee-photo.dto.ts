import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsString, Min, MinLength } from 'class-validator';

/**
 * Request a short-lived presigned PUT URL for an employee photo. Mirrors the
 * PLM progress-photo flow: the browser uploads the bytes directly to R2, the
 * backend only mints the URL and validates the declared name/type/size.
 */
export class EmployeePhotoUploadUrlDto {
  @ApiProperty({ example: 'jane.jpg' })
  @IsString()
  @MinLength(1)
  name!: string;

  @ApiProperty({ example: 'image/jpeg' })
  @IsString()
  @MinLength(1)
  mimeType!: string;

  @ApiProperty({ example: 204800 })
  @Type(() => Number)
  @IsInt()
  @Min(0)
  sizeBytes!: number;
}

/**
 * Set (or replace) an existing employee's photo with an already-uploaded R2
 * object. The `storageKey` must have been minted by the upload-url endpoint,
 * so it always lives under the `employees/photos/` prefix.
 */
export class SetEmployeePhotoDto {
  @ApiProperty({
    description: 'R2 object key returned by /employees/photo-upload-url',
  })
  @IsString()
  @MinLength(1)
  storageKey!: string;
}
