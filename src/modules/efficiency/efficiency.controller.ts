import { Controller, Get } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { AuthenticatedUser, CurrentUser } from '../../common/decorators/current-user.decorator';
import { EfficiencyService } from './efficiency.service';

@ApiTags('dashboard')
@ApiBearerAuth()
@Controller('dashboard/efficiency')
export class EfficiencyController {
  constructor(private readonly service: EfficiencyService) {}

  @Get()
  mine(@CurrentUser() user: AuthenticatedUser) {
    // Deliberately no employee-id parameter: this score can only be fetched by
    // the authenticated individual for themselves.
    return this.service.mine(user.id);
  }
}
