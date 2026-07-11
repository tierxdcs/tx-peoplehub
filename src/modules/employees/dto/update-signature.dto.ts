import { ApiProperty } from '@nestjs/swagger';
import { SignatureFont } from '@prisma/client';
import { IsEnum, IsString, MaxLength, MinLength } from 'class-validator';

/**
 * Self-service internal e-signature. Both fields required together — a
 * signature is text + a font. To clear a signature, a future endpoint could
 * accept nulls; for now setting one always provides both.
 */
export class UpdateSignatureDto {
  @ApiProperty({ example: 'Jane Doe' })
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  signatureText!: string;

  @ApiProperty({ enum: SignatureFont })
  @IsEnum(SignatureFont)
  signatureFont!: SignatureFont;
}
