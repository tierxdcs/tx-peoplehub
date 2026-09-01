import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Role } from '@prisma/client';
import {
  AuthenticatedUser,
  CurrentUser,
} from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { RolesGuard } from '../../common/guards/roles.guard';
import { CustomerBomIntakeService } from './customer-bom-intake.service';
import {
  CustomerBomMatchDto,
  HandoverDesignBomDto,
} from './dto/customer-bom-intake.dto';

/**
 * The design team's door onto quote-stage BOM intakes: the queue of work Sales
 * has raised, and the handover of the parts list the design team authors for it.
 *
 * Routes under `design/` but implemented in the Sales module, because the intake
 * (and every rule about its lifecycle) lives here. Putting it in
 * DesignController would need Design → Sales, which cycles through
 * NotificationsModule; Sales → Design does not.
 *
 * Authorisation is design membership, applied in the service — the Sales owner
 * rule that guards every other intake route would refuse a designer outright.
 */
@ApiTags('design')
@ApiBearerAuth()
@UseGuards(RolesGuard)
@Roles(Role.MANAGER, Role.EMPLOYEE, Role.SUPER_ADMIN)
@Controller('design/bom-intakes')
export class DesignBomIntakeController {
  constructor(private readonly service: CustomerBomIntakeService) {}

  @Get()
  @ApiOperation({
    summary: 'Quote-stage intakes the design team has been asked to design',
  })
  queue(@CurrentUser() user: AuthenticatedUser) {
    return this.service.designQueue(user);
  }

  @Get(':id')
  detail(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.service.designIntake(id, user);
  }

  @Get(':id/file')
  @ApiOperation({
    summary:
      "Short-lived signed link to the customer's source document Sales attached",
  })
  fileUrl(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.service.designFileUrl(id, user);
  }

  @Post(':id/matches')
  @ApiOperation({
    summary: 'Fuzzy Item Master candidates; excludes all cost fields',
  })
  matches(
    @Body() dto: CustomerBomMatchDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.designMatches(dto.description, user);
  }

  @Post(':id/bom')
  @ApiOperation({
    summary:
      'Hand over the designed parts list: creates the BOM and releases the intake to SCM for RFQ',
  })
  handover(
    @Param('id') id: string,
    @Body() dto: HandoverDesignBomDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.handoverDesignBom(id, dto, user);
  }
}
