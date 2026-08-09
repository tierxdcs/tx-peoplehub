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
})
export class ScmResourcePlanModule {}
