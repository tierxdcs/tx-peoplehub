import { Injectable } from '@nestjs/common';
import { DeliveryChallanStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../../core/database/prisma.service';
import { AuthenticatedUser } from '../../common/decorators/current-user.decorator';

/**
 * On-Time Delivery reporting. Fully COMPUTED from DeliveryChallan data (promised
 * vs actual delivery dates) — no stored metrics that could drift. A DC counts
 * toward OTD only once it has both a promisedDeliveryDate and an
 * actualDeliveryDate (i.e. delivered with POD captured).
 */
@Injectable()
export class OtdService {
  constructor(private readonly prisma: PrismaService) {}

  async report(
    user: AuthenticatedUser,
    opts: { from?: string; to?: string } = {},
  ) {
    void user; // company-wide read
    const where: Prisma.DeliveryChallanWhereInput = {
      status: DeliveryChallanStatus.DELIVERED,
      promisedDeliveryDate: { not: null },
      actualDeliveryDate: { not: null },
    };
    if (opts.from || opts.to) {
      where.actualDeliveryDate = {
        not: null,
        ...(opts.from ? { gte: new Date(opts.from) } : {}),
        ...(opts.to ? { lte: new Date(opts.to) } : {}),
      };
    }

    const dcs = await this.prisma.deliveryChallan.findMany({
      where,
      select: {
        id: true,
        dcNumber: true,
        promisedDeliveryDate: true,
        actualDeliveryDate: true,
        customerId: true,
        customer: { select: { name: true } },
      },
      orderBy: { actualDeliveryDate: 'desc' },
    });

    const DAY = 24 * 60 * 60 * 1000;
    let onTime = 0;
    let late = 0;
    let totalDelayDays = 0;
    const byCustomer = new Map<
      string,
      { customerId: string; customerName: string; total: number; onTime: number; late: number }
    >();

    const rows = dcs.map((dc) => {
      const promised = dc.promisedDeliveryDate!.getTime();
      const actual = dc.actualDeliveryDate!.getTime();
      // Delay in whole days, rounded up; <= 0 means on-time.
      const delayDays = Math.ceil((actual - promised) / DAY);
      const isLate = delayDays > 0;
      if (isLate) {
        late += 1;
        totalDelayDays += delayDays;
      } else {
        onTime += 1;
      }
      const c = byCustomer.get(dc.customerId) ?? {
        customerId: dc.customerId,
        customerName: dc.customer?.name ?? '—',
        total: 0,
        onTime: 0,
        late: 0,
      };
      c.total += 1;
      if (isLate) c.late += 1;
      else c.onTime += 1;
      byCustomer.set(dc.customerId, c);

      return {
        id: dc.id,
        dcNumber: dc.dcNumber,
        customerName: dc.customer?.name ?? '—',
        promisedDeliveryDate: dc.promisedDeliveryDate!.toISOString(),
        actualDeliveryDate: dc.actualDeliveryDate!.toISOString(),
        delayDays,
        onTime: !isLate,
      };
    });

    const total = onTime + late;
    return {
      summary: {
        totalDelivered: total,
        onTime,
        late,
        onTimePercentage: total ? Math.round((onTime / total) * 1000) / 10 : null,
        averageDelayDays: late ? Math.round((totalDelayDays / late) * 10) / 10 : 0,
      },
      byCustomer: [...byCustomer.values()].map((c) => ({
        ...c,
        onTimePercentage: c.total ? Math.round((c.onTime / c.total) * 1000) / 10 : null,
      })),
      dispatches: rows,
    };
  }
}
