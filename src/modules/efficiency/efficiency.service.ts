import { Injectable } from '@nestjs/common';
import { KanbanCardStatus } from '@prisma/client';
import { PrismaService } from '../../core/database/prisma.service';
import {
  combinedEfficiency,
  EFFICIENCY_WINDOW_DAYS,
  pingSla,
  taskSla,
} from './efficiency-score';

@Injectable()
export class EfficiencyService {
  constructor(private readonly prisma: PrismaService) {}

  async mine(employeeId: string, now = new Date()) {
    const windowStart = new Date(
      now.getTime() - EFFICIENCY_WINDOW_DAYS * 24 * 60 * 60 * 1000,
    );
    const [pingRows, taskRows] = await Promise.all([
      this.prisma.pingRecipient.findMany({
        where: {
          employeeId,
          ping: { createdAt: { gte: windowStart, lte: now } },
        },
        select: {
          status: true,
          acknowledgedAt: true,
          respondedAt: true,
          ping: { select: { createdAt: true } },
        },
      }),
      this.prisma.kanbanCard.findMany({
        where: {
          assigneeId: employeeId,
          status: KanbanCardStatus.ACTIVE,
          dueDate: { not: null },
          OR: [
            { completedAt: { gte: windowStart, lte: now } },
            { completedAt: null, dueDate: { gte: windowStart, lt: now } },
          ],
        },
        select: { dueDate: true, completedAt: true },
      }),
    ]);
    const ping = pingSla(
      pingRows.map((row) => ({
        createdAt: row.ping.createdAt,
        respondedAt: row.acknowledgedAt ?? row.respondedAt,
        status: row.status,
      })),
    );
    const task = taskSla(
      taskRows.map((row) => ({
        dueDate: row.dueDate!,
        completedAt: row.completedAt,
      })),
    );
    return {
      score: combinedEfficiency(ping, task),
      windowDays: EFFICIENCY_WINDOW_DAYS,
      windowStart,
      ping,
      task,
    };
  }
}
