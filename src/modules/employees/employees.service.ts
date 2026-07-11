import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  AccessStatus,
  Employee,
  EmployeeStatus,
  Prisma,
  Role,
} from '@prisma/client';
import * as bcrypt from 'bcrypt';
import { PrismaService } from '../../core/database/prisma.service';
import { EncryptionService } from '../../core/crypto/encryption.service';
import { AuthenticatedUser } from '../../common/decorators/current-user.decorator';
import {
  PaginatedResult,
  PaginationQueryDto,
} from '../../common/dto/pagination.dto';
import { CreateEmployeeDto } from './dto/create-employee.dto';
import { UpdateEmployeeDto } from './dto/update-employee.dto';
import { OnboardEmployeeDto } from './dto/onboard-employee.dto';
import { GrantAccessDto } from './dto/grant-access.dto';
import { UpdateSignatureDto } from './dto/update-signature.dto';
import { RosterQueryDto } from './dto/roster-query.dto';
import { EmployeeEntity } from './entities/employee.entity';
import {
  EmployeeRosterAdminEntity,
  EmployeeRosterEntity,
} from './entities/employee-roster.entity';
import { EmployeeCompensationEntity } from './entities/employee-compensation.entity';
import { EmployeeSearchResultEntity } from './entities/employee-search-result.entity';
import { EmployeeStatutoryEntity } from './entities/employee-statutory.entity';
import { EmployeeBankDetailsEntity } from './entities/employee-bank-details.entity';

const OFFICIAL_EMAIL_DOMAIN = 'vertixdcs.com';

type PrismaTransactionClient = Prisma.TransactionClient;

type EmployeeWithFileFlags = Employee & {
  salaryStructures: { id: string }[];
  statutoryInfo: { id: string } | null;
  bankDetails: { id: string } | null;
};

@Injectable()
export class EmployeesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly encryption: EncryptionService,
  ) {}

  async create(dto: CreateEmployeeDto): Promise<EmployeeEntity> {
    await this.validateVerticalAndManager(
      dto.role,
      dto.verticalId,
      dto.reportingManagerId,
    );

    const existing = await this.prisma.employee.findUnique({
      where: { email: dto.email },
    });
    if (existing) {
      throw new ConflictException('Email already in use');
    }

    const passwordHash = await bcrypt.hash(dto.password, 10);

    const employee = await this.prisma.$transaction(async (tx) => {
      const [{ nextval }] = await tx.$queryRaw<
        [{ nextval: bigint }]
      >`SELECT nextval('employee_id_seq')`;
      const employeeId = `EMP-${nextval.toString().padStart(4, '0')}`;

      return tx.employee.create({
        data: {
          employeeId,
          firstName: dto.firstName,
          lastName: dto.lastName,
          email: dto.email,
          passwordHash,
          role: dto.role,
          verticalId: dto.verticalId ?? null,
          reportingManagerId: dto.reportingManagerId ?? null,
          accessStatus: AccessStatus.ACTIVE,
        },
      });
    });

    return this.toEntity(employee);
  }

  async findAll(
    query: PaginationQueryDto,
  ): Promise<PaginatedResult<EmployeeEntity>> {
    const [items, total] = await this.prisma.$transaction([
      this.prisma.employee.findMany({
        skip: query.skip,
        take: query.limit,
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.employee.count(),
    ]);

    return {
      items: items.map((e) => this.toEntity(e)),
      total,
      page: query.page,
      limit: query.limit,
    };
  }

  /**
   * Self, Admin, or your own reporting manager may be viewed — the last
   * case lets an employee resolve their manager's name (e.g. for a leave
   * request's approver display) without a broader roster grant.
   */
  async findOne(
    id: string,
    currentUser: AuthenticatedUser,
  ): Promise<EmployeeEntity> {
    const isAdmin =
      currentUser.role === Role.ADMIN || currentUser.role === Role.SUPER_ADMIN;
    if (!isAdmin && currentUser.id !== id) {
      const caller = await this.prisma.employee.findUnique({
        where: { id: currentUser.id },
        select: { reportingManagerId: true },
      });
      if (caller?.reportingManagerId !== id) {
        throw new ForbiddenException('Cannot view another employee');
      }
    }
    const employee = await this.findRawOrThrow(id);
    return this.toEntity(employee);
  }

  async update(id: string, dto: UpdateEmployeeDto): Promise<EmployeeEntity> {
    const current = await this.findRawOrThrow(id);

    const nextRole = dto.role ?? current.role;
    const nextVerticalId =
      dto.verticalId !== undefined ? dto.verticalId : current.verticalId;
    const nextManagerId =
      dto.reportingManagerId !== undefined
        ? dto.reportingManagerId
        : current.reportingManagerId;

    await this.validateVerticalAndManager(
      nextRole,
      nextVerticalId,
      nextManagerId,
    );

    if (nextManagerId) {
      if (nextManagerId === id) {
        throw new BadRequestException('Employee cannot report to themselves');
      }
      await this.assertNoCycle(id, nextManagerId);
    }

    const employee = await this.prisma.employee.update({
      where: { id },
      data: {
        firstName: dto.firstName,
        lastName: dto.lastName,
        email: dto.email,
        role: dto.role,
        verticalId: dto.verticalId,
        reportingManagerId: dto.reportingManagerId,
      },
    });

    return this.toEntity(employee);
  }

  /** Self-service: set/change the caller's own internal e-signature. */
  async updateOwnSignature(
    userId: string,
    dto: UpdateSignatureDto,
  ): Promise<EmployeeEntity> {
    await this.findRawOrThrow(userId);
    const employee = await this.prisma.employee.update({
      where: { id: userId },
      data: {
        signatureText: dto.signatureText,
        signatureFont: dto.signatureFont,
      },
    });
    return this.toEntity(employee);
  }

  async deactivate(id: string): Promise<EmployeeEntity> {
    await this.findRawOrThrow(id);
    const employee = await this.prisma.employee.update({
      where: { id },
      data: { status: EmployeeStatus.INACTIVE, deactivatedAt: new Date() },
    });
    return this.toEntity(employee);
  }

  /**
   * Reverse of deactivate() — a direct restore, NOT a re-hire. Login is gated
   * on BOTH status === ACTIVE and accessStatus === ACTIVE (see AuthService), and
   * deactivate() only ever flipped `status`; it never touched accessStatus,
   * role, verticalId, or reportingManagerId. So restoring `status` to ACTIVE and
   * clearing deactivatedAt is all that's needed to let a previously-granted
   * employee log in again with their existing credentials and assignments.
   *
   * accessStatus is deliberately left untouched: a granted employee's is still
   * ACTIVE (so they can log in immediately), while a PENDING_ACCESS employee who
   * was deactivated returns to PENDING_ACCESS — they still must go through
   * grant-access before login, which is correct (they never had access to
   * restore). We do NOT force accessStatus to ACTIVE here.
   */
  async reactivate(id: string): Promise<EmployeeEntity> {
    const current = await this.findRawOrThrow(id);
    if (current.status === EmployeeStatus.ACTIVE) {
      throw new BadRequestException('Employee is already active');
    }
    const employee = await this.prisma.employee.update({
      where: { id },
      data: { status: EmployeeStatus.ACTIVE, deactivatedAt: null },
    });
    return this.toEntity(employee);
  }

  /**
   * PERMANENT delete (SUPER_ADMIN only, guarded at the route). This is for
   * genuinely empty accounts — a mistaken/duplicate record — NOT for normal
   * offboarding, which is deactivate() (soft). We refuse if the employee is
   * referenced by anything that must survive them: direct reports, or any
   * business/financial record they own or authored (the `onDelete: Restrict`
   * relations — payslips, payroll runs, customers, leads, opportunities, bids,
   * orders, bid assessments). Those references are exactly why a raw delete
   * would either fail at the DB or destroy history; we surface a clear,
   * specific error naming the blockers and steer the caller to deactivate.
   *
   * When it DOES proceed, the `onDelete: Cascade` relations (leave balances /
   * requests they filed, attendance, compensation, statutory + bank info,
   * their vault folders/files, audit-actor set-null) are cleaned up by the DB.
   * `caller` guards against deleting yourself.
   */
  async hardDelete(id: string, caller: AuthenticatedUser): Promise<void> {
    if (id === caller.id) {
      throw new BadRequestException('You cannot delete your own account');
    }
    await this.findRawOrThrow(id);

    // Count every reference that must block a permanent delete. Ordered so the
    // error message reads naturally. Direct reports first (org-structure), then
    // financial/audit records, then sales ownership/authorship.
    const [
      directReports,
      payslips,
      payrollRunsInitiated,
      customersOwned,
      leadsOwned,
      opportunitiesOwned,
      bidsCreated,
      ordersOwned,
      bidAssessmentsSubmitted,
    ] = await Promise.all([
      this.prisma.employee.count({ where: { reportingManagerId: id } }),
      this.prisma.payslip.count({ where: { employeeId: id } }),
      this.prisma.payrollRun.count({ where: { initiatedById: id } }),
      this.prisma.customer.count({ where: { ownerId: id } }),
      this.prisma.lead.count({ where: { ownerId: id } }),
      this.prisma.opportunity.count({ where: { ownerId: id } }),
      this.prisma.bid.count({ where: { createdById: id } }),
      this.prisma.order.count({ where: { ownerId: id } }),
      this.prisma.bidDecisionAssessment.count({ where: { submittedById: id } }),
    ]);

    const blockers: string[] = [];
    const add = (n: number, singular: string, plural = `${singular}s`) => {
      if (n > 0) blockers.push(`${n} ${n === 1 ? singular : plural}`);
    };
    add(directReports, 'direct report');
    add(payslips, 'payslip');
    add(payrollRunsInitiated, 'initiated payroll run');
    add(customersOwned, 'owned customer');
    add(leadsOwned, 'owned lead');
    add(opportunitiesOwned, 'owned opportunity', 'owned opportunities');
    add(bidsCreated, 'authored bid');
    add(ordersOwned, 'owned order');
    add(bidAssessmentsSubmitted, 'submitted bid assessment');

    if (blockers.length > 0) {
      throw new ConflictException(
        `Cannot permanently delete this employee — they are still referenced by ${blockers.join(
          ', ',
        )}. Deactivate them instead to preserve this history.`,
      );
    }

    await this.prisma.employee.delete({ where: { id } });
  }

  /**
   * THE downstream-hierarchy lookup: ids of every direct and indirect report
   * of `managerId`, via a recursive CTE. This is the single code path behind
   * Leave/Attendance team views, Sales write-scoping, and Vault TEAM-scope
   * folder visibility — new consumers must call this rather than duplicating
   * the CTE, so the hierarchy semantics can never drift between modules.
   */
  async getTeamIds(managerId: string): Promise<string[]> {
    const rows = await this.prisma.$queryRaw<Array<{ id: string }>>`
      WITH RECURSIVE subtree AS (
        SELECT id FROM employees WHERE id = ${managerId}
        UNION ALL
        SELECT e.id FROM employees e
        INNER JOIN subtree s ON e."reportingManagerId" = s.id
      )
      SELECT id FROM subtree WHERE id != ${managerId}
    `;
    return rows.map((row) => row.id);
  }

  /**
   * Returns every downstream report (direct and indirect) of `managerId` via
   * getTeamIds() — a naive direct-reports-only filter would miss multi-level
   * hierarchies.
   */
  async getTeam(
    managerId: string,
    currentUser: AuthenticatedUser,
  ): Promise<EmployeeEntity[]> {
    if (currentUser.role === Role.MANAGER && currentUser.id !== managerId) {
      throw new ForbiddenException('Managers may only view their own team');
    }

    await this.findRawOrThrow(managerId);

    const ids = await this.getTeamIds(managerId);
    if (ids.length === 0) {
      return [];
    }

    const employees = await this.prisma.employee.findMany({
      where: { id: { in: ids } },
    });
    return employees.map((e) => this.toEntity(e));
  }

  /**
   * HR onboarding (step 1 of 2): creates the personnel record + compensation
   * + statutory + bank rows in one transaction. No role/password/login yet
   * — accessStatus stays PENDING_ACCESS until an Admin calls grantAccess().
   * Cross-vertical exception: HR staff may target any vertical, not just
   * their own.
   */
  async onboard(
    dto: OnboardEmployeeDto,
    currentUser: AuthenticatedUser,
  ): Promise<EmployeeEntity> {
    const isAdmin =
      currentUser.role === Role.ADMIN || currentUser.role === Role.SUPER_ADMIN;
    if (!isAdmin && !(await this.isHrStaff(currentUser))) {
      throw new ForbiddenException(
        'Only HR-vertical staff or Admins may onboard employees',
      );
    }

    const vertical = await this.prisma.vertical.findUnique({
      where: { id: dto.verticalId },
    });
    if (!vertical) {
      throw new BadRequestException(
        'verticalId does not reference an existing vertical',
      );
    }

    const encryptedPan = this.encryption.encrypt(dto.statutoryInfo.panNumber);
    const encryptedPf = this.encryption.encrypt(
      dto.statutoryInfo.pfAccountNumber,
    );
    const encryptedEsic = dto.statutoryInfo.esicNumber
      ? this.encryption.encrypt(dto.statutoryInfo.esicNumber)
      : null;
    const encryptedAccountNumber = this.encryption.encrypt(
      dto.bankDetails.bankAccountNumber,
    );

    const employee = await this.prisma.$transaction(async (tx) => {
      const [{ nextval }] = await tx.$queryRaw<
        [{ nextval: bigint }]
      >`SELECT nextval('employee_id_seq')`;
      const employeeId = `EMP-${nextval.toString().padStart(4, '0')}`;
      const officialEmail = await this.generateOfficialEmail(
        tx,
        dto.firstName,
        dto.lastName,
      );

      const created = await tx.employee.create({
        data: {
          employeeId,
          firstName: dto.firstName,
          lastName: dto.lastName,
          email: officialEmail,
          officialEmail,
          verticalId: dto.verticalId,
          accessStatus: AccessStatus.PENDING_ACCESS,
          dateOfBirth: new Date(dto.dateOfBirth),
          gender: dto.gender,
          personalEmail: dto.personalEmail,
          mobile: dto.mobile,
          designation: dto.designation,
          employmentType: dto.employmentType,
          dateOfJoining: new Date(dto.dateOfJoining),
          workLocation: dto.workLocation,
          emergencyContactName: dto.emergencyContactName,
          emergencyContactRelation: dto.emergencyContactRelation,
          emergencyContactPhone: dto.emergencyContactPhone,
        },
      });

      // ctcAnnual is a documented placeholder: (basic + hra) * 12. Full CTC
      // composition (specialAllowance/otherAllowances) is set later via
      // POST /salary-structures (payroll module), not at onboarding time.
      await tx.salaryStructure.create({
        data: {
          employeeId: created.id,
          effectiveFrom: new Date(dto.compensation.effectiveDate),
          basic: dto.compensation.basicSalary,
          hra: dto.compensation.hra,
          specialAllowance: 0,
          ctcAnnual: (dto.compensation.basicSalary + dto.compensation.hra) * 12,
          createdById: currentUser.id,
        },
      });

      await tx.employeeStatutoryInfo.create({
        data: {
          employeeId: created.id,
          panNumber: encryptedPan,
          aadhaarLast4: dto.statutoryInfo.aadhaarLast4,
          pfAccountNumber: encryptedPf,
          esicNumber: encryptedEsic,
        },
      });

      await tx.employeeBankDetails.create({
        data: {
          employeeId: created.id,
          bankAccountNumber: encryptedAccountNumber,
          ifscCode: dto.bankDetails.ifscCode,
        },
      });

      // Vault: every onboarded employee gets exactly one PERSONAL folder
      // (private, undeletable, versioning not configurable). Created in the
      // same transaction as the Employee row so an employee can never exist
      // without one; a DB partial unique index guarantees at most one.
      await tx.vaultFolder.create({
        data: {
          name: 'My Documents',
          type: 'PERSONAL',
          ownerId: created.id,
          visibilityScope: 'PRIVATE',
        },
      });

      return created;
    });

    return this.toEntity(employee);
  }

  /** Company-wide roster, shaped by caller role (see entities/employee-roster.entity.ts). */
  async getRoster(
    query: RosterQueryDto,
    currentUser: AuthenticatedUser,
  ): Promise<PaginatedResult<EmployeeRosterEntity>> {
    const isAdmin =
      currentUser.role === Role.ADMIN || currentUser.role === Role.SUPER_ADMIN;
    if (!isAdmin && !(await this.isHrStaff(currentUser))) {
      throw new ForbiddenException(
        'Only HR-vertical staff or Admins may view the roster',
      );
    }

    const where = {
      ...(query.verticalId ? { verticalId: query.verticalId } : {}),
      ...(query.status ? { status: query.status } : {}),
    };

    const [items, total] = await this.prisma.$transaction([
      this.prisma.employee.findMany({
        where,
        skip: query.skip,
        take: query.limit,
        orderBy: { createdAt: 'desc' },
        include: isAdmin
          ? {
              salaryStructures: { select: { id: true }, take: 1 },
              statutoryInfo: { select: { id: true } },
              bankDetails: { select: { id: true } },
            }
          : undefined,
      }),
      this.prisma.employee.count({ where }),
    ]);

    return {
      items: items.map((e) =>
        isAdmin
          ? this.toRosterAdminEntity(e as EmployeeWithFileFlags)
          : this.toRosterEntity(e),
      ),
      total,
      page: query.page,
      limit: query.limit,
    };
  }

  /**
   * Lightweight type-ahead search for the share-picker (any authenticated
   * employee). Matches the term case-insensitively against first/last name,
   * email, and employeeId; ACTIVE employees only; capped small result set
   * (never paginated — it's a picker, not a browse). Returns the lean
   * EmployeeSearchResultEntity, so this endpoint exposes nothing the
   * HR/Admin-gated roster protects.
   */
  async search(
    term: string,
    limit = 10,
  ): Promise<EmployeeSearchResultEntity[]> {
    const q = term.trim();
    if (!q) {
      return [];
    }
    const take = Math.min(Math.max(limit, 1), 25);
    const contains = { contains: q, mode: 'insensitive' as const };
    const employees = await this.prisma.employee.findMany({
      where: {
        status: EmployeeStatus.ACTIVE,
        OR: [
          { firstName: contains },
          { lastName: contains },
          { email: contains },
          { employeeId: contains },
        ],
      },
      take,
      orderBy: [{ firstName: 'asc' }, { lastName: 'asc' }],
    });
    return employees.map(
      (e) =>
        new EmployeeSearchResultEntity({
          id: e.id,
          employeeId: e.employeeId,
          firstName: e.firstName,
          lastName: e.lastName,
          fullName: `${e.firstName} ${e.lastName}`.trim(),
          email: e.email,
          verticalId: e.verticalId,
        }),
    );
  }

  /** Shared where-clause for employees awaiting an access grant. */
  private static readonly PENDING_ACCESS_WHERE = {
    accessStatus: AccessStatus.PENDING_ACCESS,
  };

  /**
   * Count of employees awaiting access (company-wide, same where-clause as the
   * list). Role gating (ADMIN/SUPER_ADMIN) is applied by the caller — the
   * notifications endpoint returns 0 for other roles.
   */
  async countPendingAccess(): Promise<number> {
    return this.prisma.employee.count({
      where: EmployeesService.PENDING_ACCESS_WHERE,
    });
  }

  /** Employees still awaiting an Admin's grant-access decision. */
  async getPendingAccess(
    query: PaginationQueryDto,
  ): Promise<PaginatedResult<EmployeeEntity>> {
    const where = EmployeesService.PENDING_ACCESS_WHERE;
    const [items, total] = await this.prisma.$transaction([
      this.prisma.employee.findMany({
        where,
        skip: query.skip,
        take: query.limit,
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.employee.count({ where }),
    ]);

    return {
      items: items.map((e) => this.toEntity(e)),
      total,
      page: query.page,
      limit: query.limit,
    };
  }

  /**
   * Admin grant-access (step 2 of 2): assigns role + vertical, sets the
   * password, activates login, and promotes officialEmail to the login
   * email. Re-runs the standard role/manager validation since this is the
   * point the employee re-enters normal RBAC.
   */
  async grantAccess(id: string, dto: GrantAccessDto): Promise<EmployeeEntity> {
    const current = await this.findRawOrThrow(id);
    if (current.accessStatus !== AccessStatus.PENDING_ACCESS) {
      throw new BadRequestException('Employee access has already been granted');
    }
    if (!current.officialEmail) {
      throw new BadRequestException(
        'Employee has no officialEmail on file — was it onboarded via /employees/onboard?',
      );
    }

    await this.validateVerticalAndManager(
      dto.role,
      dto.verticalId,
      dto.reportingManagerId,
    );

    const passwordHash = await bcrypt.hash(dto.password, 10);

    const employee = await this.prisma.employee.update({
      where: { id },
      data: {
        role: dto.role,
        verticalId: dto.verticalId,
        reportingManagerId: dto.reportingManagerId ?? null,
        passwordHash,
        email: current.officialEmail,
        accessStatus: AccessStatus.ACTIVE,
      },
    });

    return this.toEntity(employee);
  }

  /**
   * Designate this employee as the (single) Sales Head. Atomic: unset any
   * existing holder and set the new one in one transaction, so there is
   * never a window with two holders or none. Idempotent if the target is
   * already the holder. The Sales Head is a designation, not a Role — it
   * gates the Bid/No-Bid assessment review queue, nothing in RBAC.
   */
  async designateSalesHead(id: string): Promise<EmployeeEntity> {
    const target = await this.findRawOrThrow(id);
    if (target.status !== EmployeeStatus.ACTIVE) {
      throw new BadRequestException(
        'Only an active employee can be designated as Sales Head',
      );
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      // Unset every current holder except the target (there should be at
      // most one, but clear defensively in case data ever drifted).
      await tx.employee.updateMany({
        where: { isSalesHead: true, id: { not: id } },
        data: { isSalesHead: false },
      });
      return tx.employee.update({
        where: { id },
        data: { isSalesHead: true },
      });
    });

    return this.toEntity(updated);
  }

  /**
   * Reads the latest-effective SalaryStructure row (the table that
   * replaced EmployeeCompensation) but keeps returning the same response
   * shape as before, since existing consumers (e.g. the web UI's sensitive
   * detail panel) already depend on it.
   */
  async getCompensation(id: string): Promise<EmployeeCompensationEntity> {
    const record = await this.prisma.salaryStructure.findFirst({
      where: { employeeId: id },
      orderBy: { effectiveFrom: 'desc' },
    });
    if (!record) {
      throw new NotFoundException('No compensation record on file');
    }
    return new EmployeeCompensationEntity({
      employeeId: record.employeeId,
      basicSalary: record.basic.toString(),
      hra: record.hra.toString(),
      effectiveDate: record.effectiveFrom,
    });
  }

  async getStatutory(id: string): Promise<EmployeeStatutoryEntity> {
    const record = await this.prisma.employeeStatutoryInfo.findUnique({
      where: { employeeId: id },
    });
    if (!record) {
      throw new NotFoundException('No statutory record on file');
    }
    return new EmployeeStatutoryEntity({
      employeeId: record.employeeId,
      panNumber: this.encryption.decrypt(record.panNumber),
      aadhaarLast4: record.aadhaarLast4,
      pfAccountNumber: this.encryption.decrypt(record.pfAccountNumber),
      esicNumber: record.esicNumber
        ? this.encryption.decrypt(record.esicNumber)
        : null,
    });
  }

  async getBankDetails(id: string): Promise<EmployeeBankDetailsEntity> {
    const record = await this.prisma.employeeBankDetails.findUnique({
      where: { employeeId: id },
    });
    if (!record) {
      throw new NotFoundException('No bank details record on file');
    }
    return new EmployeeBankDetailsEntity({
      employeeId: record.employeeId,
      bankAccountNumber: this.encryption.decrypt(record.bankAccountNumber),
      ifscCode: record.ifscCode,
    });
  }

  /** HR staff = MANAGER/EMPLOYEE whose vertical is the one coded 'HR'. */
  private async isHrStaff(user: AuthenticatedUser): Promise<boolean> {
    if (user.role !== Role.MANAGER && user.role !== Role.EMPLOYEE) {
      return false;
    }
    if (!user.verticalId) {
      return false;
    }
    const vertical = await this.prisma.vertical.findUnique({
      where: { id: user.verticalId },
    });
    return vertical?.code === 'HR';
  }

  /**
   * firstname.lastname@vertixdcs.com, lowercase; increments a numeric
   * suffix on collision (john.doe2@..., john.doe3@...). Runs inside the
   * onboarding transaction to avoid a race between the uniqueness check and
   * the insert.
   */
  private async generateOfficialEmail(
    tx: PrismaTransactionClient,
    firstName: string,
    lastName: string,
  ): Promise<string> {
    const normalize = (part: string) =>
      part.toLowerCase().replace(/[^a-z0-9]/g, '');
    const base = `${normalize(firstName)}.${normalize(lastName)}`;

    let candidate = `${base}@${OFFICIAL_EMAIL_DOMAIN}`;
    let suffix = 2;
    while (
      await tx.employee.findUnique({ where: { officialEmail: candidate } })
    ) {
      candidate = `${base}${suffix}@${OFFICIAL_EMAIL_DOMAIN}`;
      suffix += 1;
    }
    return candidate;
  }

  private toRosterEntity(employee: Employee): EmployeeRosterEntity {
    return new EmployeeRosterEntity({
      id: employee.id,
      employeeId: employee.employeeId,
      firstName: employee.firstName,
      lastName: employee.lastName,
      designation: employee.designation,
      verticalId: employee.verticalId,
      employmentType: employee.employmentType,
      dateOfJoining: employee.dateOfJoining,
      workLocation: employee.workLocation,
      mobile: employee.mobile,
      status: employee.status,
      accessStatus: employee.accessStatus,
    });
  }

  private toRosterAdminEntity(
    employee: EmployeeWithFileFlags,
  ): EmployeeRosterAdminEntity {
    return new EmployeeRosterAdminEntity({
      ...this.toRosterEntity(employee),
      hasCompensationOnFile: employee.salaryStructures.length > 0,
      hasStatutoryInfoOnFile: !!employee.statutoryInfo,
      hasBankDetailsOnFile: !!employee.bankDetails,
    });
  }

  private async findRawOrThrow(id: string): Promise<Employee> {
    const employee = await this.prisma.employee.findUnique({ where: { id } });
    if (!employee) {
      throw new NotFoundException('Employee not found');
    }
    return employee;
  }

  /** reportingManagerId/verticalId are required for every role except SUPER_ADMIN. */
  private async validateVerticalAndManager(
    role: Role | null,
    verticalId?: string | null,
    reportingManagerId?: string | null,
  ): Promise<void> {
    if (role === Role.SUPER_ADMIN) {
      return;
    }

    if (!verticalId) {
      throw new BadRequestException(
        'verticalId is required for all roles except SUPER_ADMIN',
      );
    }
    if (!reportingManagerId) {
      throw new BadRequestException(
        'reportingManagerId is required for all roles except SUPER_ADMIN',
      );
    }

    const vertical = await this.prisma.vertical.findUnique({
      where: { id: verticalId },
    });
    if (!vertical) {
      throw new BadRequestException(
        'verticalId does not reference an existing vertical',
      );
    }

    const manager = await this.prisma.employee.findUnique({
      where: { id: reportingManagerId },
    });
    if (!manager || manager.status !== EmployeeStatus.ACTIVE) {
      throw new BadRequestException(
        'reportingManagerId does not reference an active employee',
      );
    }
  }

  /** Walk the candidate manager's own chain up; reject if it reaches `employeeId`. */
  private async assertNoCycle(
    employeeId: string,
    newManagerId: string,
  ): Promise<void> {
    let currentId: string | null = newManagerId;
    const visited = new Set<string>();

    while (currentId) {
      if (currentId === employeeId) {
        throw new BadRequestException(
          'Manager reassignment would create a reporting cycle',
        );
      }
      if (visited.has(currentId)) {
        break;
      }
      visited.add(currentId);

      const manager: { reportingManagerId: string | null } | null =
        await this.prisma.employee.findUnique({
          where: { id: currentId },
          select: { reportingManagerId: true },
        });
      currentId = manager?.reportingManagerId ?? null;
    }
  }

  private toEntity(employee: Employee): EmployeeEntity {
    return new EmployeeEntity({
      id: employee.id,
      employeeId: employee.employeeId,
      firstName: employee.firstName,
      lastName: employee.lastName,
      email: employee.email,
      role: employee.role,
      verticalId: employee.verticalId,
      reportingManagerId: employee.reportingManagerId,
      status: employee.status,
      deactivatedAt: employee.deactivatedAt,
      accessStatus: employee.accessStatus,
      isSalesHead: employee.isSalesHead,
      officialEmail: employee.officialEmail,
      signatureText: employee.signatureText,
      signatureFont: employee.signatureFont,
      createdAt: employee.createdAt,
      updatedAt: employee.updatedAt,
    });
  }
}
