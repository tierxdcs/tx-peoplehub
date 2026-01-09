import { Injectable } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable, map } from 'rxjs';

export type UserRole = 'Employee' | 'Manager' | 'Admin' | 'Superadmin';
export type UserStatus = 'Active' | 'Deactivated';
export type TrainingParticipantStatus = 'Completed' | 'Pending';

export type UserRecord = {
  id: string;
  fullName: string;
  email: string;
  department: string;
  role: UserRole;
  status: UserStatus;
  director: string;
};

export type LoginResponse = {
  id: string;
  fullName: string;
  email: string;
  role: UserRole;
  department: string;
  director: string;
};

export type CreateUserPayload = Omit<UserRecord, 'id'> & {
  password?: string;
};

export type UpdateUserPayload = Omit<UserRecord, 'id'> & {
  password?: string;
};

export type DepartmentRecord = { id: string; name: string; head: string };

export type TeamRecord = {
  id: string;
  name: string;
  head: string;
  summary: string;
  peopleCount: number;
  coverage: string;
  sites: string;
};

export type EmployeeProfile = {
  id?: string;
  fullName: string;
  employeeId: string;
  email: string;
  location: string;
  department: string;
  startDate: string;
  jobTitle: string;
  role: string;
  manager: string;
  managerLevel2: string;
  managerLevel3: string;
  managerLevel4: string;
  ceo: string;
  director: string;
  employmentType: string;
  status: string;
  costCenter: string;
  baseSalary: string;
  paySchedule: string;
  bonusEligible: string;
  equityPlan: string;
  benefitsTier: string;
  compensationEffectiveDate: string;
  offerLetterName: string;
  offerLetterData: string;
  compBand: string;
  compPositioning: string;
  annualPto: string;
  sickLeave: string;
  floatingHolidays: string;
  parentalLeave: string;
  carryoverCap: string;
  policyEffective: string;
  certifications: string;
  backgroundCheck: string;
  safetyTraining: string;
  workAuthorization: string;
  surveyScore: string;
  checkinsScore: string;
  participationScore: string;
  riskAdjustedScore: string;
  photoUrl: string;
  complianceDocumentName: string;
  nextAuditDate: string;
  checklistOffer: boolean;
  checklistEquipment: boolean;
  checklistBadges: boolean;
  checklistOrientation: boolean;
  checklistBusinessCard: boolean;
  checklistCustom: { title: string; owner: string; done: boolean }[];
  checklistOfferOwner: string;
  checklistEquipmentOwner: string;
  checklistBadgesOwner: string;
  checklistOrientationOwner: string;
  checklistBusinessCardOwner: string;
};

export type TrainingAssignment = {
  id: string;
  title: string;
  audience: string;
  department: string;
  dueDate: string;
  completed: number;
  total: number;
  questions: { text: string; type: string; options?: string[]; correctAnswers?: string[] }[];
  participants: { name: string; status: TrainingParticipantStatus }[];
};

export type TrainingResponse = {
  id: string;
  assignmentId: string;
  employee: string;
  responses: Record<number, string | string[]>;
  score: number | null;
  passed: boolean;
  submittedAt: string;
};

export type IdeaRecord = {
  id: string;
  title: string;
  type: string;
  summary: string;
  manager: string;
  submittedAt: string;
};

export type LeaveRecord = {
  id: string;
  employeeName: string;
  type: string;
  startDate: string;
  endDate: string;
  range: string;
  status: string;
  notes: string;
};

export type ReimbursementRecord = {
  id: string;
  title: string;
  amount: string;
  category: string;
  date: string;
  notes: string;
  status: string;
  employee: string;
};

export type RequisitionRecord = {
  id: string;
  title: string;
  department: string;
  location: string;
  headcount: number;
  level: string;
  hireType: string;
  startDate: string;
  justification: string;
  budgetImpact: string;
  manager: string;
  costCenter: string;
  approval: string;
  submittedAt: string;
};

export type TaskRecord = {
  id: string;
  title: string;
  owner: string;
  due: string;
  source: string;
};

export type CompletedApproval = {
  id: string;
  source: string;
  sourceId: string;
  title: string;
  submittedBy: string;
  summary: string;
  status: string;
  note: string;
  decidedAt: string;
};

@Injectable({ providedIn: 'root' })
export class ApiService {
  private readonly baseUrl =
    window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1'
      ? 'https://tierx-peoplehub.web.app/api'
      : '/api';

  constructor(private readonly http: HttpClient) {}

  getUsers(): Observable<UserRecord[]> {
    return this.http.get<UserRecord[]>(`${this.baseUrl}/users`).pipe(
      map((rows) => rows.map((row) => this.mapUser(row)))
    );
  }

  createUser(payload: CreateUserPayload): Observable<UserRecord> {
    return this.http.post<UserRecord>(`${this.baseUrl}/users`, payload).pipe(
      map((row) => this.mapUser(row))
    );
  }

  login(payload: { email: string; password: string }): Observable<LoginResponse> {
    return this.http.post<LoginResponse>(`${this.baseUrl}/login`, payload).pipe(
      map((row) => this.mapUser(row))
    );
  }

  updateUser(id: string, payload: UpdateUserPayload): Observable<UserRecord> {
    return this.http.put<UserRecord>(`${this.baseUrl}/users/${id}`, payload).pipe(
      map((row) => this.mapUser(row))
    );
  }

  getDepartments(): Observable<DepartmentRecord[]> {
    return this.http.get<DepartmentRecord[]>(`${this.baseUrl}/departments`).pipe(
      map((rows) => rows.map((row) => this.mapDepartment(row)))
    );
  }

  createDepartment(payload: { name: string; head: string }): Observable<DepartmentRecord> {
    return this.http.post<DepartmentRecord>(`${this.baseUrl}/departments`, payload).pipe(
      map((row) => this.mapDepartment(row))
    );
  }

  deleteDepartment(id: string): Observable<{ ok: boolean }> {
    return this.http.delete<{ ok: boolean }>(`${this.baseUrl}/departments/${id}`);
  }

  getTeams(): Observable<TeamRecord[]> {
    return this.http.get<TeamRecord[]>(`${this.baseUrl}/teams`).pipe(
      map((rows) => rows.map((row) => this.mapTeam(row)))
    );
  }

  createTeam(payload: {
    name: string;
    head: string;
    summary: string;
    peopleCount: number;
    coverage: string;
    sites: string;
  }): Observable<TeamRecord> {
    return this.http.post<TeamRecord>(`${this.baseUrl}/teams`, payload).pipe(
      map((row) => this.mapTeam(row))
    );
  }

  deleteTeam(id: string): Observable<{ ok: boolean }> {
    return this.http.delete<{ ok: boolean }>(`${this.baseUrl}/teams/${id}`);
  }

  getEmployeeProfile(): Observable<EmployeeProfile | null> {
    return this.http.get<EmployeeProfile | null>(`${this.baseUrl}/employee-profiles`).pipe(
      map((row) => (row ? this.mapProfile(row) : null))
    );
  }

  saveEmployeeProfile(payload: EmployeeProfile): Observable<EmployeeProfile> {
    return this.http.post<EmployeeProfile>(`${this.baseUrl}/employee-profiles`, payload).pipe(
      map((row) => this.mapProfile(row))
    );
  }

  getTrainingAssignments(): Observable<TrainingAssignment[]> {
    return this.http.get<TrainingAssignment[]>(`${this.baseUrl}/training-assignments`).pipe(
      map((rows) => rows.map((row) => this.mapTrainingAssignment(row)))
    );
  }

  createTrainingAssignment(payload: Omit<TrainingAssignment, 'id'>): Observable<TrainingAssignment> {
    return this.http.post<TrainingAssignment>(`${this.baseUrl}/training-assignments`, payload).pipe(
      map((row) => this.mapTrainingAssignment(row))
    );
  }

  updateTrainingAssignment(
    id: string,
    payload: Pick<TrainingAssignment, 'questions' | 'participants' | 'completed' | 'total'>
  ): Observable<TrainingAssignment> {
    return this.http.put<TrainingAssignment>(`${this.baseUrl}/training-assignments/${id}`, payload).pipe(
      map((row) => this.mapTrainingAssignment(row))
    );
  }

  getTrainingResponses(params?: { assignmentId?: string; employee?: string }): Observable<TrainingResponse[]> {
    let httpParams = new HttpParams();
    if (params?.assignmentId) {
      httpParams = httpParams.set('assignmentId', params.assignmentId);
    }
    if (params?.employee) {
      httpParams = httpParams.set('employee', params.employee);
    }
    return this.http.get<TrainingResponse[]>(`${this.baseUrl}/training-responses`, {
      params: httpParams
    }).pipe(
      map((rows) => rows.map((row) => this.mapTrainingResponse(row)))
    );
  }

  createTrainingResponse(payload: {
    assignmentId: string;
    employee: string;
    responses: Record<number, string | string[]>;
    score?: number | null;
    passed?: boolean;
  }): Observable<TrainingResponse> {
    return this.http.post<TrainingResponse>(`${this.baseUrl}/training-responses`, payload).pipe(
      map((row) => this.mapTrainingResponse(row))
    );
  }

  getIdeas(): Observable<IdeaRecord[]> {
    return this.http.get<IdeaRecord[]>(`${this.baseUrl}/ideas`).pipe(
      map((rows) => rows.map((row) => this.mapIdea(row)))
    );
  }

  createIdea(payload: Omit<IdeaRecord, 'id' | 'submittedAt'>): Observable<IdeaRecord> {
    return this.http.post<IdeaRecord>(`${this.baseUrl}/ideas`, payload).pipe(
      map((row) => this.mapIdea(row))
    );
  }

  getLeaves(): Observable<LeaveRecord[]> {
    return this.http.get<LeaveRecord[]>(`${this.baseUrl}/leaves`).pipe(
      map((rows) => rows.map((row) => this.mapLeave(row)))
    );
  }

  createLeave(payload: Omit<LeaveRecord, 'id'>): Observable<LeaveRecord> {
    return this.http.post<LeaveRecord>(`${this.baseUrl}/leaves`, payload).pipe(
      map((row) => this.mapLeave(row))
    );
  }

  updateLeaveStatus(id: string, status: string): Observable<LeaveRecord> {
    return this.http.patch<LeaveRecord>(`${this.baseUrl}/leaves/${id}`, { status }).pipe(
      map((row) => this.mapLeave(row))
    );
  }

  getReimbursements(): Observable<ReimbursementRecord[]> {
    return this.http.get<ReimbursementRecord[]>(`${this.baseUrl}/reimbursements`).pipe(
      map((rows) => rows.map((row) => this.mapReimbursement(row)))
    );
  }

  createReimbursement(payload: Omit<ReimbursementRecord, 'id'>): Observable<ReimbursementRecord> {
    return this.http.post<ReimbursementRecord>(`${this.baseUrl}/reimbursements`, payload).pipe(
      map((row) => this.mapReimbursement(row))
    );
  }

  updateReimbursementStatus(id: string, status: string): Observable<ReimbursementRecord> {
    return this.http.patch<ReimbursementRecord>(`${this.baseUrl}/reimbursements/${id}`, { status }).pipe(
      map((row) => this.mapReimbursement(row))
    );
  }

  getRequisitions(): Observable<RequisitionRecord[]> {
    return this.http.get<RequisitionRecord[]>(`${this.baseUrl}/requisitions`).pipe(
      map((rows) => rows.map((row) => this.mapRequisition(row)))
    );
  }

  createRequisition(payload: Omit<RequisitionRecord, 'id' | 'submittedAt'>): Observable<RequisitionRecord> {
    return this.http.post<RequisitionRecord>(`${this.baseUrl}/requisitions`, payload).pipe(
      map((row) => this.mapRequisition(row))
    );
  }

  updateRequisitionApproval(id: string, approval: string): Observable<RequisitionRecord> {
    return this.http.patch<RequisitionRecord>(`${this.baseUrl}/requisitions/${id}`, { approval }).pipe(
      map((row) => this.mapRequisition(row))
    );
  }

  getTasks(): Observable<TaskRecord[]> {
    return this.http.get<TaskRecord[]>(`${this.baseUrl}/tasks`).pipe(
      map((rows) => rows.map((row) => this.mapTask(row)))
    );
  }

  createTask(payload: Omit<TaskRecord, 'id'>): Observable<TaskRecord> {
    return this.http.post<TaskRecord>(`${this.baseUrl}/tasks`, payload).pipe(
      map((row) => this.mapTask(row))
    );
  }

  deleteTask(id: string): Observable<{ ok: boolean }> {
    return this.http.delete<{ ok: boolean }>(`${this.baseUrl}/tasks/${id}`);
  }

  getCompletedApprovals(): Observable<CompletedApproval[]> {
    return this.http.get<CompletedApproval[]>(`${this.baseUrl}/approvals/completed`).pipe(
      map((rows) => rows.map((row) => this.mapCompletedApproval(row)))
    );
  }

  createCompletedApproval(
    payload: Omit<CompletedApproval, 'id' | 'decidedAt'>
  ): Observable<CompletedApproval> {
    return this.http.post<CompletedApproval>(`${this.baseUrl}/approvals/completed`, payload).pipe(
      map((row) => this.mapCompletedApproval(row))
    );
  }

  private mapUser(row: any): UserRecord {
    return {
      id: row.id,
      fullName: row.full_name ?? row.fullName ?? '',
      email: row.email ?? '',
      department: row.department ?? '',
      role: row.role ?? 'Employee',
      status: row.status ?? 'Active',
      director: row.director ?? 'No'
    };
  }

  private mapDepartment(row: any): DepartmentRecord {
    return {
      id: row.id,
      name: row.name ?? '',
      head: row.head ?? ''
    };
  }

  private mapTeam(row: any): TeamRecord {
    return {
      id: row.id,
      name: row.name ?? '',
      head: row.head ?? '',
      summary: row.summary ?? '',
      peopleCount: Number(row.people_count ?? row.peopleCount ?? 0),
      coverage: row.coverage ?? '',
      sites: row.sites ?? ''
    };
  }

  private mapProfile(row: any): EmployeeProfile {
    return {
      id: row.id,
      fullName: row.full_name ?? '',
      employeeId: row.employee_id ?? '',
      email: row.email ?? '',
      location: row.location ?? '',
      department: row.department ?? '',
      startDate: row.start_date ?? '',
      jobTitle: row.job_title ?? '',
      role: row.role ?? '',
      manager: row.manager ?? '',
      managerLevel2: row.manager_level2 ?? '',
      managerLevel3: row.manager_level3 ?? '',
      managerLevel4: row.manager_level4 ?? '',
      ceo: row.ceo ?? '',
      director: row.director ?? '',
      employmentType: row.employment_type ?? '',
      status: row.status ?? '',
      costCenter: row.cost_center ?? '',
      baseSalary: row.base_salary ?? '',
      paySchedule: row.pay_schedule ?? '',
      bonusEligible: row.bonus_eligible ?? '',
      equityPlan: row.equity_plan ?? '',
      benefitsTier: row.benefits_tier ?? '',
      compensationEffectiveDate: row.compensation_effective_date ?? '',
      offerLetterName: row.offer_letter_name ?? '',
      offerLetterData: row.offer_letter_data ?? '',
      compBand: row.comp_band ?? '',
      compPositioning: row.comp_positioning ?? '',
      annualPto: row.annual_pto ?? '',
      sickLeave: row.sick_leave ?? '',
      floatingHolidays: row.floating_holidays ?? '',
      parentalLeave: row.parental_leave ?? '',
      carryoverCap: row.carryover_cap ?? '',
      policyEffective: row.policy_effective ?? '',
      certifications: row.certifications ?? '',
      backgroundCheck: row.background_check ?? '',
      safetyTraining: row.safety_training ?? '',
      workAuthorization: row.work_authorization ?? '',
      surveyScore: row.survey_score !== undefined && row.survey_score !== null ? String(row.survey_score) : '',
      checkinsScore: row.checkins_score !== undefined && row.checkins_score !== null ? String(row.checkins_score) : '',
      participationScore:
        row.participation_score !== undefined && row.participation_score !== null
          ? String(row.participation_score)
          : '',
      riskAdjustedScore:
        row.risk_adjusted_score !== undefined && row.risk_adjusted_score !== null
          ? String(row.risk_adjusted_score)
          : '',
      photoUrl: row.photo_url ?? row.photoUrl ?? '',
      complianceDocumentName: row.compliance_document_name ?? '',
      nextAuditDate: row.next_audit_date ?? '',
      checklistOffer: row.checklist_offer ?? false,
      checklistEquipment: row.checklist_equipment ?? false,
      checklistBadges: row.checklist_badges ?? false,
      checklistOrientation: row.checklist_orientation ?? false,
      checklistBusinessCard: row.checklist_business_card ?? false,
      checklistCustom: Array.isArray(row.checklist_custom) ? row.checklist_custom : [],
      checklistOfferOwner: row.checklist_offer_owner ?? '',
      checklistEquipmentOwner: row.checklist_equipment_owner ?? '',
      checklistBadgesOwner: row.checklist_badges_owner ?? '',
      checklistOrientationOwner: row.checklist_orientation_owner ?? '',
      checklistBusinessCardOwner: row.checklist_business_card_owner ?? ''
    };
  }

  private mapTrainingAssignment(row: any): TrainingAssignment {
    return {
      id: row.id,
      title: row.title ?? '',
      audience: row.audience ?? '',
      department: row.department ?? 'All departments',
      dueDate: row.due_date ?? row.dueDate ?? '',
      completed: Number(row.completed ?? 0),
      total: Number(row.total ?? 0),
      questions: Array.isArray(row.questions) ? row.questions : [],
      participants: Array.isArray(row.participants) ? row.participants : []
    };
  }

  private mapTrainingResponse(row: any): TrainingResponse {
    return {
      id: row.id,
      assignmentId: row.assignment_id ?? row.assignmentId,
      employee: row.employee ?? '',
      responses: row.responses ?? {},
      score: row.score !== undefined && row.score !== null ? Number(row.score) : null,
      passed: row.passed ?? false,
      submittedAt: row.submitted_at ?? row.submittedAt ?? ''
    };
  }

  private mapIdea(row: any): IdeaRecord {
    return {
      id: row.id,
      title: row.title ?? '',
      type: row.type ?? '',
      summary: row.summary ?? '',
      manager: row.manager ?? '',
      submittedAt: row.submitted_at ?? row.submittedAt ?? ''
    };
  }

  private mapLeave(row: any): LeaveRecord {
    return {
      id: row.id,
      employeeName: row.employee_name ?? row.employeeName ?? '',
      type: row.type ?? '',
      startDate: row.start_date ?? row.startDate ?? '',
      endDate: row.end_date ?? row.endDate ?? '',
      range: row.range ?? '',
      status: row.status ?? '',
      notes: row.notes ?? ''
    };
  }

  private mapReimbursement(row: any): ReimbursementRecord {
    return {
      id: row.id,
      title: row.title ?? '',
      amount: row.amount ?? '',
      category: row.category ?? '',
      date: row.date ?? '',
      notes: row.notes ?? '',
      status: row.status ?? '',
      employee: row.employee ?? ''
    };
  }

  private mapRequisition(row: any): RequisitionRecord {
    return {
      id: row.id,
      title: row.title ?? '',
      department: row.department ?? '',
      location: row.location ?? '',
      headcount: Number(row.headcount ?? 0),
      level: row.level ?? '',
      hireType: row.hire_type ?? row.hireType ?? '',
      startDate: row.start_date ?? row.startDate ?? '',
      justification: row.justification ?? '',
      budgetImpact: row.budget_impact ?? row.budgetImpact ?? '',
      manager: row.manager ?? '',
      costCenter: row.cost_center ?? row.costCenter ?? '',
      approval: row.approval ?? '',
      submittedAt: row.submitted_at ?? row.submittedAt ?? ''
    };
  }

  private mapTask(row: any): TaskRecord {
    return {
      id: row.id,
      title: row.title ?? '',
      owner: row.owner ?? '',
      due: row.due ?? '',
      source: row.source ?? ''
    };
  }

  private mapCompletedApproval(row: any): CompletedApproval {
    return {
      id: row.id,
      source: row.source ?? '',
      sourceId: row.source_id ?? row.sourceId ?? '',
      title: row.title ?? '',
      submittedBy: row.submitted_by ?? row.submittedBy ?? '',
      summary: row.summary ?? '',
      status: row.status ?? '',
      note: row.note ?? '',
      decidedAt: row.decided_at ?? row.decidedAt ?? ''
    };
  }
}
