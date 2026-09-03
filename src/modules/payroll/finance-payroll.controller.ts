import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  AuthenticatedUser,
  CurrentUser,
} from '../../common/decorators/current-user.decorator';
import { PayrollRunsService } from './payroll-runs.service';

@ApiTags('finance-payroll')
@ApiBearerAuth()
@Controller('finance/payroll')
export class FinancePayrollController {
  constructor(private readonly runs: PayrollRunsService) {}

  @Get()
  @ApiOperation({
    summary: 'Payroll runs handed to Accounts, with control totals',
  })
  list(@CurrentUser() user: AuthenticatedUser) {
    return this.runs.accountsQueue(user);
  }

  @Post(':id/approve')
  @ApiOperation({
    summary: 'Finance Head approves payroll and posts its accrual journal',
  })
  approve(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.runs.approve(id, user);
  }

  @Post(':id/execute')
  @ApiOperation({
    summary: 'Execute salary payment, post bank journal and mark payslips paid',
  })
  execute(
    @Param('id') id: string,
    @Body() body: { bankReference: string },
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.runs.executePayment(id, body.bankReference, user);
  }
}
