import { Module } from '@nestjs/common';
import { SalesModule } from '../sales/sales.module';
import { FinanceModule } from '../finance/finance.module';
import { VaultModule } from '../vault/vault.module';
import { ExpenseClaimsController } from './expense-claims.controller';
import { ExpenseCategoriesController } from './expense-categories.controller';
import { ExpenseClaimsService } from './expense-claims.service';
import { ExpenseCategoriesService } from './expense-categories.service';

/**
 * Employee Expense Claims. Reuses:
 *  - SalesModule → SalesNumberingService (EXP-YYYY-#### claim numbers)
 *  - FinanceModule → FinanceService.postJournalTx (GL posting) +
 *    FinanceAccessService (Accounts Head authority)
 *  - VaultModule → VaultStorageService (R2 presigned receipt uploads)
 */
@Module({
  imports: [SalesModule, FinanceModule, VaultModule],
  controllers: [ExpenseClaimsController, ExpenseCategoriesController],
  providers: [ExpenseClaimsService, ExpenseCategoriesService],
  exports: [ExpenseClaimsService, ExpenseCategoriesService],
})
export class ExpenseClaimsModule {}
