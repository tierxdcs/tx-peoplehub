import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import {
  AuthenticatedUser,
  CurrentUser,
} from '../../common/decorators/current-user.decorator';
import { PaginationQueryDto } from '../../common/dto/pagination.dto';
import {
  AcceptUnmatchedDto,
  CreateBankAccountDto,
  ImportBankStatementDto,
  MatchBankLineDto,
  OpeningBalanceImportDto,
  OperationsRangeDto,
  ProductionSettingsDto,
  RejectBankStatementDto,
} from './dto/operations.dto';
import { OperationsService } from './operations.service';

@ApiTags('finance-operations')
@ApiBearerAuth()
@Controller('finance/operations')
export class OperationsController {
  constructor(private readonly operations: OperationsService) {}
  @Get('production-readiness') readiness(@CurrentUser() u: AuthenticatedUser) {
    return this.operations.productionReadiness(u);
  }
  @Get('production-settings') productionSettings(@CurrentUser() u: AuthenticatedUser) {
    return this.operations.productionSettings(u);
  }
  @Patch('production-settings') saveProductionSettings(
    @Body() d: ProductionSettingsDto,
    @CurrentUser() u: AuthenticatedUser,
  ) { return this.operations.saveProductionSettings(d, u); }
  @Post('imports/opening-balances') openingBalances(
    @Body() d: OpeningBalanceImportDto,
    @CurrentUser() u: AuthenticatedUser,
  ) { return this.operations.importOpeningBalances(d, u); }
  @Get('imports') imports(@CurrentUser() u: AuthenticatedUser) {
    return this.operations.imports(u);
  }
  @Get('management-packs/:id/export.csv') packCsv(
    @Param('id') id: string,
    @CurrentUser() u: AuthenticatedUser,
  ) { return this.operations.managementPackCsv(id, u); }
  @Get('bank-accounts') bankAccounts(@CurrentUser() u: AuthenticatedUser) {
    return this.operations.bankAccounts(u);
  }
  @Post('bank-accounts') createBankAccount(
    @Body() d: CreateBankAccountDto,
    @CurrentUser() u: AuthenticatedUser,
  ) {
    return this.operations.createBankAccount(d, u);
  }
  @Get('statements') statements(
    @Query() q: PaginationQueryDto,
    @CurrentUser() u: AuthenticatedUser,
  ) {
    return this.operations.statements(q, u);
  }
  @Post('statements/import') importStatement(
    @Body() d: ImportBankStatementDto,
    @CurrentUser() u: AuthenticatedUser,
  ) {
    return this.operations.importStatement(d, u);
  }
  @Get('statements/:id') statement(
    @Param('id') id: string,
    @CurrentUser() u: AuthenticatedUser,
  ) {
    return this.operations.statement(id, u);
  }
  @Post('statements/:id/submit') submit(
    @Param('id') id: string,
    @CurrentUser() u: AuthenticatedUser,
  ) {
    return this.operations.submitStatement(id, u);
  }
  @Post('statements/:id/approve') approve(
    @Param('id') id: string,
    @CurrentUser() u: AuthenticatedUser,
  ) {
    return this.operations.approveStatement(id, u);
  }
  @Post('statements/:id/reject') reject(
    @Param('id') id: string,
    @Body() d: RejectBankStatementDto,
    @CurrentUser() u: AuthenticatedUser,
  ) {
    return this.operations.rejectStatement(id, d.comment, u);
  }
  @Get('statement-lines/:id/candidates') candidates(
    @Param('id') id: string,
    @CurrentUser() u: AuthenticatedUser,
  ) {
    return this.operations.candidates(id, u);
  }
  @Patch('statement-lines/:id/match') match(
    @Param('id') id: string,
    @Body() d: MatchBankLineDto,
    @CurrentUser() u: AuthenticatedUser,
  ) {
    return this.operations.matchLine(id, d, u);
  }
  @Patch('statement-lines/:id/confirm-suggestion') confirm(
    @Param('id') id: string,
    @CurrentUser() u: AuthenticatedUser,
  ) {
    return this.operations.confirmSuggestion(id, u);
  }
  @Patch('statement-lines/:id/accept-unmatched') unmatched(
    @Param('id') id: string,
    @Body() d: AcceptUnmatchedDto,
    @CurrentUser() u: AuthenticatedUser,
  ) {
    return this.operations.acceptUnmatched(id, d, u);
  }
  @Get('exports/:kind') exportData(
    @Param('kind') kind: string,
    @Query() q: OperationsRangeDto,
    @CurrentUser() u: AuthenticatedUser,
  ) {
    return this.operations.exportData(kind, q, u);
  }
  @Get('audit-pack') auditPack(
    @Query() q: OperationsRangeDto,
    @CurrentUser() u: AuthenticatedUser,
  ) {
    return this.operations.auditPack(q, u);
  }
}
