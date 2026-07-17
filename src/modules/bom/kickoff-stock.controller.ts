import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Role } from '@prisma/client';
import {
  AuthenticatedUser,
  CurrentUser,
} from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { RolesGuard } from '../../common/guards/roles.guard';
import { StockReportService } from './stock-report.service';
import { CreateReservationDto } from './dto/bom.dto';

/**
 * Kickoff stock-availability + reservations (§7–9). Mounted on the project
 * kickoff resource. The report identifies shortages but never blocks the
 * kickoff. Reservations require Store access (enforced in the service).
 */
@ApiTags('project-kickoffs')
@ApiBearerAuth()
@UseGuards(RolesGuard)
@Roles(Role.MANAGER, Role.EMPLOYEE, Role.ADMIN, Role.SUPER_ADMIN)
@Controller('project-kickoffs/:id')
export class KickoffStockController {
  constructor(private readonly service: StockReportService) {}

  @Post('stock-availability/generate')
  @ApiOperation({
    summary:
      'Snapshot released BOMs + generate the stock-availability report (first call snapshots; idempotent thereafter)',
  })
  generate(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.service.generate(id, user);
  }

  @Get('stock-availability')
  @ApiOperation({ summary: 'Get the stock-availability report (null if not generated)' })
  get(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.service.read(id, user);
  }

  @Get('reservations')
  @ApiOperation({ summary: 'List reservations for this kickoff' })
  listReservations(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.service.listReservations(id, user);
  }

  @Post('reservations')
  @ApiOperation({ summary: 'Reserve material for this kickoff (Store/SA)' })
  createReservation(
    @Param('id') id: string,
    @Body() dto: CreateReservationDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.createReservation(id, dto, user);
  }

  @Delete('reservations/:reservationId')
  @HttpCode(204)
  @ApiOperation({ summary: 'Cancel a reservation (Store/SA)' })
  async cancelReservation(
    @Param('id') id: string,
    @Param('reservationId') reservationId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    await this.service.cancelReservation(id, reservationId, user);
  }
}
