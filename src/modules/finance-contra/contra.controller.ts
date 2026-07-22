import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  AuthenticatedUser,
  CurrentUser,
} from '../../common/decorators/current-user.decorator';
import { PaginationQueryDto } from '../../common/dto/pagination.dto';
import { ContraService } from './contra.service';
import { CreateContraVoucherDto, RejectContraVoucherDto } from './dto/contra.dto';

@ApiTags('finance-contra')
@ApiBearerAuth()
@Controller('finance/contra')
export class ContraController {
  constructor(private readonly contra: ContraService) {}

  @Post()
  @ApiOperation({ summary: 'Create a draft contra voucher (bank/cash transfer)' })
  create(@Body() dto: CreateContraVoucherDto, @CurrentUser() user: AuthenticatedUser) {
    return this.contra.create(dto, user);
  }

  @Get()
  list(@Query() query: PaginationQueryDto, @CurrentUser() user: AuthenticatedUser) {
    return this.contra.list(query, user);
  }

  @Get(':id')
  findOne(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.contra.findOne(id, user);
  }

  @Post(':id/submit')
  submit(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.contra.submit(id, user);
  }

  @Post(':id/approve')
  @ApiOperation({ summary: 'Approve and post — creates the balanced journal via postJournalTx' })
  approve(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.contra.approve(id, user);
  }

  @Post(':id/reject')
  reject(
    @Param('id') id: string,
    @Body() dto: RejectContraVoucherDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.contra.reject(id, dto.comment, user);
  }
}
