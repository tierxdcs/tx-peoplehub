import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Employee, EmployeeStatus, Role } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import { PrismaService } from '../../core/database/prisma.service';
import { AuthenticatedUser } from '../../common/decorators/current-user.decorator';
import {
  PaginatedResult,
  PaginationQueryDto,
} from '../../common/dto/pagination.dto';
import { CreateEmployeeDto } from './dto/create-employee.dto';
import { UpdateEmployeeDto } from './dto/update-employee.dto';
import { EmployeeEntity } from './entities/employee.entity';

@Injectable()
export class EmployeesService {
  constructor(private readonly prisma: PrismaService) {}

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

  async findOne(
    id: string,
    currentUser: AuthenticatedUser,
  ): Promise<EmployeeEntity> {
    const isAdmin =
      currentUser.role === Role.ADMIN || currentUser.role === Role.SUPER_ADMIN;
    if (!isAdmin && currentUser.id !== id) {
      throw new ForbiddenException('Cannot view another employee');
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

  async deactivate(id: string): Promise<EmployeeEntity> {
    await this.findRawOrThrow(id);
    const employee = await this.prisma.employee.update({
      where: { id },
      data: { status: EmployeeStatus.INACTIVE, deactivatedAt: new Date() },
    });
    return this.toEntity(employee);
  }

  /**
   * Returns every downstream report (direct and indirect) of `managerId` via
   * a recursive CTE — a naive direct-reports-only filter would miss
   * multi-level hierarchies.
   */
  async getTeam(
    managerId: string,
    currentUser: AuthenticatedUser,
  ): Promise<EmployeeEntity[]> {
    if (currentUser.role === Role.MANAGER && currentUser.id !== managerId) {
      throw new ForbiddenException('Managers may only view their own team');
    }

    await this.findRawOrThrow(managerId);

    const rows = await this.prisma.$queryRaw<Array<{ id: string }>>`
      WITH RECURSIVE subtree AS (
        SELECT id FROM employees WHERE id = ${managerId}
        UNION ALL
        SELECT e.id FROM employees e
        INNER JOIN subtree s ON e."reportingManagerId" = s.id
      )
      SELECT id FROM subtree WHERE id != ${managerId}
    `;

    const ids = rows.map((row) => row.id);
    if (ids.length === 0) {
      return [];
    }

    const employees = await this.prisma.employee.findMany({
      where: { id: { in: ids } },
    });
    return employees.map((e) => this.toEntity(e));
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
    role: Role,
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
      createdAt: employee.createdAt,
      updatedAt: employee.updatedAt,
    });
  }
}
