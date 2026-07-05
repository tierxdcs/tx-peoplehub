import { Injectable } from '@nestjs/common';
import { LeaveType } from '@prisma/client';
import { PrismaService } from '../../core/database/prisma.service';
import { LeaveTypeEntity } from './entities/leave-type.entity';

@Injectable()
export class LeaveTypesService {
  constructor(private readonly prisma: PrismaService) {}

  async findAllActive(): Promise<LeaveTypeEntity[]> {
    const types = await this.prisma.leaveType.findMany({
      where: { isActive: true },
      orderBy: { code: 'asc' },
    });
    return types.map((t) => this.toEntity(t));
  }

  private toEntity(leaveType: LeaveType): LeaveTypeEntity {
    return new LeaveTypeEntity({
      id: leaveType.id,
      code: leaveType.code,
      name: leaveType.name,
      accrualType: leaveType.accrualType,
      annualQuota: leaveType.annualQuota?.toString() ?? null,
      carryForwardCap: leaveType.carryForwardCap?.toString() ?? null,
      isActive: leaveType.isActive,
    });
  }
}
