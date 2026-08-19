import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { EmployeeStatus, PingRecipientStatus, Prisma, Role } from '@prisma/client';
import { PrismaService } from '../../core/database/prisma.service';
import { AuthenticatedUser } from '../../common/decorators/current-user.decorator';
import { CreateContextualPingDto, CreatePingDto } from './dto/pings.dto';

// Employee has no `fullName` column — derive it from first/last name (see employees.service.ts:841).
const employeeSelect = { id: true, firstName: true, lastName: true, email: true, employeeId: true } as const;

type RawPingEmployee = { id: string; firstName: string; lastName: string; email: string; employeeId: string };

function toPingEmployee(e: RawPingEmployee) {
  return { id: e.id, fullName: `${e.firstName} ${e.lastName}`.trim(), email: e.email, employeeId: e.employeeId };
}

@Injectable()
export class PingsService {
  constructor(private readonly prisma: PrismaService) {}

  async create(user: AuthenticatedUser, dto: CreatePingDto) {
    const message = dto.message.trim();
    if (!message) throw new BadRequestException('Ping message is required');
    const recipientIds = [...new Set(dto.recipientIds)].filter((id) => id !== user.id);
    if (!recipientIds.length) throw new BadRequestException('Select at least one other recipient');
    const count = await this.prisma.employee.count({ where: { id: { in: recipientIds }, status: EmployeeStatus.ACTIVE } });
    if (count !== recipientIds.length) throw new BadRequestException('One or more recipients are unavailable');
    const ping = await this.prisma.ping.create({
      data: {
        fromEmployeeId: user.id,
        message,
        linkedRecordType: dto.linkedRecordType?.trim() || null,
        linkedRecordId: dto.linkedRecordId?.trim() || null,
        recipients: { create: recipientIds.map((employeeId) => ({ employeeId })) },
      },
      include: { fromEmployee: { select: employeeSelect }, recipients: { include: { employee: { select: employeeSelect } } } },
    });
    return {
      ...ping,
      fromEmployee: toPingEmployee(ping.fromEmployee),
      recipients: ping.recipients.map((r) => ({ ...r, employee: toPingEmployee(r.employee) })),
    };
  }

  async createContextual(user: AuthenticatedUser, dto: CreateContextualPingDto) {
    if (!dto.linkedRecordType || !dto.linkedRecordId) throw new BadRequestException('A contextual ping must be linked to its current page');
    const eligible = await this.recipients(user, dto.verticalCode, dto.linkedRecordType, dto.linkedRecordId);
    const allowed = new Set(eligible.map((employee) => employee.id));
    if (dto.recipientIds.some((id) => !allowed.has(id))) throw new ForbiddenException('One or more recipients do not have access to this page context');
    return this.create(user, dto);
  }

  async received(user: AuthenticatedUser) {
    const rows = await this.withSchemaReady(() => this.prisma.pingRecipient.findMany({
      where: { employeeId: user.id },
      include: { ping: { include: { fromEmployee: { select: employeeSelect } } } },
    }));
    return rows
      .sort((a, b) => {
        const ap = a.status === PingRecipientStatus.PENDING ? 0 : 1;
        const bp = b.status === PingRecipientStatus.PENDING ? 0 : 1;
        return ap - bp || (ap === 0
          ? a.ping.createdAt.getTime() - b.ping.createdAt.getTime()
          : b.ping.createdAt.getTime() - a.ping.createdAt.getTime());
      })
      .map((r) => ({ ...r, ping: { ...r.ping, fromEmployee: toPingEmployee(r.ping.fromEmployee) } }));
  }

  async sent(user: AuthenticatedUser) {
    const rows = await this.withSchemaReady(() => this.prisma.ping.findMany({
      where: { fromEmployeeId: user.id },
      include: { recipients: { include: { employee: { select: employeeSelect } } } },
      orderBy: { createdAt: 'desc' },
    }));
    return rows.map((ping) => ({
      ...ping,
      recipients: ping.recipients.map((r) => ({ ...r, employee: toPingEmployee(r.employee) })),
    }));
  }

  async updateStatus(id: string, user: AuthenticatedUser, status: PingRecipientStatus) {
    if (status === PingRecipientStatus.PENDING) throw new BadRequestException('A response must acknowledge or resolve the ping');
    const recipient = await this.prisma.pingRecipient.findUnique({ where: { id } });
    if (!recipient) throw new NotFoundException('Ping recipient not found');
    if (recipient.employeeId !== user.id) throw new ForbiddenException('You can only respond to your own pings');
    if (recipient.status === PingRecipientStatus.RESOLVED) throw new BadRequestException('This ping is already resolved');
    if (recipient.status === PingRecipientStatus.ACKNOWLEDGED && status === PingRecipientStatus.ACKNOWLEDGED) return recipient;
    return this.prisma.pingRecipient.update({ where: { id }, data: { status, respondedAt: new Date() } });
  }

  async recipients(user: AuthenticatedUser, verticalCode?: string, linkedRecordType?: string, linkedRecordId?: string) {
    const caller = await this.prisma.employee.findUnique({ where: { id: user.id }, select: { verticalId: true } });
    let verticalId = caller?.verticalId ?? null;
    if (verticalCode) {
      const requested = await this.prisma.vertical.findUnique({ where: { code: verticalCode }, select: { id: true } });
      if (!requested) throw new BadRequestException('This page is not mapped to an active vertical');
      if (user.role !== Role.SUPER_ADMIN && requested.id !== verticalId) throw new ForbiddenException('Contextual pings cannot be sent outside your vertical');
      verticalId = requested.id;
    }

    if (user.role === Role.SUPER_ADMIN && linkedRecordType === 'KANBAN_BOARD' && linkedRecordId) {
      const board = await this.prisma.kanbanBoard.findUnique({
        where: { id: linkedRecordId },
        select: { createdBy: { select: employeeSelect }, members: { select: { employee: { select: employeeSelect } } } },
      });
      if (!board) throw new NotFoundException('Board not found');
      const people = [board.createdBy, ...board.members.map((m) => m.employee)];
      return [...new Map(people.filter((e) => e.id !== user.id).map((e) => [e.id, toPingEmployee(e)])).values()];
    }

    const adminOnlyPage = user.role === Role.SUPER_ADMIN && linkedRecordType === 'PAGE' && linkedRecordId?.startsWith('/admin/');

    const employees = await this.prisma.employee.findMany({
      where: { status: EmployeeStatus.ACTIVE, id: { not: user.id }, ...(adminOnlyPage ? { role: { in: [Role.ADMIN, Role.SUPER_ADMIN] } } : verticalId ? { verticalId } : {}) },
      select: employeeSelect,
      orderBy: [{ firstName: 'asc' }, { lastName: 'asc' }],
    });
    return employees.map(toPingEmployee);
  }

  private async withSchemaReady<T>(operation: () => Promise<T>): Promise<T> {
    try { return await operation(); } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && (error.code === 'P2021' || error.code === 'P2022')) {
        throw new BadRequestException('Pings database migration is not applied. Run prisma migrate deploy and restart the API.');
      }
      throw error;
    }
  }
}
