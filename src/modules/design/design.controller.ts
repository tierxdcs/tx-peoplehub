import { Body, Controller, Get, Param, Patch, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import {
  AuthenticatedUser,
  CurrentUser,
} from '../../common/decorators/current-user.decorator';
import { DesignService } from './design.service';
import {
  AcknowledgeDesignChangeDto,
  AcknowledgeDesignTransmittalDto,
  AddDesignReviewActionDto,
  AddDesignReviewAttendeeDto,
  AddDesignChangeAcknowledgementDto,
  AddDesignChangeAffectedItemDto,
  AssignDesignChangeImpactDto,
  CheckDesignRevisionDto,
  CloseDesignChangeDto,
  CompleteDesignReviewActionDto,
  CompleteDesignChangeImpactDto,
  CreateDesignChangeDto,
  CreateDesignDocumentDto,
  CreateDesignMilestoneDto,
  CreateDesignProjectDto,
  CreateDesignRequestDto,
  CreateDesignReviewDto,
  CreateDesignRevisionDto,
  CreateDesignRequirementDto,
  CreateDesignProjectTemplateDto,
  CreateDesignTransmittalDto,
  ApplyDesignProjectTemplateDto,
  GenerateDesignChangeReportDto,
  RecordCustomerApprovalDto,
  RecordDesignReviewDto,
  RejectDesignRevisionDto,
  DesignChangeDecisionDto,
  UpdateDesignChangeDispositionDto,
  UpdateDesignProjectStatusDto,
  UpdateDesignMilestoneDto,
  ReviseDesignChangeReportDto,
  SignDesignChangeReportCustomerDto,
  VerifyDesignRequirementDto,
} from './dto/design.dto';
@ApiTags('design')
@ApiBearerAuth()
@Controller('design')
export class DesignController {
  constructor(private readonly s: DesignService) {}
  @Get('access') access(@CurrentUser() u: AuthenticatedUser) {
    return this.s.accessInfo(u);
  }
  @Get('dashboard') dashboard(@CurrentUser() u: AuthenticatedUser) {
    return this.s.dashboard(u);
  }
  @Get('references/employees') employees(@CurrentUser() u: AuthenticatedUser) {
    return this.s.employees(u);
  }
  @Get('references/vault-files') vaultFiles(
    @CurrentUser() u: AuthenticatedUser,
  ) {
    return this.s.vaultFiles(u);
  }
  @Get('requests') requests(@CurrentUser() u: AuthenticatedUser) {
    return this.s.requests(u);
  }
  @Post('requests') createRequest(
    @Body() d: CreateDesignRequestDto,
    @CurrentUser() u: AuthenticatedUser,
  ) {
    return this.s.createRequest(d, u);
  }
  @Get('projects') projects(@CurrentUser() u: AuthenticatedUser) {
    return this.s.projects(u);
  }
  @Get('projects/:id') project(
    @Param('id') id: string,
    @CurrentUser() u: AuthenticatedUser,
  ) {
    return this.s.project(id, u);
  }
  @Post('projects') createProject(
    @Body() d: CreateDesignProjectDto,
    @CurrentUser() u: AuthenticatedUser,
  ) {
    return this.s.createProject(d, u);
  }
  @Patch('projects/:id/status') status(
    @Param('id') id: string,
    @Body() d: UpdateDesignProjectStatusDto,
    @CurrentUser() u: AuthenticatedUser,
  ) {
    return this.s.updateProjectStatus(id, d.status, u);
  }
  @Get('documents') documents(@CurrentUser() u: AuthenticatedUser) {
    return this.s.documents(u);
  }
  @Post('documents') createDocument(
    @Body() d: CreateDesignDocumentDto,
    @CurrentUser() u: AuthenticatedUser,
  ) {
    return this.s.createDocument(d, u);
  }
  @Post('documents/:id/revisions') createRevision(
    @Param('id') id: string,
    @Body() d: CreateDesignRevisionDto,
    @CurrentUser() u: AuthenticatedUser,
  ) {
    return this.s.createRevision(id, d, u);
  }
  @Post('revisions/:id/submit') submit(
    @Param('id') id: string,
    @CurrentUser() u: AuthenticatedUser,
  ) {
    return this.s.submitRevision(id, u);
  }
  @Post('revisions/:id/check') check(
    @Param('id') id: string,
    @Body() d: CheckDesignRevisionDto,
    @CurrentUser() u: AuthenticatedUser,
  ) {
    return this.s.checkRevision(id, d, u);
  }
  @Post('revisions/:id/release') release(
    @Param('id') id: string,
    @CurrentUser() u: AuthenticatedUser,
  ) {
    return this.s.releaseRevision(id, u);
  }
  @Post('revisions/:id/reject') reject(
    @Param('id') id: string,
    @Body() d: RejectDesignRevisionDto,
    @CurrentUser() u: AuthenticatedUser,
  ) {
    return this.s.rejectRevision(id, d, u);
  }
  @Post('requirements') createRequirement(
    @Body() d: CreateDesignRequirementDto,
    @CurrentUser() u: AuthenticatedUser,
  ) {
    return this.s.createRequirement(d, u);
  }
  @Post('requirements/:id/verify') verifyRequirement(
    @Param('id') id: string,
    @Body() d: VerifyDesignRequirementDto,
    @CurrentUser() u: AuthenticatedUser,
  ) {
    return this.s.verifyRequirement(id, d, u);
  }
  @Post('milestones') createMilestone(
    @Body() d: CreateDesignMilestoneDto,
    @CurrentUser() u: AuthenticatedUser,
  ) {
    return this.s.createMilestone(d, u);
  }
  @Patch('milestones/:id') updateMilestone(
    @Param('id') id: string,
    @Body() d: UpdateDesignMilestoneDto,
    @CurrentUser() u: AuthenticatedUser,
  ) {
    return this.s.updateMilestone(id, d, u);
  }
  @Post('revisions/:id/customer-approval') customerApproval(
    @Param('id') id: string,
    @Body() d: RecordCustomerApprovalDto,
    @CurrentUser() u: AuthenticatedUser,
  ) {
    return this.s.recordCustomerApproval(id, d, u);
  }
  @Get('changes') changes(@CurrentUser() u: AuthenticatedUser) {
    return this.s.changes(u);
  }
  @Get('changes/:id') change(
    @Param('id') id: string,
    @CurrentUser() u: AuthenticatedUser,
  ) {
    return this.s.change(id, u);
  }
  @Post('changes') createChange(
    @Body() d: CreateDesignChangeDto,
    @CurrentUser() u: AuthenticatedUser,
  ) {
    return this.s.createChange(d, u);
  }
  @Post('changes/:id/affected-items') addAffectedItem(
    @Param('id') id: string,
    @Body() d: AddDesignChangeAffectedItemDto,
    @CurrentUser() u: AuthenticatedUser,
  ) {
    return this.s.addAffectedItem(id, d, u);
  }
  @Patch('change-affected-items/:id/disposition') disposition(
    @Param('id') id: string,
    @Body() d: UpdateDesignChangeDispositionDto,
    @CurrentUser() u: AuthenticatedUser,
  ) {
    return this.s.updateDisposition(id, d, u);
  }
  @Patch('change-impacts/:id/owner') assignImpact(
    @Param('id') id: string,
    @Body() d: AssignDesignChangeImpactDto,
    @CurrentUser() u: AuthenticatedUser,
  ) {
    return this.s.assignImpact(id, d, u);
  }
  @Post('changes/:id/submit') submitChange(
    @Param('id') id: string,
    @CurrentUser() u: AuthenticatedUser,
  ) {
    return this.s.submitChange(id, u);
  }
  @Post('change-impacts/:id/complete') completeImpact(
    @Param('id') id: string,
    @Body() d: CompleteDesignChangeImpactDto,
    @CurrentUser() u: AuthenticatedUser,
  ) {
    return this.s.completeImpact(id, d, u);
  }
  @Post('changes/:id/acknowledgements') addAcknowledgement(
    @Param('id') id: string,
    @Body() d: AddDesignChangeAcknowledgementDto,
    @CurrentUser() u: AuthenticatedUser,
  ) {
    return this.s.addAcknowledgement(id, d, u);
  }
  @Post('changes/:id/submit-approval') submitChangeApproval(
    @Param('id') id: string,
    @CurrentUser() u: AuthenticatedUser,
  ) {
    return this.s.submitChangeApproval(id, u);
  }
  @Post('changes/:id/approve') approveChange(
    @Param('id') id: string,
    @CurrentUser() u: AuthenticatedUser,
  ) {
    return this.s.approveChange(id, u);
  }
  @Post('changes/:id/reject') rejectChange(
    @Param('id') id: string,
    @Body() d: DesignChangeDecisionDto,
    @CurrentUser() u: AuthenticatedUser,
  ) {
    return this.s.rejectChange(id, d.reason, u);
  }
  @Post('changes/:id/start-implementation') startImplementation(
    @Param('id') id: string,
    @CurrentUser() u: AuthenticatedUser,
  ) {
    return this.s.startChangeImplementation(id, u);
  }
  @Post('change-acknowledgements/:id/acknowledge') acknowledge(
    @Param('id') id: string,
    @Body() d: AcknowledgeDesignChangeDto,
    @CurrentUser() u: AuthenticatedUser,
  ) {
    return this.s.acknowledgeChange(id, d, u);
  }
  @Post('changes/:id/close') closeChange(
    @Param('id') id: string,
    @Body() d: CloseDesignChangeDto,
    @CurrentUser() u: AuthenticatedUser,
  ) {
    return this.s.closeChange(id, d, u);
  }
  @Get('reviews') reviews(@CurrentUser() u: AuthenticatedUser) {
    return this.s.reviews(u);
  }
  @Get('reviews/:id') review(
    @Param('id') id: string,
    @CurrentUser() u: AuthenticatedUser,
  ) {
    return this.s.review(id, u);
  }
  @Post('reviews') createReview(
    @Body() d: CreateDesignReviewDto,
    @CurrentUser() u: AuthenticatedUser,
  ) {
    return this.s.createReview(d, u);
  }
  @Post('reviews/:id/attendees') addReviewAttendee(
    @Param('id') id: string,
    @Body() d: AddDesignReviewAttendeeDto,
    @CurrentUser() u: AuthenticatedUser,
  ) {
    return this.s.addReviewAttendee(id, d, u);
  }
  @Post('reviews/:id/start') startReview(
    @Param('id') id: string,
    @CurrentUser() u: AuthenticatedUser,
  ) {
    return this.s.startReview(id, u);
  }
  @Post('reviews/:id/record') recordReview(
    @Param('id') id: string,
    @Body() d: RecordDesignReviewDto,
    @CurrentUser() u: AuthenticatedUser,
  ) {
    return this.s.recordReview(id, d, u);
  }
  @Post('reviews/:id/actions') addReviewAction(
    @Param('id') id: string,
    @Body() d: AddDesignReviewActionDto,
    @CurrentUser() u: AuthenticatedUser,
  ) {
    return this.s.addReviewAction(id, d, u);
  }
  @Post('review-actions/:id/complete') completeReviewAction(
    @Param('id') id: string,
    @Body() d: CompleteDesignReviewActionDto,
    @CurrentUser() u: AuthenticatedUser,
  ) {
    return this.s.completeReviewAction(id, d, u);
  }
  @Post('review-actions/:id/verify') verifyReviewAction(
    @Param('id') id: string,
    @CurrentUser() u: AuthenticatedUser,
  ) {
    return this.s.verifyReviewAction(id, u);
  }
  @Post('reviews/:id/close') closeReview(
    @Param('id') id: string,
    @CurrentUser() u: AuthenticatedUser,
  ) {
    return this.s.closeReview(id, u);
  }
  @Get('templates') templates(@CurrentUser() u: AuthenticatedUser) {
    return this.s.templates(u);
  }
  @Post('templates') createTemplate(
    @Body() d: CreateDesignProjectTemplateDto,
    @CurrentUser() u: AuthenticatedUser,
  ) {
    return this.s.createTemplate(d, u);
  }
  @Post('templates/:id/approve') approveTemplate(
    @Param('id') id: string,
    @CurrentUser() u: AuthenticatedUser,
  ) {
    return this.s.approveTemplate(id, u);
  }
  @Post('templates/:id/apply') applyTemplate(
    @Param('id') id: string,
    @Body() d: ApplyDesignProjectTemplateDto,
    @CurrentUser() u: AuthenticatedUser,
  ) {
    return this.s.applyTemplate(id, d, u);
  }
  @Get('transmittals') transmittals(@CurrentUser() u: AuthenticatedUser) {
    return this.s.transmittals(u);
  }
  @Post('transmittals') createTransmittal(
    @Body() d: CreateDesignTransmittalDto,
    @CurrentUser() u: AuthenticatedUser,
  ) {
    return this.s.createTransmittal(d, u);
  }
  @Post('transmittals/:id/issue') issueTransmittal(
    @Param('id') id: string,
    @CurrentUser() u: AuthenticatedUser,
  ) {
    return this.s.issueTransmittal(id, u);
  }
  @Post('transmittals/:id/acknowledge') acknowledgeTransmittal(
    @Param('id') id: string,
    @Body() d: AcknowledgeDesignTransmittalDto,
    @CurrentUser() u: AuthenticatedUser,
  ) {
    return this.s.acknowledgeTransmittal(id, d, u);
  }
  @Get('change-reports') changeReports(@CurrentUser() u: AuthenticatedUser) {
    return this.s.changeReports(u);
  }
  @Get('change-reports/:id') changeReport(
    @Param('id') id: string,
    @CurrentUser() u: AuthenticatedUser,
  ) {
    return this.s.changeReport(id, u);
  }
  @Post('change-reports') generateChangeReport(
    @Body() d: GenerateDesignChangeReportDto,
    @CurrentUser() u: AuthenticatedUser,
  ) {
    return this.s.generateChangeReport(d, u);
  }
  @Post('change-reports/:id/sign-internal') signChangeReportInternal(
    @Param('id') id: string,
    @CurrentUser() u: AuthenticatedUser,
  ) {
    return this.s.signChangeReportInternal(id, u);
  }
  @Post('change-reports/:id/sign-customer') signChangeReportCustomer(
    @Param('id') id: string,
    @Body() d: SignDesignChangeReportCustomerDto,
    @CurrentUser() u: AuthenticatedUser,
  ) {
    return this.s.signChangeReportCustomer(id, d, u);
  }
  @Post('change-reports/:id/revise') reviseChangeReport(
    @Param('id') id: string,
    @Body() d: ReviseDesignChangeReportDto,
    @CurrentUser() u: AuthenticatedUser,
  ) {
    return this.s.reviseChangeReport(id, d, u);
  }
}
