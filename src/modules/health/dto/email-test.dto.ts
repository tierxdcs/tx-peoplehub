import { IsEmail, IsOptional, IsString, MaxLength } from 'class-validator';

export class EmailTestDto {
  /** Where to send the test message. */
  @IsEmail()
  to!: string;

  /** Optional note echoed in the body, to tell two test sends apart. */
  @IsOptional()
  @IsString()
  @MaxLength(200)
  note?: string;
}
