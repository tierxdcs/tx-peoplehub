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
import { Roles } from '../../common/decorators/roles.decorator';
import { RolesGuard } from '../../common/guards/roles.guard';
import { ExpenseCategoriesService } from './expense-categories.service';
import {
  CreateExpenseCategoryDto,
  UpdateExpenseCategoryDto,
} from './dto/expense-claims.dto';

/**
 * Expense-category administration (Admin / CEO). A settings surface for the
 * lookup that maps each category to the ledger its claim lines debit. Mirrors
 * the Milestone Template admin controller — RolesGuard is enforced here because
 * it is not registered globally.
 */
@ApiTags('expense-categories')
@ApiBearerAuth()
@UseGuards(RolesGuard)
@Roles(Role.ADMIN, Role.SUPER_ADMIN)
@Controller('expense-categories')
export class ExpenseCategoriesController {
  constructor(private readonly service: ExpenseCategoriesService) {}

  @Get()
  @ApiOperation({ summary: 'List all expense categories (Admin/CEO)' })
  list() {
    return this.service.list();
  }

  @Get('ledgers')
  @ApiOperation({
    summary: 'Expense-type ledger accounts a category may map to (Admin/CEO)',
  })
  ledgers() {
    return this.service.expenseLedgers();
  }

  @Post()
  @ApiOperation({ summary: 'Create an expense category (Admin/CEO)' })
  create(@Body() dto: CreateExpenseCategoryDto) {
    return this.service.create(dto);
  }

  @Patch(':id')
  @ApiOperation({
    summary: 'Edit / remap ledger / deactivate an expense category (Admin/CEO)',
  })
  update(@Param('id') id: string, @Body() dto: UpdateExpenseCategoryDto) {
    return this.service.update(id, dto);
  }
}
