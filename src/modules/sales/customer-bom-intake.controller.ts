import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
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
import { CustomerBomIntakeService } from './customer-bom-intake.service';
import {
  CreateCustomerBomIntakeDto,
  CustomerBomMatchDto,
  CustomerBomUploadUrlDto,
  ReviseCustomerBomIntakeDto,
  SendBomIntakeToDesignDto,
  UpdateCustomerBomIntakeDto,
} from './dto/customer-bom-intake.dto';

@ApiTags('customer-bom-intake')
@ApiBearerAuth()
@UseGuards(RolesGuard)
@Roles(Role.MANAGER, Role.EMPLOYEE, Role.SUPER_ADMIN)
@Controller('opportunities/:opportunityId/customer-bom-intakes')
export class CustomerBomIntakeController {
  constructor(private readonly service: CustomerBomIntakeService) {}

  @Get()
  list(
    @Param('opportunityId') opportunityId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.list(opportunityId, user);
  }

  @Post('matches')
  @ApiOperation({
    summary: 'Fuzzy Item Master candidates; excludes all cost fields',
  })
  matches(
    @Body() dto: CustomerBomMatchDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.matches(dto.description, user);
  }

  @Post('upload-url')
  uploadUrl(
    @Body() dto: CustomerBomUploadUrlDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.uploadUrl(dto, user);
  }

  @Post()
  create(
    @Param('opportunityId') opportunityId: string,
    @Body() dto: CreateCustomerBomIntakeDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.create(opportunityId, dto, user);
  }
}

/**
 * Opportunity-independent surface: the "Open BOM Intake" register and per-
 * intake detail/revision. Same guards and service as the nested controller —
 * ownership scoping happens in the service (visibleOwnerIds / owner check).
 */
@ApiTags('customer-bom-intake')
@ApiBearerAuth()
@UseGuards(RolesGuard)
@Roles(Role.MANAGER, Role.EMPLOYEE, Role.SUPER_ADMIN)
@Controller('customer-bom-intakes')
export class CustomerBomIntakeRegisterController {
  constructor(private readonly service: CustomerBomIntakeService) {}

  @Get()
  register(@CurrentUser() user: AuthenticatedUser) {
    return this.service.register(user);
  }

  @Get(':id')
  detail(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.service.detail(id, user);
  }

  @Get(':id/file')
  @ApiOperation({
    summary:
      "Short-lived signed link to the customer's uploaded source document (404 when none is attached)",
  })
  fileUrl(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.service.fileUrl(id, user);
  }

  @Patch(':id')
  @ApiOperation({
    summary:
      'Set or clear the date Sales promised the customer a price (drives the register progress bar)',
  })
  setExpectedBy(
    @Param('id') id: string,
    @Body() dto: UpdateCustomerBomIntakeDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.setExpectedBy(id, dto, user);
  }

  @Post(':id/revise')
  @ApiOperation({
    summary:
      'Sales quote-stage revision of a DRAFT intake BOM (new Bom revision row; blocked once RELEASED)',
  })
  revise(
    @Param('id') id: string,
    @Body() dto: ReviseCustomerBomIntakeDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.revise(id, dto, user);
  }

  @Post(':id/send-to-design')
  @ApiOperation({
    summary:
      'Raise a design request for an intake whose parts list has to be designed first (DESIGN_PENDING only)',
  })
  sendToDesign(
    @Param('id') id: string,
    @Body() dto: SendBomIntakeToDesignDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.sendToDesign(id, dto, user);
  }

  @Post(':id/submit')
  @ApiOperation({
    summary:
      'Sales submits the intake BOM for R&D Head release approval (owner-scoped, not the R&D-vertical rule)',
  })
  submitForApproval(
    @Param('id') id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.submitForApproval(id, user);
  }
}
