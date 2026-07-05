import { PartialType, OmitType } from '@nestjs/swagger';
import { CreateEmployeeDto } from './create-employee.dto';

/**
 * All CreateEmployeeDto fields optional, except password which has its own
 * dedicated flow (not updated here).
 */
export class UpdateEmployeeDto extends PartialType(
  OmitType(CreateEmployeeDto, ['password'] as const),
) {}
