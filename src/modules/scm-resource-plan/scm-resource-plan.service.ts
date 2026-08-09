import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { BomStatus, KickoffStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../../core/database/prisma.service';
import { AuthenticatedUser } from '../../common/decorators/current-user.decorator';
import { ItemCostService } from '../bom/item-cost.service';
import {
  ExplodableBom,
  explodeBom,
} from '../bom/bom-explosion';
import { round } from '../bom/stock-calc';
import { ScmResourcePlanAccessService } from './scm-resource-plan-access.service';
import { UpdateResourcePlanLineDto } from './dto/scm-resource-plan.dto';
import {
  CrossProjectSummaryRowEntity,
  EligibleProjectEntity,
  ResourcePlanEntity,
  ResourcePlanLineEntity,
  ResourcePlanSummaryEntity,
} from './entities/scm-resource-plan.entity';

/**
 * SCM Resource Planning Sheet.
 *
 * Reuses the SINGLE multi-level BOM explosion + cycle detection built for the
 * kickoff stock report (explodeBom) — there is no second explosion here. For a
 * completed project it aggregates the gross requirement (wastage folded in) of
 * every leaf item across all order lines, snapshots each item's current
 * benchmark cost (ItemCostService.currentCost), and lets SCM enter a negotiated
 * price per unit. Line/plan totals + variance are computed on READ from the
 * stored per-unit values so they can never drift (§1).
 */
@Injectable()
export class ScmResourcePlanService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: ScmResourcePlanAccessService,
    private readonly itemCost: ItemCostService,
  ) {}

  // ── Money / percent rounding (quantities use stock-calc.round @ 4dp) ──
  private roundMoney(d: Prisma.Decimal): Prisma.Decimal {
    return d.toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);
  }
  private roundPercent(d: Prisma.Decimal): Prisma.Decimal {
    return d.toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);
  }

  // ── Generate / Regenerate (§2) ───────────────────────────────────────
  /**
   * Generate the plan for a completed kickoff, or regenerate an existing one.
   * Regeneration PRESERVES already-entered negotiated prices (and the original
   * benchmark snapshot) for items that still exist, refreshes their required
   * quantity, adds lines for newly-required items (fresh benchmark snapshot),
   * and removes lines for items no longer required.
   */
  async generate(
    kickoffId: string,
    user: AuthenticatedUser,
  ): Promise<ResourcePlanEntity> {
    await this.access.assertCanGenerate(user);

    const kickoff = await this.prisma.projectKickoff.findUnique({
      where: { id: kickoffId },
      include: {
        order: {
          include: {
            lineItems: {
              include: {
                product: { select: { id: true, itemId: true } },
              },
            },
          },
        },
        resourcePlan: { include: { lines: true } },
      },
    });
    if (!kickoff) throw new NotFoundException('Project kickoff not found');
    if (kickoff.status !== KickoffStatus.COMPLETED) {
      throw new BadRequestException(
        'A resource plan can only be generated for a completed project kickoff',
      );
    }

    const lineItems = kickoff.order.lineItems;
    if (lineItems.length === 0) {
      throw new BadRequestException(
        'This kickoff’s order has no line items to build requirements from',
      );
    }

    // Aggregate gross requirement per leaf item across ALL order lines using the
    // shared explosion (wastage compounded into quantityPerTopUnit).
    const releasedByItem = await this.loadReleasedBomIndex();
    type Agg = {
      itemId: string;
      unitOfMeasure: string;
      requiredQuantity: Prisma.Decimal;
    };
    const byItem = new Map<string, Agg>();
    let anyBom = false;

    for (const li of lineItems) {
      const topItemId = li.product.itemId;
      if (!topItemId) continue; // product not linked to an Item → no BOM
      if (!releasedByItem.get(topItemId)) continue; // no released BOM
      anyBom = true;

      const leaves = explodeBom(
        topItemId,
        (itemId) => releasedByItem.get(itemId) ?? null,
      );
      for (const leaf of leaves) {
        const gross = round(leaf.quantityPerTopUnit.times(li.quantity));
        const existing = byItem.get(leaf.itemId);
        if (existing) {
          existing.requiredQuantity = round(
            existing.requiredQuantity.plus(gross),
          );
        } else {
          byItem.set(leaf.itemId, {
            itemId: leaf.itemId,
            unitOfMeasure: leaf.unitOfMeasure,
            requiredQuantity: gross,
          });
        }
      }
    }

    if (!anyBom) {
      throw new BadRequestException(
        'No released BOM exists for any product on this order — release a BOM before generating the resource plan',
      );
    }
    if (byItem.size === 0) {
      throw new BadRequestException(
        'The released BOM(s) for this order have no leaf material requirements to plan',
      );
    }

    const aggregates = [...byItem.values()];
    const itemMeta = await this.loadItemMeta(aggregates.map((a) => a.itemId));

    // Benchmark cost snapshot for each required item (null → 0; column is NOT
    // NULL). Fetched outside the transaction — currentCost only reads.
    const benchmarkByItem = new Map<string, Prisma.Decimal>();
    for (const agg of aggregates) {
      const cost = await this.itemCost.currentCost(agg.itemId);
      benchmarkByItem.set(agg.itemId, cost.amount ?? new Prisma.Decimal(0));
    }

    const existingPlan = kickoff.resourcePlan;
    const requiredItemIds = new Set(aggregates.map((a) => a.itemId));

    await this.prisma.$transaction(async (tx) => {
      const plan = existingPlan
        ? await tx.projectResourcePlan.update({
            where: { id: existingPlan.id },
            data: { generatedAt: new Date(), generatedById: user.id },
          })
        : await tx.projectResourcePlan.create({
            data: {
              projectKickoffId: kickoffId,
              orderId: kickoff.orderId,
              generatedById: user.id,
            },
          });

      const existingLineByItem = new Map(
        (existingPlan?.lines ?? []).map((l) => [l.itemId, l]),
      );

      for (const agg of aggregates) {
        const meta = itemMeta.get(agg.itemId);
        const prior = existingLineByItem.get(agg.itemId);
        if (prior) {
          // Item still required: refresh quantity + code/name only. Preserve the
          // ORIGINAL benchmark snapshot, negotiated price, and notes.
          await tx.projectResourcePlanLine.update({
            where: { id: prior.id },
            data: {
              requiredQuantity: agg.requiredQuantity,
              unitOfMeasure: agg.unitOfMeasure,
              itemCode: meta?.itemCode ?? agg.itemId,
              itemName: meta?.name ?? 'Unknown item',
            },
          });
        } else {
          // Newly-required item: fresh benchmark snapshot, no negotiated price.
          await tx.projectResourcePlanLine.create({
            data: {
              resourcePlanId: plan.id,
              itemId: agg.itemId,
              itemCode: meta?.itemCode ?? agg.itemId,
              itemName: meta?.name ?? 'Unknown item',
              requiredQuantity: agg.requiredQuantity,
              unitOfMeasure: agg.unitOfMeasure,
              benchmarkCostPerUnit:
                benchmarkByItem.get(agg.itemId) ?? new Prisma.Decimal(0),
            },
          });
        }
      }

      // Remove lines whose item is no longer required by the current BOMs.
      const staleIds = (existingPlan?.lines ?? [])
        .filter((l) => !requiredItemIds.has(l.itemId))
        .map((l) => l.id);
      if (staleIds.length > 0) {
        await tx.projectResourcePlanLine.deleteMany({
          where: { id: { in: staleIds } },
        });
      }
    });

    return this.readOrThrow(kickoffId, user);
  }

  // ── Read a single project's plan (§4) ────────────────────────────────
  async read(
    kickoffId: string,
    user: AuthenticatedUser,
  ): Promise<ResourcePlanEntity | null> {
    await this.access.assertCanView(user);
    const plan = await this.prisma.projectResourcePlan.findUnique({
      where: { projectKickoffId: kickoffId },
      include: {
        lines: { orderBy: { itemCode: 'asc' } },
        projectKickoff: { select: { projectName: true } },
        order: { select: { orderNumber: true } },
        generatedBy: { select: { firstName: true, lastName: true } },
      },
    });
    if (!plan) return null;
    return this.toEntity(plan);
  }

  private async readOrThrow(
    kickoffId: string,
    user: AuthenticatedUser,
  ): Promise<ResourcePlanEntity> {
    const plan = await this.read(kickoffId, user);
    if (!plan) throw new NotFoundException('Resource plan not found');
    return plan;
  }

  // ── Edit a negotiated price / note (§4) ───────────────────────────────
  async updateLine(
    lineId: string,
    dto: UpdateResourcePlanLineDto,
    user: AuthenticatedUser,
  ): Promise<ResourcePlanLineEntity> {
    await this.access.assertCanEdit(user);
    const line = await this.prisma.projectResourcePlanLine.findUnique({
      where: { id: lineId },
    });
    if (!line) throw new NotFoundException('Resource plan line not found');

    const data: Prisma.ProjectResourcePlanLineUpdateInput = {};
    if (dto.negotiatedPricePerUnit !== undefined) {
      data.negotiatedPricePerUnit =
        dto.negotiatedPricePerUnit === null
          ? null
          : new Prisma.Decimal(dto.negotiatedPricePerUnit);
    }
    if (dto.notes !== undefined) {
      data.notes = dto.notes === null ? null : dto.notes;
    }

    const updated = await this.prisma.projectResourcePlanLine.update({
      where: { id: lineId },
      data,
    });
    return this.lineEntity(updated);
  }

  // ── Project list (§3): every COMPLETED kickoff ────────────────────────
  async listEligibleProjects(
    user: AuthenticatedUser,
  ): Promise<EligibleProjectEntity[]> {
    await this.access.assertCanView(user);
    const kickoffs = await this.prisma.projectKickoff.findMany({
      where: { status: KickoffStatus.COMPLETED },
      include: {
        order: {
          select: {
            id: true,
            orderNumber: true,
            customer: { select: { name: true } },
          },
        },
        resourcePlan: { include: { lines: true } },
      },
      orderBy: { meetingDate: 'desc' },
    });

    return kickoffs.map((k) => {
      const plan = k.resourcePlan;
      if (!plan) {
        return new EligibleProjectEntity({
          projectKickoffId: k.id,
          projectName: k.projectName,
          orderId: k.order.id,
          orderNumber: k.order.orderNumber,
          customerName: k.order.customer.name,
          hasPlan: false,
          planId: null,
          generatedAt: null,
          totalBenchmarkCost: null,
          totalNegotiatedCost: null,
          varianceAmount: null,
          variancePercent: null,
        });
      }
      const summary = this.computeSummary(plan.lines);
      return new EligibleProjectEntity({
        projectKickoffId: k.id,
        projectName: k.projectName,
        orderId: k.order.id,
        orderNumber: k.order.orderNumber,
        customerName: k.order.customer.name,
        hasPlan: true,
        planId: plan.id,
        generatedAt: plan.generatedAt.toISOString(),
        totalBenchmarkCost: summary.totalBenchmarkCost,
        totalNegotiatedCost: summary.totalNegotiatedCost,
        varianceAmount: summary.varianceAmount,
        variancePercent: summary.variancePercent,
      });
    });
  }

  // ── Cross-project summary (§5): every project WITH a plan ─────────────
  async crossProjectSummary(
    user: AuthenticatedUser,
  ): Promise<CrossProjectSummaryRowEntity[]> {
    await this.access.assertCanView(user);
    const plans = await this.prisma.projectResourcePlan.findMany({
      include: {
        lines: true,
        projectKickoff: { select: { projectName: true } },
        order: {
          select: {
            orderNumber: true,
            customer: { select: { name: true } },
          },
        },
      },
      orderBy: { generatedAt: 'desc' },
    });

    return plans.map((plan) => {
      const summary = this.computeSummary(plan.lines);
      return new CrossProjectSummaryRowEntity({
        planId: plan.id,
        projectKickoffId: plan.projectKickoffId,
        projectName: plan.projectKickoff.projectName,
        orderNumber: plan.order.orderNumber,
        customerName: plan.order.customer.name,
        generatedAt: plan.generatedAt.toISOString(),
        totalBenchmarkCost: summary.totalBenchmarkCost,
        totalNegotiatedCost: summary.totalNegotiatedCost,
        varianceAmount: summary.varianceAmount,
        variancePercent: summary.variancePercent,
        lineCount: summary.lineCount,
        negotiatedLineCount: summary.negotiatedLineCount,
      });
    });
  }

  // ── Mapping / computation ─────────────────────────────────────────────
  private toEntity(
    plan: Prisma.ProjectResourcePlanGetPayload<{
      include: {
        lines: true;
        projectKickoff: { select: { projectName: true } };
        order: { select: { orderNumber: true } };
        generatedBy: { select: { firstName: true; lastName: true } };
      };
    }>,
  ): ResourcePlanEntity {
    const lines = plan.lines.map((l) => this.lineEntity(l));
    return new ResourcePlanEntity({
      id: plan.id,
      projectKickoffId: plan.projectKickoffId,
      projectName: plan.projectKickoff.projectName,
      orderId: plan.orderId,
      orderNumber: plan.order.orderNumber,
      generatedAt: plan.generatedAt.toISOString(),
      generatedById: plan.generatedById,
      generatedByName: plan.generatedBy
        ? `${plan.generatedBy.firstName} ${plan.generatedBy.lastName}`.trim()
        : null,
      lines,
      summary: this.computeSummary(plan.lines),
    });
  }

  /** Compute a single line's totals + variance from its stored per-unit values. */
  private lineEntity(line: {
    id: string;
    itemId: string;
    itemCode: string;
    itemName: string;
    requiredQuantity: Prisma.Decimal;
    unitOfMeasure: string;
    benchmarkCostPerUnit: Prisma.Decimal;
    negotiatedPricePerUnit: Prisma.Decimal | null;
    notes: string | null;
  }): ResourcePlanLineEntity {
    const qty = line.requiredQuantity;
    const benchmarkLineTotal = this.roundMoney(
      line.benchmarkCostPerUnit.times(qty),
    );

    let negotiatedLineTotal: Prisma.Decimal | null = null;
    let varianceAmount: Prisma.Decimal | null = null;
    let variancePercent: Prisma.Decimal | null = null;
    if (line.negotiatedPricePerUnit !== null) {
      negotiatedLineTotal = this.roundMoney(
        line.negotiatedPricePerUnit.times(qty),
      );
      varianceAmount = this.roundMoney(
        negotiatedLineTotal.minus(benchmarkLineTotal),
      );
      variancePercent = benchmarkLineTotal.greaterThan(0)
        ? this.roundPercent(
            varianceAmount.dividedBy(benchmarkLineTotal).times(100),
          )
        : null;
    }

    return new ResourcePlanLineEntity({
      id: line.id,
      itemId: line.itemId,
      itemCode: line.itemCode,
      itemName: line.itemName,
      requiredQuantity: qty.toString(),
      unitOfMeasure: line.unitOfMeasure,
      benchmarkCostPerUnit: line.benchmarkCostPerUnit.toString(),
      negotiatedPricePerUnit:
        line.negotiatedPricePerUnit !== null
          ? line.negotiatedPricePerUnit.toString()
          : null,
      notes: line.notes,
      benchmarkLineTotal: benchmarkLineTotal.toString(),
      negotiatedLineTotal:
        negotiatedLineTotal !== null ? negotiatedLineTotal.toString() : null,
      varianceAmount: varianceAmount !== null ? varianceAmount.toString() : null,
      variancePercent:
        variancePercent !== null ? variancePercent.toString() : null,
    });
  }

  /**
   * Plan-level totals. Unpriced lines fall back to their benchmark total for the
   * negotiated sum so the whole-project comparison stays complete.
   */
  private computeSummary(
    lines: Array<{
      requiredQuantity: Prisma.Decimal;
      benchmarkCostPerUnit: Prisma.Decimal;
      negotiatedPricePerUnit: Prisma.Decimal | null;
    }>,
  ): ResourcePlanSummaryEntity {
    const zero = new Prisma.Decimal(0);
    let totalBenchmark = zero;
    let totalNegotiated = zero;
    let negotiatedLineCount = 0;

    for (const line of lines) {
      const benchmarkTotal = this.roundMoney(
        line.benchmarkCostPerUnit.times(line.requiredQuantity),
      );
      totalBenchmark = totalBenchmark.plus(benchmarkTotal);
      if (line.negotiatedPricePerUnit !== null) {
        negotiatedLineCount += 1;
        totalNegotiated = totalNegotiated.plus(
          this.roundMoney(
            line.negotiatedPricePerUnit.times(line.requiredQuantity),
          ),
        );
      } else {
        totalNegotiated = totalNegotiated.plus(benchmarkTotal);
      }
    }

    totalBenchmark = this.roundMoney(totalBenchmark);
    totalNegotiated = this.roundMoney(totalNegotiated);
    const varianceAmount = this.roundMoney(
      totalNegotiated.minus(totalBenchmark),
    );
    const variancePercent = totalBenchmark.greaterThan(0)
      ? this.roundPercent(
          varianceAmount.dividedBy(totalBenchmark).times(100),
        )
      : null;

    return new ResourcePlanSummaryEntity({
      totalBenchmarkCost: totalBenchmark.toString(),
      totalNegotiatedCost: totalNegotiated.toString(),
      varianceAmount: varianceAmount.toString(),
      variancePercent: variancePercent !== null ? variancePercent.toString() : null,
      lineCount: lines.length,
      negotiatedLineCount,
    });
  }

  // ── Shared BOM index helpers (mirror StockReportService) ──────────────
  private async loadReleasedBomIndex(): Promise<
    Map<string, ExplodableBom & { bomId: string }>
  > {
    const released = await this.prisma.bom.findMany({
      where: { status: BomStatus.RELEASED },
      orderBy: { revisionNumber: 'desc' },
      select: {
        id: true,
        itemId: true,
        revisionNumber: true,
        lines: {
          select: {
            itemId: true,
            quantityPerUnit: true,
            wastagePercent: true,
            unitOfMeasure: true,
          },
        },
      },
    });
    const byItem = new Map<string, ExplodableBom & { bomId: string }>();
    for (const b of released) {
      if (byItem.has(b.itemId)) continue; // keep highest revision (first seen)
      byItem.set(b.itemId, {
        bomId: b.id,
        itemId: b.itemId,
        revisionNumber: b.revisionNumber,
        lines: b.lines,
      });
    }
    return byItem;
  }

  private async loadItemMeta(
    itemIds: string[],
  ): Promise<Map<string, { itemCode: string; name: string }>> {
    if (itemIds.length === 0) return new Map();
    const items = await this.prisma.item.findMany({
      where: { id: { in: itemIds } },
      select: { id: true, itemCode: true, name: true },
    });
    return new Map(
      items.map((i) => [i.id, { itemCode: i.itemCode, name: i.name }]),
    );
  }
}
