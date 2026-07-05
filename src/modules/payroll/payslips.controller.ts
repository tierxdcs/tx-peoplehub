import { Controller, Get, Param, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  AuthenticatedUser,
  CurrentUser,
} from '../../common/decorators/current-user.decorator';
import { PaginationQueryDto } from '../../common/dto/pagination.dto';
import { PayslipsService } from './payslips.service';

/** Route order: /me must precede :id so it isn't swallowed by the param route. */
@ApiTags('payslips')
@ApiBearerAuth()
@Controller('payslips')
export class PayslipsController {
  constructor(private readonly payslipsService: PayslipsService) {}

  @Get('me')
  @ApiOperation({ summary: 'Own payslip history' })
  getOwn(
    @Query() query: PaginationQueryDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.payslipsService.getOwn(user.id, query);
  }

  @Get(':id')
  @ApiOperation({ summary: 'View one payslip (self or admin)' })
  findOne(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.payslipsService.findOne(id, user);
  }
}
