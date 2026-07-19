import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import {
  AuthenticatedUser,
  CurrentUser,
} from '../../common/decorators/current-user.decorator';
import {
  ApplyAdvanceDto,
  CreateFxRunDto,
  CreditControlDto,
  CreditOverrideDto,
  FxSettingsDto,
  ReverseFxDto,
} from './dto/treasury.dto';
import { TreasuryService } from './treasury.service';
@ApiTags('finance-treasury')
@ApiBearerAuth()
@Controller('finance/treasury')
export class TreasuryController {
  constructor(private readonly s: TreasuryService) {}
  @Get() dashboard(@CurrentUser() u: AuthenticatedUser) {
    return this.s.dashboard(u);
  }
  @Post('fx-settings') settings(
    @Body() d: FxSettingsDto,
    @CurrentUser() u: AuthenticatedUser,
  ) {
    return this.s.saveFxSettings(d, u);
  }
  @Post('credit-controls') credit(
    @Body() d: CreditControlDto,
    @CurrentUser() u: AuthenticatedUser,
  ) {
    return this.s.saveCreditControl(d, u);
  }
  @Get('credit-controls/:customerId/exposure') exposure(
    @Param('customerId') id: string,
    @CurrentUser() u: AuthenticatedUser,
  ) {
    return this.s.creditExposure(id, u);
  }
  @Post('invoices/:id/credit-override') override(
    @Param('id') id: string,
    @Body() d: CreditOverrideDto,
    @CurrentUser() u: AuthenticatedUser,
  ) {
    return this.s.overrideInvoice(id, d.reason, u);
  }
  @Post('fx-runs') fx(
    @Body() d: CreateFxRunDto,
    @CurrentUser() u: AuthenticatedUser,
  ) {
    return this.s.createFxRun(d, u);
  }
  @Post('fx-runs/:id/submit') submit(
    @Param('id') id: string,
    @CurrentUser() u: AuthenticatedUser,
  ) {
    return this.s.submitFx(id, u);
  }
  @Post('fx-runs/:id/approve') approve(
    @Param('id') id: string,
    @CurrentUser() u: AuthenticatedUser,
  ) {
    return this.s.approveFx(id, u);
  }
  @Post('fx-runs/:id/reverse') reverse(
    @Param('id') id: string,
    @Body() d: ReverseFxDto,
    @CurrentUser() u: AuthenticatedUser,
  ) {
    return this.s.reverseFx(id, d, u);
  }
  @Post('advances/apply') advance(
    @Body() d: ApplyAdvanceDto,
    @CurrentUser() u: AuthenticatedUser,
  ) {
    return this.s.applyAdvance(d, u);
  }
}
