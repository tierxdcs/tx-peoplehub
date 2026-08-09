import { Module } from '@nestjs/common';
import { MilestoneTemplateController } from './milestone-template.controller';
import { MilestoneTemplateService } from './milestone-template.service';

/**
 * Admin-managed catalogue of standard milestones per delivery flow type. The
 * catalogue drives the kickoff milestone dropdown (union by the order lines'
 * delivery types). ProjectKickoff reads the templates directly via Prisma, so
 * nothing needs to be exported here.
 */
@Module({
  controllers: [MilestoneTemplateController],
  providers: [MilestoneTemplateService],
})
export class MilestoneTemplateModule {}
