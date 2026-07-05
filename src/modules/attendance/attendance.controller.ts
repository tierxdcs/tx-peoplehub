import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiQuery,
  ApiTags,
} from '@nestjs/swagger';
import { Role } from '@prisma/client';
import {
  AuthenticatedUser,
  CurrentUser,
} from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { RolesGuard } from '../../common/guards/roles.guard';
import { PaginationQueryDto } from '../../common/dto/pagination.dto';
import { EmployeesService } from '../employees/employees.service';
import { CorrectAttendanceDto } from './dto/correct-attendance.dto';
import { AttendanceService } from './attendance.service';

const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

@ApiTags('attendance')
@ApiBearerAuth()
@UseGuards(RolesGuard)
@Controller('attendance')
export class AttendanceController {
  constructor(
    private readonly attendanceService: AttendanceService,
    private readonly employeesService: EmployeesService,
  ) {}

  @Post('check-in')
  @ApiOperation({ summary: 'Self check-in for today' })
  checkIn(@CurrentUser() user: AuthenticatedUser) {
    return this.attendanceService.checkIn(user.id);
  }

  @Post('check-out')
  @ApiOperation({ summary: 'Self check-out for today' })
  checkOut(@CurrentUser() user: AuthenticatedUser) {
    return this.attendanceService.checkOut(user.id);
  }

  @Get('me')
  @ApiOperation({ summary: 'Own attendance history' })
  getOwn(
    @Query() query: PaginationQueryDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.attendanceService.getOwn(user.id, query);
  }

  @Get('team')
  @Roles(Role.MANAGER)
  @ApiOperation({
    summary: 'Downstream team’s attendance (default: last 30 days)',
  })
  @ApiQuery({ name: 'from', required: false })
  @ApiQuery({ name: 'to', required: false })
  async getTeam(
    @CurrentUser() user: AuthenticatedUser,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    const team = await this.employeesService.getTeam(user.id, user);
    const teamIds = team.map((e) => e.id);
    const toDate = to ? new Date(to) : new Date();
    const fromDate = from
      ? new Date(from)
      : new Date(toDate.getTime() - THIRTY_DAYS_MS);
    return this.attendanceService.getForEmployees(teamIds, fromDate, toDate);
  }

  @Get(':employeeId/:date')
  @Roles(Role.ADMIN, Role.SUPER_ADMIN)
  @ApiOperation({
    summary:
      'Look up one employee’s attendance record for one date (null if none yet) — for the correction screen to pre-fill against',
  })
  getOne(@Param('employeeId') employeeId: string, @Param('date') date: string) {
    return this.attendanceService.getOne(employeeId, date);
  }

  @Patch(':employeeId/:date')
  @Roles(Role.ADMIN, Role.SUPER_ADMIN)
  @ApiOperation({
    summary:
      'Manually create/correct an attendance record for any employee on any date',
  })
  correct(
    @Param('employeeId') employeeId: string,
    @Param('date') date: string,
    @Body() dto: CorrectAttendanceDto,
  ) {
    return this.attendanceService.correct(employeeId, date, dto);
  }
}
