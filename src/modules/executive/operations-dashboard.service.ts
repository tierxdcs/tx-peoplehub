import { Injectable } from '@nestjs/common';
import {
  DesignProjectStatus,
  GoodsReceiptNoteStatus,
  Prisma,
  PurchaseOrderStatus,
  QmsInspectionStatus,
  QmsNcrStatus,
  RfqStatus,
} from '@prisma/client';
import { PrismaService } from '../../core/database/prisma.service';
import { AuthenticatedUser } from '../../common/decorators/current-user.decorator';
import { IN_HOUSE_FACILITY_LABEL } from '../../common/constants/in-house-facility';
import { PlmService } from '../plm/plm.service';
import { stepsToPercent } from '../plm/plm-production-steps';
import { ProjectKickoffService } from '../project-kickoff/project-kickoff.service';
import { OtdService } from '../logistics/otd.service';
import { onTimePercentage } from '../logistics/otd.math';
import {
  ACTIVE_DESIGN_PROJECT_WHERE,
  DESIGN_STAGE_LADDER,
} from '../design/design.service';
import type { DataMaturity } from './sales-dashboard.service';
import {
  daysBetween,
  fiscalYearFor,
  money,
  percent,
  sumDecimals,
} from './sales-dashboard.math';
import {
  averageNumber,
  completionPercent,
  dispatchFacilitySegment,
  premiumOverLowest,
  type DispatchFacilitySegment,
} from './operations-dashboard.math';

/** A PLM row exactly as the PLM workspace builds it — see PlmService. */
type OperationsLine = Awaited<
  ReturnType<PlmService['dashboardCompanyWide']>
>[number];

/** PO statuses where goods are still owed to us. */
const OPEN_PO_STATUSES = [
  PurchaseOrderStatus.ISSUED,
  PurchaseOrderStatus.PARTIALLY_RECEIVED,
] as const;

/** Inspections raised but not yet concluded — the QC queue length. */
const OPEN_INSPECTION_STATUSES = [
  QmsInspectionStatus.DRAFT,
  QmsInspectionStatus.IN_PROGRESS,
  QmsInspectionStatus.PENDING_REVIEW,
] as const;

/** An NCR that is still being worked. */
const OPEN_NCR_STATUSES = [
  QmsNcrStatus.OPEN,
  QmsNcrStatus.CONTAINED,
  QmsNcrStatus.INVESTIGATION,
  QmsNcrStatus.PENDING_DISPOSITION,
  QmsNcrStatus.CAPA_IN_PROGRESS,
  QmsNcrStatus.VERIFICATION,
] as const;

/** How many overdue POs / most-overdue lines to name rather than just count. */
const NAMED_ROW_LIMIT = 5;

const ZERO = new Prisma.Decimal(0);

/** "DETAILED_DESIGN" → "Detailed Design". */
function titleCase(value: string): string {
  return value
    .toLowerCase()
    .split('_')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

/**
 * The Operations executive dashboard — company-wide delivery visibility for the
 * COO. Deliberately non-financial: no revenue, no margin, no cash flow and no
 * AR appears here, because none of it answers "what is stuck and who is stuck
 * on it". (COPQ and the RFQ award premium are the two monetary figures present,
 * and both are labelled as what they are: a quality-failure cost and a
 * procurement-effectiveness signal, not revenue.)
 *
 * Every section reuses a calculation that already exists rather than restating
 * it: the PLM workspace's own blocker/health/delivery-countdown builder
 * (`PlmService.dashboardCompanyWide`), the personal dashboard's project health
 * (`ProjectKickoffService.progressCompanyWide`), the Logistics OTD report
 * (`OtdService.report`, whose per-challan verdicts are re-segmented here, not
 * recomputed), the Design module's stage ladder, and the PLM vendor-update
 * cadence. Widening the scope is the only thing this service does to them.
 *
 * Access is checked by ExecutiveAccessService at the controller, NOT here.
 */
@Injectable()
export class OperationsDashboardService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly plm: PlmService,
    private readonly kickoffs: ProjectKickoffService,
    private readonly otd: OtdService,
  ) {}

  async build(user: AuthenticatedUser, now = new Date()) {
    const period = fiscalYearFor(now);

    const [
      allProjects,
      lines,
      otdReport,
      designProjects,
      awardedRfqs,
      overduePos,
      grnPendingQc,
      openInspections,
      ncrs,
      openNcrCount,
    ] = await Promise.all([
      this.kickoffs.progressCompanyWide(),
      this.plm.dashboardCompanyWide(user),
      // The existing Logistics OTD analytics, all-time, unmodified.
      this.otd.report(user),
      this.prisma.designProject.findMany({
        where: ACTIVE_DESIGN_PROJECT_WHERE,
        select: {
          id: true,
          projectNumber: true,
          name: true,
          status: true,
          targetDate: true,
        },
        orderBy: { targetDate: 'asc' },
      }),
      this.prisma.rfq.findMany({
        where: {
          status: RfqStatus.AWARDED,
          awardDecisionAt: {
            not: null,
            gte: period.startsOn,
            lt: period.endsBefore,
          },
        },
        select: {
          id: true,
          rfqNumber: true,
          createdAt: true,
          awardDecisionAt: true,
          awardedInviteeId: true,
          invitees: {
            where: { quoteStatus: 'SUBMITTED' },
            select: {
              id: true,
              quotes: {
                where: { submittedAt: { not: null } },
                orderBy: { revisionNumber: 'desc' },
                take: 1,
                select: { totalQuotedValue: true },
              },
            },
          },
        },
      }),
      this.prisma.purchaseOrder.findMany({
        where: {
          status: { in: [...OPEN_PO_STATUSES] },
          expectedDeliveryDate: { lt: now },
        },
        select: {
          id: true,
          poNumber: true,
          status: true,
          expectedDeliveryDate: true,
          vendor: { select: { companyName: true } },
          supplier: { select: { companyName: true } },
          adHocPartyName: true,
        },
        orderBy: { expectedDeliveryDate: 'asc' },
      }),
      this.prisma.goodsReceiptNote.count({
        where: { status: GoodsReceiptNoteStatus.PENDING_QC },
      }),
      this.prisma.qmsInspection.count({
        where: { status: { in: [...OPEN_INSPECTION_STATUSES] } },
      }),
      this.prisma.qmsNonConformance.findMany({
        where: {
          createdAt: { gte: period.startsOn, lt: period.endsBefore },
          costOfPoorQuality: { not: null },
        },
        select: { costOfPoorQuality: true, costOfPoorQualitySource: true },
      }),
      this.prisma.qmsNonConformance.count({
        where: { status: { in: [...OPEN_NCR_STATUSES] } },
      }),
    ]);

    // A project is still ours to manage until it is fully dispatched; a cancelled
    // order shows as ATTENTION on its first lamp. Both come straight off the
    // shared progress view — no second definition of "done".
    const activeProjects = allProjects.filter(
      (project) =>
        project.stages.find((stage) => stage.key === 'dispatch')?.state !==
          'COMPLETE' &&
        project.stages.find((stage) => stage.key === 'order')?.state !==
          'ATTENTION',
    );

    const [facilities, vendorSelfReports] = await Promise.all([
      this.facilities(lines, otdReport),
      this.vendorSelfReports(lines),
    ]);

    return {
      asOf: now,
      period: {
        label: period.label,
        startsOn: period.startsOn,
        endsBefore: period.endsBefore,
      },
      /** Rendered verbatim on the page, so the scope is never assumed. */
      basis: [
        'Company-wide: every active project and every active order line, regardless of who owns it.',
        'Blockers, health, and the delivery countdown are the PLM workspace’s own calculations, read at company scope — not a second set of rules.',
        'On-time delivery is the Logistics OTD report unchanged; the in-house figure re-segments its per-challan verdicts and excludes challans that mixed in-house with vendor work.',
        'Deliberately excludes revenue, margin, cash flow and receivables. Cost of Poor Quality and the RFQ award premium appear as operational signals — a quality-failure cost and a procurement-effectiveness measure.',
        `Cycle-time and quality-cost figures cover ${period.label} to date; queue and blocker counts are as of now.`,
      ],
      portfolio: this.portfolio(activeProjects, allProjects.length),
      lines,
      onTimeDelivery: this.onTimeDelivery(otdReport),
      design: this.design(designProjects, now),
      vendorUpdateHealth: this.vendorUpdateHealth(lines),
      procurement: this.procurement(
        awardedRfqs,
        overduePos,
        grnPendingQc,
        openInspections,
        period.label,
      ),
      quality: this.quality(ncrs, openNcrCount, period.label),
      facilities: {
        inHouse: facilities.inHouse,
        externalVendors: facilities.externalVendors.map((vendor) => ({
          ...vendor,
          latestSelfReport: vendorSelfReports.get(vendor.key) ?? null,
        })),
        mixedDispatchesExcluded: facilities.mixedDispatchesExcluded,
      },
    };
  }

  // ── §1 Company-wide portfolio health ─────────────────────────────────────

  /**
   * The On Track / At Risk / Blocked split, straight off the shared project
   * progress view. Same three buckets and same `healthReason` strings as the
   * personal dashboard — only every project is counted, not just mine.
   */
  private portfolio(
    active: Awaited<ReturnType<ProjectKickoffService['progressCompanyWide']>>,
    totalEverStarted: number,
  ) {
    return {
      activeTotal: active.length,
      totalEverStarted,
      onTrack: active.filter((p) => p.health === 'ON_TRACK').length,
      atRisk: active.filter((p) => p.health === 'AT_RISK').length,
      blocked: active.filter((p) => p.health === 'BLOCKED').length,
      projects: active,
    };
  }

  // ── §5 On-time delivery: surfaced, not recalculated ──────────────────────

  private onTimeDelivery(report: Awaited<ReturnType<OtdService['report']>>) {
    const { summary } = report;
    return {
      percent: summary.onTimePercentage,
      totalDelivered: summary.totalDelivered,
      onTime: summary.onTime,
      late: summary.late,
      averageDelayDays: summary.averageDelayDays,
      status: (summary.totalDelivered === 0
        ? 'NO_DATA'
        : 'AVAILABLE') as DataMaturity,
      note:
        summary.totalDelivered === 0
          ? 'No delivery challan has both a promised and an actual delivery date yet'
          : null,
    };
  }

  // ── §6 Design engineering stage bottlenecks ──────────────────────────────

  /**
   * Where design work is sitting, in the Design module's own ladder order, with
   * anything past its target date flagged. ON_HOLD / CLOSED are off-ladder in
   * that module, so a status outside the ladder is reported separately instead
   * of being dropped or forced into a stage it doesn't belong to.
   */
  private design(
    projects: Array<{
      id: string;
      projectNumber: string;
      name: string;
      status: DesignProjectStatus;
      targetDate: Date;
    }>,
    now: Date,
  ) {
    const overdue = (status: DesignProjectStatus) =>
      projects.filter(
        (project) =>
          project.status === status && project.targetDate.getTime() < now.getTime(),
      );
    const stageOf = (status: DesignProjectStatus) => ({
      status,
      label: titleCase(status),
      count: projects.filter((project) => project.status === status).length,
      overdueCount: overdue(status).length,
    });
    const offLadder = [...new Set(projects.map((p) => p.status))].filter(
      (status) => !DESIGN_STAGE_LADDER.includes(status),
    );
    return {
      activeTotal: projects.length,
      overdueTotal: projects.filter(
        (project) => project.targetDate.getTime() < now.getTime(),
      ).length,
      stages: DESIGN_STAGE_LADDER.map(stageOf),
      offLadder: offLadder.map(stageOf),
      /** The overdue projects themselves, soonest target date first. */
      overdueProjects: projects
        .filter((project) => project.targetDate.getTime() < now.getTime())
        .slice(0, NAMED_ROW_LIMIT)
        .map((project) => ({
          id: project.id,
          projectNumber: project.projectNumber,
          name: project.name,
          stageLabel: titleCase(project.status),
          targetDate: project.targetDate,
          daysOverdue: daysBetween(project.targetDate, now),
        })),
    };
  }

  // ── §7 Vendor update health ──────────────────────────────────────────────

  /**
   * How many vendor-flow lines have missed their update cadence. The RED/AMBER
   * verdict is the PLM tracker's own `deriveVendorCadence` result, carried on
   * each row — this only counts them.
   */
  private vendorUpdateHealth(lines: OperationsLine[]) {
    const measured = lines.filter((line) => line.vendorCadenceStatus !== null);
    const overdueLines = measured.filter(
      (line) => line.vendorCadenceStatus === 'RED',
    );
    return {
      measuredLines: measured.length,
      overdue: overdueLines.length,
      dueSoon: measured.filter((line) => line.vendorCadenceStatus === 'AMBER')
        .length,
      onSchedule: measured.filter((line) => line.vendorCadenceStatus === 'GREEN')
        .length,
      note: measured.length
        ? null
        : 'No vendor-flow line is in production, so no update cadence is running',
      overdueLines: overdueLines.slice(0, NAMED_ROW_LIMIT),
    };
  }

  // ── §8 Procurement cycle health ──────────────────────────────────────────

  private procurement(
    awardedRfqs: Array<{
      rfqNumber: string;
      createdAt: Date;
      awardDecisionAt: Date | null;
      awardedInviteeId: string | null;
      invitees: Array<{
        id: string;
        quotes: Array<{ totalQuotedValue: Prisma.Decimal }>;
      }>;
    }>,
    overduePos: Array<{
      id: string;
      poNumber: string;
      status: PurchaseOrderStatus;
      expectedDeliveryDate: Date | null;
      vendor: { companyName: string } | null;
      supplier: { companyName: string } | null;
      adHocPartyName: string | null;
    }>,
    grnPendingQc: number,
    openInspections: number,
    periodLabel: string,
  ) {
    const cycleDays = awardedRfqs
      .filter((rfq) => rfq.awardDecisionAt)
      .map((rfq) => daysBetween(rfq.createdAt, rfq.awardDecisionAt!));

    // What the awarded quotes cost above the lowest quote received, aggregated.
    // Only RFQs where the award is identifiable and at least one quote was
    // submitted can be measured; the rest are reported as uncovered.
    let premiumTotal = ZERO;
    let lowestTotal = ZERO;
    let premiumMeasured = 0;
    for (const rfq of awardedRfqs) {
      const totals = rfq.invitees
        .map((invitee) => invitee.quotes[0]?.totalQuotedValue)
        .filter((total): total is Prisma.Decimal => !!total);
      const awarded = rfq.invitees.find(
        (invitee) => invitee.id === rfq.awardedInviteeId,
      )?.quotes[0]?.totalQuotedValue;
      if (!awarded || totals.length === 0) continue;
      const lowest = totals.reduce((min, t) => (t.lessThan(min) ? t : min));
      premiumTotal = premiumTotal.plus(
        premiumOverLowest(awarded, lowest).amount,
      );
      lowestTotal = lowestTotal.plus(lowest);
      premiumMeasured += 1;
    }

    return {
      rfqCycle: {
        averageDays: averageNumber(cycleDays),
        rfqsMeasured: cycleDays.length,
        status: (cycleDays.length
          ? 'AVAILABLE'
          : 'NO_DATA') as DataMaturity,
        note: cycleDays.length
          ? `RFQ creation to award decision, for awards made in ${periodLabel}`
          : `No RFQ has been awarded in ${periodLabel} yet`,
      },
      /**
       * Not a financial figure: how much the awarded quotes cost over the lowest
       * quotes received — a measure of how often sourcing pays for something
       * other than price (lead time, capability, an approved-vendor constraint).
       */
      awardPremium: {
        amount: money(premiumTotal),
        percent: lowestTotal.greaterThan(0)
          ? percent(premiumTotal.dividedBy(lowestTotal).times(100))
          : null,
        rfqsMeasured: premiumMeasured,
        rfqsUnmeasured: awardedRfqs.length - premiumMeasured,
        status: (premiumMeasured ? 'AVAILABLE' : 'NO_DATA') as DataMaturity,
      },
      overduePurchaseOrders: {
        count: overduePos.length,
        orders: overduePos.slice(0, NAMED_ROW_LIMIT).map((po) => ({
          id: po.id,
          poNumber: po.poNumber,
          status: po.status,
          expectedDeliveryDate: po.expectedDeliveryDate,
          partyName:
            po.vendor?.companyName ??
            po.supplier?.companyName ??
            po.adHocPartyName ??
            'Unnamed party',
        })),
      },
      /** Received but not yet inspected — material sitting at the gate. */
      grnPendingQc,
      /** Inspections raised and not concluded, across every inspection type. */
      inspectionBacklog: openInspections,
    };
  }

  // ── §9 Cost of Poor Quality (a quality signal, not a financial one) ──────

  private quality(
    ncrs: Array<{
      costOfPoorQuality: Prisma.Decimal | null;
      costOfPoorQualitySource: string | null;
    }>,
    openNcrCount: number,
    periodLabel: string,
  ) {
    const costed = ncrs.filter(
      (ncr): ncr is { costOfPoorQuality: Prisma.Decimal; costOfPoorQualitySource: string | null } =>
        ncr.costOfPoorQuality !== null,
    );
    return {
      /** Sum of the COPQ the QMS module already computed and stored per NCR. */
      copqTotal: costed.length
        ? money(sumDecimals(costed.map((ncr) => ncr.costOfPoorQuality)))
        : null,
      ncrsCosted: costed.length,
      manuallyCosted: costed.filter(
        (ncr) => ncr.costOfPoorQualitySource === 'MANUAL',
      ).length,
      openNcrCount,
      status: (costed.length ? 'AVAILABLE' : 'NO_DATA') as DataMaturity,
      note: costed.length
        ? `Scrap and rework cost recorded against non-conformances raised in ${periodLabel}`
        : `No non-conformance raised in ${periodLabel} carries a cost yet`,
    };
  }

  // ── §11/§12 Facility attribution and depth ───────────────────────────────

  /**
   * In-house work gets internal-grade depth — Kanban card completion, WIP load,
   * and its own on-time rate segmented out of the company figure — because we
   * own the board it runs on. Genuine external vendors keep the shallower
   * self-reported view they already have (routing-step progress plus cadence
   * health), named individually so the two are never read as equivalent.
   */
  private async facilities(
    lines: OperationsLine[],
    otdReport: Awaited<ReturnType<OtdService['report']>>,
  ) {
    const inHouseLines = lines.filter(
      (line) => line.facilityKind === 'IN_HOUSE',
    );
    const segments = await this.dispatchSegments(otdReport);
    const inHouseDispatches = otdReport.dispatches.filter(
      (dispatch) => segments.get(dispatch.id) === 'IN_HOUSE',
    );
    const inHouseOnTime = inHouseDispatches.filter(
      (dispatch) => dispatch.onTime,
    ).length;

    const done = inHouseLines.reduce(
      (sum, line) => sum + line.production.done,
      0,
    );
    const total = inHouseLines.reduce(
      (sum, line) => sum + line.production.total,
      0,
    );

    const byVendor = new Map<
      string,
      {
        key: string;
        vendorName: string;
        vendorId: string | null;
        activeLines: number;
        blockedLines: number;
        overdue: number;
        dueSoon: number;
        onSchedule: number;
        trackerIds: string[];
      }
    >();
    for (const line of lines) {
      if (line.facilityKind !== 'EXTERNAL_VENDOR') continue;
      const key = line.facilityVendorId ?? line.facilityLabel;
      const entry = byVendor.get(key) ?? {
        key,
        vendorName: line.facilityLabel,
        vendorId: line.facilityVendorId,
        activeLines: 0,
        blockedLines: 0,
        overdue: 0,
        dueSoon: 0,
        onSchedule: 0,
        trackerIds: [],
      };
      entry.activeLines += 1;
      if (line.health === 'BLOCKED') entry.blockedLines += 1;
      if (line.vendorCadenceStatus === 'RED') entry.overdue += 1;
      if (line.vendorCadenceStatus === 'AMBER') entry.dueSoon += 1;
      if (line.vendorCadenceStatus === 'GREEN') entry.onSchedule += 1;
      entry.trackerIds.push(line.trackerId);
      byVendor.set(key, entry);
    }

    return {
      inHouse: {
        label: IN_HOUSE_FACILITY_LABEL,
        /** Current WIP load: active lines this facility is carrying. */
        activeLines: inHouseLines.length,
        blockedLines: inHouseLines.filter((line) => line.health === 'BLOCKED')
          .length,
        linesInProduction: inHouseLines.filter(
          (line) => line.currentStage === 'PRODUCTION',
        ).length,
        /** Kanban card completion across every in-house line's board. */
        production: {
          done,
          total,
          percent: completionPercent(done, total),
          note:
            total === 0
              ? 'No production card is linked to an in-house line yet'
              : null,
        },
        onTimeDelivery: {
          percent: onTimePercentage(inHouseOnTime, inHouseDispatches.length),
          totalDelivered: inHouseDispatches.length,
          onTime: inHouseOnTime,
          late: inHouseDispatches.length - inHouseOnTime,
          status: (inHouseDispatches.length
            ? 'AVAILABLE'
            : 'NO_DATA') as DataMaturity,
          note: inHouseDispatches.length
            ? 'Challans whose every dispatched line was made in-house'
            : 'No delivered challan carries in-house work exclusively yet',
        },
      },
      externalVendors: [...byVendor.values()].sort(
        (left, right) =>
          right.overdue - left.overdue ||
          right.blockedLines - left.blockedLines ||
          right.activeLines - left.activeLines ||
          left.vendorName.localeCompare(right.vendorName),
      ),
      /** Named so a gap between the company and per-facility figures is explained. */
      mixedDispatchesExcluded: [...segments.values()].filter(
        (segment) => segment === 'MIXED',
      ).length,
    };
  }

  /**
   * Which facility each already-measured delivery challan belongs to. The OTD
   * verdicts are taken as given; only the attribution is computed here, from the
   * delivery classification of the order lines that were actually dispatched.
   */
  private async dispatchSegments(
    otdReport: Awaited<ReturnType<OtdService['report']>>,
  ) {
    const ids = otdReport.dispatches.map((dispatch) => dispatch.id);
    const segments = new Map<string, DispatchFacilitySegment>();
    if (ids.length === 0) return segments;
    const dcLines = await this.prisma.deliveryChallanLine.findMany({
      where: { deliveryChallanId: { in: ids } },
      select: {
        deliveryChallanId: true,
        orderLine: {
          select: { deliverySplits: { select: { deliveryType: true } } },
        },
      },
    });
    const typesByDc = new Map<string, Array<string | null>>();
    for (const line of dcLines) {
      const types = typesByDc.get(line.deliveryChallanId) ?? [];
      types.push(
        ...line.orderLine.deliverySplits.map((split) => split.deliveryType),
      );
      typesByDc.set(line.deliveryChallanId, types);
    }
    for (const id of ids) {
      segments.set(id, dispatchFacilitySegment(typesByDc.get(id) ?? []));
    }
    return segments;
  }

  /**
   * The most recent self-reported update per external vendor — the same
   * routing-step progress the vendor portal collects, unchanged. Deliberately
   * shallow: it is what the vendor told us, not something we measured.
   */
  private async vendorSelfReports(lines: OperationsLine[]) {
    const trackerToKey = new Map<string, string>();
    for (const line of lines) {
      if (line.facilityKind !== 'EXTERNAL_VENDOR') continue;
      trackerToKey.set(
        line.trackerId,
        line.facilityVendorId ?? line.facilityLabel,
      );
    }
    const byVendor = new Map<
      string,
      {
        reportedAt: Date;
        reporterDisplayName: string;
        stepPercent: number | null;
        completedSteps: number | null;
        fabricationPercent: number | null;
        surfaceFinishPercent: number | null;
        assemblyPercent: number | null;
      }
    >();
    if (trackerToKey.size === 0) return byVendor;
    const updates = await this.prisma.plmProductionUpdate.findMany({
      where: { trackerId: { in: [...trackerToKey.keys()] } },
      orderBy: { createdAt: 'desc' },
      select: {
        trackerId: true,
        createdAt: true,
        reporterDisplayName: true,
        completedSteps: true,
        fabricationPercent: true,
        surfaceFinishPercent: true,
        assemblyPercent: true,
      },
    });
    for (const update of updates) {
      const key = trackerToKey.get(update.trackerId);
      // Newest first, so the first update seen for a vendor is its latest.
      if (!key || byVendor.has(key)) continue;
      byVendor.set(key, {
        reportedAt: update.createdAt,
        reporterDisplayName: update.reporterDisplayName,
        stepPercent:
          update.completedSteps === null
            ? null
            : stepsToPercent(update.completedSteps),
        completedSteps: update.completedSteps,
        fabricationPercent: update.fabricationPercent,
        surfaceFinishPercent: update.surfaceFinishPercent,
        assemblyPercent: update.assemblyPercent,
      });
    }
    return byVendor;
  }
}
