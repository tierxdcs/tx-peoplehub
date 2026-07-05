import { Role } from './jwt';

export type EmployeeStatus = 'ACTIVE' | 'INACTIVE';
export type AccessStatus = 'PENDING_ACCESS' | 'ACTIVE' | 'INACTIVE';
export type EmploymentType =
  | 'FULL_TIME_PERMANENT'
  | 'CONTRACT'
  | 'INTERN'
  | 'PART_TIME';

export interface Employee {
  id: string;
  employeeId: string;
  firstName: string;
  lastName: string;
  email: string;
  role: Role | null;
  verticalId: string | null;
  reportingManagerId: string | null;
  status: EmployeeStatus;
  deactivatedAt: string | null;
  accessStatus: AccessStatus;
  officialEmail: string | null;
  designation?: string | null;
  employmentType?: EmploymentType | null;
  dateOfJoining?: string | null;
  workLocation?: string | null;
  mobile?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface Vertical {
  id: string;
  name: string;
  code: string;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface PaginatedResult<T> {
  items: T[];
  total: number;
  page: number;
  limit: number;
}

/** GET /employees/roster — HR-vertical viewer shape. */
export interface EmployeeRoster {
  id: string;
  employeeId: string;
  firstName: string;
  lastName: string;
  designation: string | null;
  verticalId: string | null;
  employmentType: EmploymentType | null;
  dateOfJoining: string | null;
  workLocation: string | null;
  mobile: string | null;
  status: EmployeeStatus;
  accessStatus: AccessStatus;
}

/** GET /employees/roster — Admin/SuperAdmin viewer shape. */
export interface EmployeeRosterAdmin extends EmployeeRoster {
  hasCompensationOnFile: boolean;
  hasStatutoryInfoOnFile: boolean;
  hasBankDetailsOnFile: boolean;
}

export interface Compensation {
  employeeId: string;
  basicSalary: string;
  hra: string;
  effectiveDate: string;
}

export interface Statutory {
  employeeId: string;
  panNumber: string;
  aadhaarLast4: string;
  pfAccountNumber: string;
  esicNumber: string | null;
}

export interface BankDetails {
  employeeId: string;
  bankAccountNumber: string;
  ifscCode: string;
}

export type LeaveAccrualType = 'FIXED_ANNUAL' | 'MONTHLY_ACCRUAL' | 'UNTRACKED';
export type LeaveRequestStatus =
  | 'PENDING'
  | 'APPROVED'
  | 'REJECTED'
  | 'CANCELLED';
export type AttendanceStatus = 'PRESENT' | 'ABSENT' | 'ON_LEAVE' | 'HALF_DAY';

export interface LeaveType {
  id: string;
  code: string;
  name: string;
  accrualType: LeaveAccrualType;
  annualQuota: string | null;
  carryForwardCap: string | null;
  isActive: boolean;
}

export interface LeaveBalance {
  id: string;
  leaveTypeId: string;
  leaveTypeCode: string;
  leaveTypeName: string;
  year: number;
  allocated: string;
  used: string;
  carriedForward: string;
  remaining: string;
}

export interface LeaveRequest {
  id: string;
  employeeId: string;
  leaveTypeId: string;
  startDate: string;
  endDate: string;
  numberOfDays: string;
  reason: string;
  status: LeaveRequestStatus;
  approverId: string | null;
  approvedAt: string | null;
  approverComments: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface Attendance {
  id: string;
  employeeId: string;
  date: string;
  checkInTime: string | null;
  checkOutTime: string | null;
  status: AttendanceStatus;
}

export interface SalaryStructure {
  id: string;
  employeeId: string;
  effectiveFrom: string;
  basic: string;
  hra: string;
  specialAllowance: string;
  otherAllowances: string | null;
  ctcAnnual: string;
}

export type StatutoryConfigType =
  | 'PF'
  | 'ESI'
  | 'PROFESSIONAL_TAX'
  | 'TDS_SLAB'
  | 'STANDARD_DEDUCTION';

export interface StatutoryConfig {
  id: string;
  configType: StatutoryConfigType;
  state: string | null;
  effectiveFrom: string;
  effectiveTo: string | null;
  configData: Record<string, unknown>;
  sourceNote: string;
}

export type PayrollRunStatus = 'DRAFT' | 'PROCESSING' | 'COMPLETED' | 'LOCKED';

export interface PayrollRun {
  id: string;
  month: number;
  year: number;
  status: PayrollRunStatus;
  initiatedById: string;
  processedAt: string | null;
  lockedAt: string | null;
  createdAt: string;
}

export type PayslipStatus = 'GENERATED' | 'PAID';

export interface Payslip {
  id: string;
  payrollRunId: string;
  employeeId: string;
  grossEarnings: string;
  basicPaid: string;
  hraPaid: string;
  specialAllowancePaid: string;
  otherAllowancesPaid: string;
  pfEmployee: string;
  pfEmployer: string;
  esiEmployee: string | null;
  esiEmployer: string | null;
  professionalTax: string | null;
  tdsDeducted: string;
  unpaidLeaveDeduction: string;
  netPay: string;
  statutoryConfigSnapshot: Record<string, unknown>;
  status: PayslipStatus;
  createdAt: string;
}
