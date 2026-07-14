import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Role } from '@prisma/client';
import {
  CurrentUser,
  AuthenticatedUser,
} from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { RolesGuard } from '../../common/guards/roles.guard';
import { PaginationQueryDto } from '../../common/dto/pagination.dto';
import { CreateEmployeeDto } from './dto/create-employee.dto';
import { UpdateEmployeeDto } from './dto/update-employee.dto';
import { OnboardEmployeeDto } from './dto/onboard-employee.dto';
import { GrantAccessDto } from './dto/grant-access.dto';
import { UpdateSignatureDto } from './dto/update-signature.dto';
import { RosterQueryDto } from './dto/roster-query.dto';
import { EmployeeSearchQueryDto } from './dto/employee-search-query.dto';
import { EmployeesService } from './employees.service';

/**
 * Reference module controller for the access-control backbone. Guarded
 * globally by JwtAuthGuard; RolesGuard + @Roles(...) restricts management to
 * admins. Copy this shape for future ERP modules (Sales, HR, Production, ...).
 *
 * Route order matters: /onboard, /roster, /pending-access must be declared
 * before @Get(':id')/@Patch(':id') so they aren't swallowed by the :id param.
 */
@ApiTags('employees')
@ApiBearerAuth()
@UseGuards(RolesGuard)
@Controller('employees')
export class EmployeesController {
  constructor(private readonly employeesService: EmployeesService) {}

  @Post('onboard')
  @Roles(Role.MANAGER, Role.EMPLOYEE, Role.ADMIN, Role.SUPER_ADMIN)
  @ApiOperation({
    summary:
      'HR onboarding (step 1 of 2): create the personnel record. Role/login are not set yet.',
  })
  onboard(
    @Body() dto: OnboardEmployeeDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.employeesService.onboard(dto, user);
  }

  @Get('roster')
  @Roles(Role.MANAGER, Role.EMPLOYEE, Role.ADMIN, Role.SUPER_ADMIN)
  @ApiOperation({
    summary: 'Company-wide employee roster, shaped by caller role',
  })
  getRoster(
    @Query() query: RosterQueryDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.employeesService.getRoster(query, user);
  }

  @Get('search')
  @Roles(Role.MANAGER, Role.EMPLOYEE, Role.ADMIN, Role.SUPER_ADMIN)
  @ApiOperation({
    summary:
      'Type-ahead employee search (name/email) for pickers — lean shape, all roles',
  })
  search(@Query() query: EmployeeSearchQueryDto) {
    const limit = query.limit ? parseInt(query.limit, 10) : undefined;
    return this.employeesService.search(
      query.q,
      Number.isFinite(limit) ? limit : undefined,
    );
  }

  @Get('pending-access')
  @Roles(Role.ADMIN, Role.SUPER_ADMIN)
  @ApiOperation({ summary: 'Employees awaiting an access grant' })
  getPendingAccess(@Query() query: PaginationQueryDto) {
    return this.employeesService.getPendingAccess(query);
  }

  // Static route — declared before @Patch(':id') so 'me' isn't swallowed by
  // the :id param. Every authenticated employee sets their OWN signature.
  @Patch('me/signature')
  @Roles(Role.MANAGER, Role.EMPLOYEE, Role.ADMIN, Role.SUPER_ADMIN)
  @ApiOperation({
    summary: 'Set/change your own internal e-signature (self-service)',
  })
  updateOwnSignature(
    @Body() dto: UpdateSignatureDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.employeesService.updateOwnSignature(user.id, dto);
  }

  @Post()
  @Roles(Role.ADMIN, Role.SUPER_ADMIN)
  @ApiOperation({ summary: 'Create an employee' })
  create(@Body() dto: CreateEmployeeDto) {
    return this.employeesService.create(dto);
  }

  @Get()
  @Roles(Role.ADMIN, Role.SUPER_ADMIN)
  @ApiOperation({ summary: 'List employees (paginated)' })
  findAll(@Query() query: PaginationQueryDto) {
    return this.employeesService.findAll(query);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get an employee by id (self or admin)' })
  findOne(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.employeesService.findOne(id, user);
  }

  @Patch(':id')
  @Roles(Role.ADMIN, Role.SUPER_ADMIN)
  @ApiOperation({ summary: 'Update an employee' })
  update(@Param('id') id: string, @Body() dto: UpdateEmployeeDto) {
    return this.employeesService.update(id, dto);
  }

  @Patch(':id/deactivate')
  @Roles(Role.ADMIN, Role.SUPER_ADMIN)
  @ApiOperation({ summary: 'Deactivate an employee (soft delete)' })
  deactivate(@Param('id') id: string) {
    return this.employeesService.deactivate(id);
  }

  @Patch(':id/reactivate')
  @Roles(Role.ADMIN, Role.SUPER_ADMIN)
  @ApiOperation({
    summary:
      'Reactivate a deactivated employee — restores login with existing role/vertical/manager (not a re-hire)',
  })
  reactivate(@Param('id') id: string) {
    return this.employeesService.reactivate(id);
  }

  @Delete(':id')
  @Roles(Role.SUPER_ADMIN)
  @HttpCode(204)
  @ApiOperation({
    summary:
      'Permanently delete an employee (SUPER_ADMIN only) — refused if they still own reports or business records; deactivate instead',
  })
  async remove(
    @Param('id') id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    await this.employeesService.hardDelete(id, user);
  }

  @Patch(':id/grant-access')
  @Roles(Role.ADMIN, Role.SUPER_ADMIN)
  @ApiOperation({
    summary:
      'Admin grant-access (step 2 of 2): assign role/vertical, set password, activate login',
  })
  grantAccess(@Param('id') id: string, @Body() dto: GrantAccessDto) {
    return this.employeesService.grantAccess(id, dto);
  }

  @Patch(':id/designate-sales-head')
  @Roles(Role.ADMIN, Role.SUPER_ADMIN)
  @ApiOperation({
    summary:
      'Designate this employee as the Sales Head (unsets any previous holder atomically)',
  })
  designateSalesHead(@Param('id') id: string) {
    return this.employeesService.designateSalesHead(id);
  }

  @Patch(':id/designate-scrum-master')
  @Roles(Role.ADMIN, Role.SUPER_ADMIN)
  @ApiOperation({
    summary: 'Designate this employee as a Scrum Master (multiple allowed)',
  })
  designateScrumMaster(@Param('id') id: string) {
    return this.employeesService.setScrumMaster(id, true);
  }

  @Patch(':id/revoke-scrum-master')
  @Roles(Role.ADMIN, Role.SUPER_ADMIN)
  @ApiOperation({ summary: 'Revoke this employee’s Scrum Master designation' })
  revokeScrumMaster(@Param('id') id: string) {
    return this.employeesService.setScrumMaster(id, false);
  }

  @Get(':id/team')
  @Roles(Role.MANAGER, Role.ADMIN, Role.SUPER_ADMIN)
  @ApiOperation({
    summary: 'List every downstream report (direct and indirect) of a manager',
  })
  getTeam(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.employeesService.getTeam(id, user);
  }

  @Get(':id/compensation')
  @Roles(Role.ADMIN, Role.SUPER_ADMIN)
  @ApiOperation({ summary: 'View salary/HRA (Admin only)' })
  getCompensation(@Param('id') id: string) {
    return this.employeesService.getCompensation(id);
  }

  @Get(':id/statutory')
  @Roles(Role.ADMIN, Role.SUPER_ADMIN)
  @ApiOperation({ summary: 'View PAN/PF/ESIC (Admin only, decrypted)' })
  getStatutory(@Param('id') id: string) {
    return this.employeesService.getStatutory(id);
  }

  @Get(':id/bank-details')
  @Roles(Role.ADMIN, Role.SUPER_ADMIN)
  @ApiOperation({ summary: 'View bank details (Admin only, decrypted)' })
  getBankDetails(@Param('id') id: string) {
    return this.employeesService.getBankDetails(id);
  }
}
