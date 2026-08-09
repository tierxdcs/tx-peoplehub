import { Controller, Get } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ReferenceRatesService } from './reference-rates.service';

@ApiTags('reference-rates')
@ApiBearerAuth()
@Controller('reference-rates')
export class ReferenceRatesController {
  constructor(private readonly service: ReferenceRatesService) {}

  @Get()
  @ApiOperation({ summary: 'Cached informational INR reference rates' })
  getRates() {
    return this.service.getSnapshot();
  }
}
