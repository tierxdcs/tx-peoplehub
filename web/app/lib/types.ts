import { Role } from './jwt';

export type EmployeeStatus = 'ACTIVE' | 'INACTIVE';
export type AccessStatus = 'PENDING_ACCESS' | 'ACTIVE' | 'INACTIVE';
export type EmploymentType =
  | 'FULL_TIME_PERMANENT'
  | 'CONTRACT'
  | 'INTERN'
  | 'PART_TIME';

/** Fixed set of signature-style fonts (mirrors the backend SignatureFont enum). */
export type SignatureFont =
  | 'DANCING_SCRIPT'
  | 'CAVEAT'
  | 'PACIFICO'
  | 'GREAT_VIBES';

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
  isSalesHead: boolean;
  officialEmail: string | null;
  signatureText?: string | null;
  signatureFont?: SignatureFont | null;
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
  approverSignatureTextSnapshot: string | null;
  approverSignatureFontSnapshot: SignatureFont | null;
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

// ---- Vault (document management) ----

export type VaultFolderType = 'PERSONAL' | 'DEFAULT' | 'CUSTOM';
export type VaultVisibilityScope =
  | 'PRIVATE'
  | 'TEAM'
  | 'VERTICAL'
  | 'COMPANY_WIDE';
export type VaultFolderStatus = 'ACTIVE' | 'ARCHIVED';
export type VaultFileStatus = 'PENDING' | 'ACTIVE' | 'DELETED';
export type VaultPreviewStatus =
  | 'PENDING'
  | 'READY'
  | 'FAILED'
  | 'NOT_APPLICABLE';
export type VaultSharePermission = 'VIEW' | 'EDIT';
export type VaultShareResourceType = 'FILE' | 'FOLDER';

/** The caller's computed effective access on a folder or file. */
export interface VaultAccess {
  canRead: boolean;
  canWrite: boolean;
  canDelete: boolean;
  canCreateSubfolder: boolean;
}

export interface VaultFolder {
  id: string;
  name: string;
  parentFolderId: string | null;
  type: VaultFolderType;
  ownerId: string;
  visibilityScope: VaultVisibilityScope;
  scopeVerticalId: string | null;
  versioningEnabled: boolean;
  maxVersionsRetained: number | null;
  status: VaultFolderStatus;
  access: VaultAccess;
  children?: VaultFolder[];
  createdAt: string;
  updatedAt: string;
}

/** Enriched file row from GET /vault/folders/:id/files and /vault/files/:id. */
export interface VaultFile {
  id: string;
  folderId: string;
  name: string;
  currentVersionId: string | null;
  status: VaultFileStatus;
  uploadedById: string;
  uploadedByName: string | null;
  sizeBytes: string | null;
  mimeType: string | null;
  previewStatus: VaultPreviewStatus | null;
  versionCount: number;
  access: VaultAccess;
  createdAt: string;
  updatedAt: string;
}

export interface VaultFileVersion {
  id: string;
  fileId: string;
  versionNumber: number;
  mimeType: string;
  sizeBytes: string;
  storageKey: string;
  previewStorageKey: string | null;
  previewStatus: VaultPreviewStatus;
  changeNote: string | null;
  uploadedById: string;
  createdAt: string;
}

/** POST /vault/files/upload-url and /vault/files/:id/versions response. */
export interface VaultUploadUrlResponse {
  file: {
    id: string;
    folderId: string;
    name: string;
    currentVersionId: string | null;
    status: VaultFileStatus;
  };
  versionId: string;
  storageKey: string;
  uploadUrl: string;
  expiresInSeconds: number;
}

export interface VaultDownloadUrlResponse {
  downloadUrl: string;
  expiresInSeconds: number;
}

export interface VaultViewUrlResponse {
  previewStatus: VaultPreviewStatus;
  viewUrl: string | null;
  expiresInSeconds: number | null;
}

export interface VaultInternalShare {
  id: string;
  resourceType: VaultShareResourceType;
  resourceId: string;
  sharedWithEmployeeId: string;
  sharedWithEmployeeName: string | null;
  permission: VaultSharePermission;
  sharedById: string;
  createdAt: string;
}

export interface VaultExternalShareLink {
  id: string;
  resourceType: VaultShareResourceType;
  resourceId: string;
  token: string;
  permission: VaultSharePermission;
  pinnedVersionId: string | null;
  hasPassword: boolean;
  expiresAt: string;
  revokedAt: string | null;
  createdById: string;
  createdAt: string;
  /** Only present on the list endpoint. */
  accessCount?: number;
}

/** GET /employees/search — lean picker shape. */
export interface EmployeeSearchResult {
  id: string;
  employeeId: string;
  firstName: string;
  lastName: string;
  fullName: string;
  email: string;
  verticalId: string | null;
}

/** GET /public/vault/shared/:token — public resolution shape. */
export interface PublicSharedResource {
  resourceType: VaultShareResourceType;
  name: string;
  url: string | null;
  mimeType: string | null;
  expiresInSeconds: number | null;
}

// ---- Sales module ----

export type CustomerStatus = 'ACTIVE' | 'INACTIVE';
export type LeadPriority = 'HIGH' | 'MEDIUM' | 'LOW';
export type LeadSource =
  | 'REFERRAL'
  | 'WEBSITE'
  | 'COLD_OUTREACH'
  | 'EVENT'
  | 'OTHER';
export type LeadStatus =
  | 'NEW'
  | 'CONTACTED'
  | 'QUALIFIED'
  | 'DISQUALIFIED'
  | 'CONVERTED';
export type OpportunityStage =
  | 'PROSPECTING'
  | 'QUALIFICATION'
  | 'PROPOSAL'
  | 'NEGOTIATION'
  | 'CLOSED_WON'
  | 'CLOSED_LOST';
export type BidStatus =
  | 'DRAFT'
  | 'PENDING_APPROVAL'
  | 'APPROVED'
  | 'REJECTED'
  | 'SENT'
  | 'ACCEPTED'
  | 'EXPIRED';
export type OrderStatus =
  | 'CONFIRMED'
  | 'IN_PRODUCTION'
  | 'READY_TO_SHIP'
  | 'SHIPPED'
  | 'DELIVERED'
  | 'CANCELLED';
export type SalesTaxType = 'CGST_SGST' | 'IGST';

/** Address is free-form JSON or a plain string (backend accepts either). */
export type Address = Record<string, unknown> | string;

export interface CustomerContact {
  id: string;
  customerId: string;
  name: string;
  email: string | null;
  phone: string | null;
  designation: string | null;
  isPrimary: boolean;
}

export interface Customer {
  id: string;
  name: string;
  gstin: string | null;
  billingAddress: Address;
  shippingAddress: Address | null;
  industry: string | null;
  ownerId: string;
  status: CustomerStatus;
  contacts?: CustomerContact[];
  createdAt: string;
  updatedAt: string;
}

export interface Product {
  id: string;
  sku: string;
  name: string;
  description: string | null;
  unitPrice: string;
  unitOfMeasure: string;
  hsnCode: string | null;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface Lead {
  id: string;
  leadNumber: string;
  companyName: string;
  contactName: string;
  email: string | null;
  phone: string | null;
  requirement: string;
  priority: LeadPriority;
  source: LeadSource;
  status: LeadStatus;
  ownerId: string;
  disqualifiedReason: string | null;
  convertedToOpportunityId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface Opportunity {
  id: string;
  leadId: string | null;
  customerId: string | null;
  name: string;
  stage: OpportunityStage;
  estimatedValue: string;
  expectedCloseDate: string;
  ownerId: string;
  lostReason: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface BidLineItem {
  id: string;
  bidId: string;
  productId: string;
  productName: string;
  productSku: string;
  quantity: string;
  unitPrice: string;
  lineDiscountPercent: string | null;
  lineTotal: string;
}

export interface Bid {
  id: string;
  bidNumber: string;
  opportunityId: string;
  customerId: string;
  status: BidStatus;
  validUntil: string;
  tenderReferenceNumber: string | null;
  technicalSpecification: string | null;
  attachments: Array<Record<string, unknown>> | null;
  subtotal: string;
  discountPercent: string;
  discountAmount: string;
  taxType: SalesTaxType | null;
  taxRate: string | null;
  taxAmount: string;
  totalAmount: string;
  createdById: string;
  approverId: string | null;
  approvedAt: string | null;
  approverComments: string | null;
  approverSignatureTextSnapshot: string | null;
  approverSignatureFontSnapshot: SignatureFont | null;
  lineItems?: BidLineItem[];
  /** Non-null once this bid has been converted to an order. */
  convertedOrderId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface OrderLineItem {
  id: string;
  orderId: string;
  productId: string;
  productName: string;
  productSku: string;
  quantity: string;
  unitPrice: string;
  lineTotal: string;
}

export interface Order {
  id: string;
  orderNumber: string;
  bidId: string | null;
  customerId: string;
  status: OrderStatus;
  totalAmount: string;
  productionRunId: string | null;
  shipmentId: string | null;
  ownerId: string;
  lineItems?: OrderLineItem[];
  createdAt: string;
  updatedAt: string;
}

// ---- Order Confirmation Sheet ----

export type OrderConfirmationStatus =
  | 'DRAFT'
  | 'AWAITING_CUSTOMER_SIGNATURE'
  | 'AWAITING_INTERNAL_SIGNATURE'
  | 'REJECTED'
  | 'EXECUTED';

export type OrderConfirmationDeliveryType =
  | 'FULL_TRUCKLOAD'
  | 'PARTIAL_TRUCKLOAD'
  | 'CUSTOMER_PICKUP_EXWORKS'
  | 'COURIER_EXPRESS'
  | 'OTHER';

export type OrderConfirmationQualityReport =
  | 'MATERIAL_TEST_CERTIFICATE'
  | 'FACTORY_ACCEPTANCE_TEST_REPORT'
  | 'CALIBRATION_CERTIFICATE'
  | 'COMPLIANCE_CERTIFICATE'
  | 'OTHER';

export interface OrderConfirmationSheet {
  id: string;
  confirmationNumber: string;
  orderId: string;
  revisionNumber: number;
  status: OrderConfirmationStatus;
  requirementsOverview: string;
  deliveryDate: string | null;
  deliveryLocation: string;
  deliveryType: OrderConfirmationDeliveryType | null;
  qualityReportsExpected: OrderConfirmationQualityReport[];
  qualityReportNotes: string | null;
  installationCommissioningRequired: boolean;
  installationNotes: string | null;
  warrantyTerms: string;
  paymentMilestones: string;
  siteReadinessRequirements: string | null;
  specialHandlingInstructions: string | null;
  packagingType: string;
  protectiveMeasures: string;
  packagingComplianceStandard: string | null;
  labelingRequirements: string;
  customerPackagingSpecReference: string | null;
  customerContactName: string;
  customerContactPhone: string;
  customerContactEmail: string;
  pdfGeneratedAt: string | null;
  hasSignedCopy: boolean;
  signedCopyUploadedById: string | null;
  signedCopyUploadedAt: string | null;
  internalSignedById: string | null;
  internalSignedByName: string | null;
  internalSignedAt: string | null;
  internalReviewComments: string | null;
  approverSignatureTextSnapshot: string | null;
  approverSignatureFontSnapshot: SignatureFont | null;
  createdById: string;
  createdAt: string;
  updatedAt: string;
}

// ---- Bid/No-Bid decision gate ----

export type BidAssessmentQuestionType =
  | 'BOOLEAN'
  | 'TEXT'
  | 'SCALE'
  | 'SELECT';

export type BidAssessmentStatus =
  | 'PENDING_REVIEW'
  | 'APPROVED'
  | 'REJECTED';

export interface BidAssessmentQuestion {
  id: string;
  text: string;
  type: BidAssessmentQuestionType;
  options: string[] | null;
  displayOrder: number;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface BidAssessmentResponse {
  id: string;
  questionId: string;
  questionTextSnapshot: string;
  answerValue: string;
}

export interface BidDecisionAssessment {
  id: string;
  opportunityId: string;
  submittedById: string;
  status: BidAssessmentStatus;
  reviewedById: string | null;
  reviewedAt: string | null;
  reviewerComments: string | null;
  approverSignatureTextSnapshot: string | null;
  approverSignatureFontSnapshot: SignatureFont | null;
  responses?: BidAssessmentResponse[];
  createdAt: string;
  updatedAt: string;
}
