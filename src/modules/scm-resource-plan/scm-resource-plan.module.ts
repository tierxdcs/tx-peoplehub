import { Module } from '@nestjs/common';
import { BomModule } from '../bom/bom.module';
import { ScmResourcePlanAccessService } from './scm-resource-plan-access.service';
import { ScmResourcePlanService } from './scm-resource-plan.service';
import { ScmResourcePlanController } from './scm-resource-plan.controller';

/**
 * SCM Resource Planning Sheet. Imports BomModule to reuse ItemCostService
 * (benchmark cost + the amended cost-view gate) and the shared BOM explosion
 * (explodeBom is imported directly as a pure function). No second explosion or
 * cost implementation lives here.
 */
@Module({
  imports: [BomModule],
  controllers: [ScmResourcePlanController],
  providers: [ScmResourcePlanAccessService, ScmResourcePlanService],
  // Exported so the executive SCM dashboard reads this module's own
  // cross-project variance — including its own cost-view gate — instead of
  // carrying a second copy of the benchmark-vs-negotiated arithmetic.
  exports: [ScmResourcePlanService],
})
export class ScmResourcePlanModule {}
