import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Payslip, Role } from '@prisma/client';
import { PrismaService } from '../../core/database/prisma.service';
import { AuthenticatedUser } from '../../common/decorators/current-user.decorator';
import {
  PaginatedResult,
  PaginationQueryDto,
} from '../../common/dto/pagination.dto';
import { PayslipEntity } from './entities/payslip.entity';

@Injectable()
export class PayslipsService {
  constructor(private readonly prisma: PrismaService) {}

  async getOwn(
    employeeId: string,
    query: PaginationQueryDto,
  ): Promise<PaginatedResult<PayslipEntity>> {
    const where = { employeeId };
    const [items, total] = await this.prisma.$transaction([
      this.prisma.payslip.findMany({
        where,
        skip: query.skip,
        take: query.limit,
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.payslip.count({ where }),
    ]);
    return {
      items: items.map((p) => this.toEntity(p)),
      total,
      page: query.page,
      limit: query.limit,
    };
  }

  async findOne(
    id: string,
    currentUser: AuthenticatedUser,
  ): Promise<PayslipEntity> {
    const payslip = await this.prisma.payslip.findUnique({ where: { id } });
    if (!payslip) {
      throw new NotFoundException('Payslip not found');
    }
    const isAdmin =
      currentUser.role === Role.ADMIN || currentUser.role === Role.SUPER_ADMIN;
    if (!isAdmin && payslip.employeeId !== currentUser.id) {
      throw new ForbiddenException('Cannot view another employee’s payslip');
    }
    return this.toEntity(payslip);
  }

  private toEntity(payslip: Payslip): PayslipEntity {
    return new PayslipEntity({
      id: payslip.id,
      payrollRunId: payslip.payrollRunId,
      employeeId: payslip.employeeId,
      grossEarnings: payslip.grossEarnings.toString(),
      basicPaid: payslip.basicPaid.toString(),
      hraPaid: payslip.hraPaid.toString(),
      specialAllowancePaid: payslip.specialAllowancePaid.toString(),
      otherAllowancesPaid: payslip.otherAllowancesPaid.toString(),
      pfEmployee: payslip.pfEmployee.toString(),
      pfEmployer: payslip.pfEmployer.toString(),
      esiEmployee: payslip.esiEmployee?.toString() ?? null,
      esiEmployer: payslip.esiEmployer?.toString() ?? null,
      professionalTax: payslip.professionalTax?.toString() ?? null,
      tdsDeducted: payslip.tdsDeducted.toString(),
      unpaidLeaveDeduction: payslip.unpaidLeaveDeduction.toString(),
      netPay: payslip.netPay.toString(),
      statutoryConfigSnapshot: payslip.statutoryConfigSnapshot as Record<
        string,
        unknown
      >,
      status: payslip.status,
      createdAt: payslip.createdAt,
    });
  }
}
