import { ForbiddenException, Injectable } from '@nestjs/common';
import {
  CustomerBomIntakeStatus,
  GoodsReceiptNoteStatus,
  NcrDispositionType,
  NonConformanceReportStatus,
  Prisma,
  PurchaseOrderStatus,
  RfqQuoteStatus,
  RfqStatus,
  SupplierStatus,
  VendorStatus,
} from '@prisma/client';
import { PrismaService } from '../../core/database/prisma.service';
import { AuthenticatedUser } from '../../common/decorators/current-user.decorator';
import { PlmService } from '../plm/plm.service';
import { stepsToPercent } from '../plm/plm-production-steps';
import { ScmResourcePlanService } from '../scm-resource-plan/scm-resource-plan.service';
import { rfqNumberFromPoNote } from '../rfq/rfq-po-provenance';
import type { DataMaturity } from './sales-dashboard.service';
import {
  daysBetween,
  fiscalYearFor,
  money,
  monthKeyOf,
  monthsToDate,
  percent,
  shares,
  sumDecimals,
} from './sales-dashboard.math';
import { averageNumber, premiumOverLowest } from './operations-dashboard.math';
import {
  awardWasLowest,
  monthlyAverage,
  monthlyCount,
  ratePercent,
  trendDirection,
} from './scm-dashboard.math';

/** A PLM row exactly as the PLM workspace builds it — see PlmService. */
type ScmLine = Awaited<ReturnType<PlmService['dashboardCompanyWide']>>[number];

/** RFQs still moving: raised but no award decision taken. */
const ACTIVE_RFQ_STATUSES = [
  RfqStatus.DRAFT,
  RfqStatus.ISSUED,
  RfqStatus.CLOSED,
] as const;

/** PO statuses where goods are still owed to us — the same set Operations uses. */
const OPEN_PO_STATUSES = [
  PurchaseOrderStatus.ISSUED,
  PurchaseOrderStatus.PARTIALLY_RECEIVED,
] as const;

/** The four terminal classifications, in descending order of trust. */
const CLASSIFICATION_LADDER = [
  'APPROVED_PREFERRED',
  'APPROVED',
  'CONDITIONALLY_APPROVED',
  'NOT_APPROVED',
] as const;

/**
 * Where a partner sits before it has a classification. Vendor and Supplier share
 * these two states and both modules mean the same thing by them: the
 * questionnaire is in and an audit is owed. There is deliberately no draft audit
 * state in either module (create == finalize), so this IS the audit queue.
 */
const AUDIT_QUEUE_STATUSES = [
  'QUESTIONNAIRE_SUBMITTED',
  'UNDER_AUDIT',
] as const;

/** How many rows to name rather than only count. */
const NAMED_ROW_LIMIT = 8;

/** Top-N partners in a concentration ranking. */
const CONCENTRATION_LIMIT = 5;

const ZERO = new Prisma.Decimal(0);

/** "RETURN_TO_SUPPLIER" → "Return To Supplier". */
function titleCase(value: string): string {
  return value
    .toLowerCase()
    .split('_')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

/**
 * The executive SCM dashboard — company-wide procurement and supply-base
 * visibility for the SCM Head.
 *
 * Two rules shape it:
 *
 *  - **Supply side only.** No revenue, no margin, and no customer identity
 *    appears anywhere. Several sources this service reads (PLM rows, resource
 *    plans, BOM intakes) carry a customer name; every one of them is dropped on
 *    the way out rather than merely left unrendered, so the wire payload itself
 *    is clean.
 *  - **Reuse, never restate.** The PLM workspace's own rows
 *    (`PlmService.dashboardCompanyWide`), the resource plan's own cross-project
 *    variance (`ScmResourcePlanService.crossProjectSummary`, including its own
 *    cost-view gate), the RFQ comparison's lowest-total rule, the award gate's
 *    exact-Decimal equality, the PO line-total sum and the award→PO provenance
 *    marker are all read as they are. This service widens scope and aggregates;
 *    it does not re-implement.
 *
 * Access is checked by ExecutiveAccessService at the controller, NOT here.
 */
@Injectable()
export class ScmDashboardService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly plm: PlmService,
    private readonly resourcePlans: ScmResourcePlanService,
  ) {}

  async build(user: AuthenticatedUser, now = new Date()) {
    const period = fiscalYearFor(now);
    const months = monthsToDate(period, now);
    const monthKeys = months.map((month) => month.key);

    const [
      activeRfqs,
      awardedRfqs,
      submittedInvitees,
      openPos,
      adHocPending,
      adHocApprovedThisPeriod,
      vendors,
      suppliers,
      poValueRows,
      lines,
      untouchedIntakes,
      ncrs,
      grnPendingQc,
      leadTimeQuotes,
      costVariance,
    ] = await Promise.all([
      this.loadActiveRfqs(),
      this.loadAwardedRfqs(period.startsOn, period.endsBefore),
      this.loadSubmittedInvitees(),
      this.loadOpenPos(),
      this.loadAdHocPending(),
      this.prisma.purchaseOrder.count({
        where: {
          supplierId: null,
          vendorId: null,
          ceoApprovedAt: { gte: period.startsOn, lt: period.endsBefore },
        },
      }),
      this.prisma.vendor.findMany({
        select: {
          id: true,
          companyName: true,
          status: true,
          statusOverridden: true,
          createdAt: true,
        },
      }),
      this.prisma.supplier.findMany({
        select: {
          id: true,
          companyName: true,
          status: true,
          statusOverridden: true,
          createdAt: true,
        },
      }),
      this.loadPoValueRows(),
      this.plm.dashboardCompanyWide(user),
      this.loadUntouchedIntakes(),
      this.loadNcrs(period.startsOn, period.endsBefore),
      this.loadGrnBacklog(),
      this.loadLeadTimeQuotes(period.startsOn, period.endsBefore),
      this.loadCostVariance(user),
    ]);

    const vendorLines = lines.filter(
      (line) => line.facilityKind === 'EXTERNAL_VENDOR',
    );
    const selfReports = await this.selfReportsByTracker(vendorLines);

    return {
      asOf: now,
      period: {
        label: period.label,
        startsOn: period.startsOn,
        endsBefore: period.endsBefore,
      },
      /** Rendered verbatim on the page, so nothing about the scope is assumed. */
      basis: [
        'Company-wide procurement and supply base: every RFQ, purchase order, registered vendor and registered supplier, regardless of who raised it.',
        'Deliberately supply-side only — no revenue, no margin, and no customer name appears anywhere on this dashboard, including in the underlying payload.',
        'Vendor-executed project progress is the PLM workspace’s own rows and the vendors’ own self-reports, read at company scope — not a second set of rules.',
        'Award-vs-lowest uses the same exact-total comparison as the RFQ comparison grid and the award justification gate, so this can never disagree with whether a justification was required.',
        `Cycle times, onboarding counts and trends cover ${period.label} to date; queue, backlog and classification counts are as of now.`,
      ],
      rfqHealth: this.rfqHealth(
        activeRfqs,
        awardedRfqs,
        submittedInvitees,
        now,
        period.label,
      ),
      purchaseOrders: this.purchaseOrderHealth(
        openPos,
        adHocPending,
        adHocApprovedThisPeriod,
        awardedRfqs,
        now,
        period.label,
      ),
      supplyBase: this.supplyBase(
        vendors,
        suppliers,
        poValueRows,
        period.startsOn,
        period.endsBefore,
        period.label,
      ),
      vendorProjects: this.vendorProjects(vendorLines, selfReports),
      sourcingBacklog: this.sourcingBacklog(activeRfqs, untouchedIntakes, now),
      costPerformance: costVariance,
      qualityOfSupply: this.qualityOfSupply(
        ncrs,
        grnPendingQc,
        monthKeys,
        months,
        now,
        period.label,
      ),
      leadTime: this.leadTime(leadTimeQuotes, months, period.label),
    };
  }

  // ── Loaders ──────────────────────────────────────────────────────────────

  private loadActiveRfqs() {
    return this.prisma.rfq.findMany({
      where: { status: { in: [...ACTIVE_RFQ_STATUSES] } },
      select: {
        id: true,
        rfqNumber: true,
        title: true,
        status: true,
        createdAt: true,
        updatedAt: true,
        submissionDeadline: true,
        pmApprovedAt: true,
        pmRejectionComment: true,
        projectKickoffId: true,
        customerBomIntakeId: true,
        _count: { select: { lines: true, invitees: true } },
      },
      orderBy: { createdAt: 'asc' },
    });
  }

  /**
   * Awarded RFQs in the period, with every submitted invitee's latest submitted
   * revision. The `quoteStatus === SUBMITTED` + newest-submitted-revision
   * selection is exactly what RfqService.comparison and RfqService.award use.
   */
  private loadAwardedRfqs(startsOn: Date, endsBefore: Date) {
    return this.prisma.rfq.findMany({
      where: {
        status: RfqStatus.AWARDED,
        awardDecisionAt: { not: null, gte: startsOn, lt: endsBefore },
      },
      select: {
        id: true,
        rfqNumber: true,
        title: true,
        createdAt: true,
        awardDecisionAt: true,
        awardedInviteeId: true,
        awardJustification: true,
        invitees: {
          where: { quoteStatus: RfqQuoteStatus.SUBMITTED },
          select: {
            id: true,
            vendor: { select: { companyName: true } },
            supplier: { select: { companyName: true } },
            quotes: {
              where: { submittedAt: { not: null } },
              orderBy: { revisionNumber: 'desc' },
              take: 1,
              select: { totalQuotedValue: true, revisionNumber: true },
            },
          },
        },
      },
      orderBy: { awardDecisionAt: 'desc' },
    });
  }

  /**
   * Every invitee ever created, for participation and response time. Revoked
   * invitees are loaded so they can be excluded: a link that was pulled was
   * never a fair chance to respond, and counting it would understate the base.
   */
  private loadSubmittedInvitees() {
    return this.prisma.rfqInvitee.findMany({
      where: { rfq: { status: { not: RfqStatus.DRAFT } } },
      select: {
        id: true,
        quoteStatus: true,
        submittedAt: true,
        revokedAt: true,
        revisionRequestedAt: true,
        declineReason: true,
        vendor: { select: { id: true, companyName: true } },
        supplier: { select: { id: true, companyName: true } },
        rfq: { select: { createdAt: true, pmApprovedAt: true } },
        quotes: {
          where: { submittedAt: { not: null } },
          select: { revisionNumber: true, submittedAt: true },
        },
      },
    });
  }

  private loadOpenPos() {
    return this.prisma.purchaseOrder.findMany({
      where: { status: { in: [...OPEN_PO_STATUSES] } },
      select: {
        id: true,
        poNumber: true,
        status: true,
        expectedDeliveryDate: true,
        issuedAt: true,
        notes: true,
        vendor: { select: { companyName: true } },
        supplier: { select: { companyName: true } },
        adHocPartyName: true,
        lines: { select: { lineTotal: true } },
      },
      orderBy: { expectedDeliveryDate: 'asc' },
    });
  }

  /**
   * Ad-hoc POs awaiting CEO approval. An ad-hoc PO is one with NEITHER a vendor
   * nor a supplier link — the compliance question is exactly "how often is a
   * purchase being raised outside the vetted base", so the absence of both links
   * is the test, not the status alone.
   */
  private loadAdHocPending() {
    return this.prisma.purchaseOrder.findMany({
      where: {
        status: PurchaseOrderStatus.PENDING_CEO_APPROVAL,
        supplierId: null,
        vendorId: null,
      },
      select: {
        id: true,
        poNumber: true,
        adHocPartyName: true,
        createdAt: true,
        lines: { select: { lineTotal: true } },
      },
      orderBy: { createdAt: 'asc' },
    });
  }

  /** Every non-cancelled PO's value and party, for concentration. */
  private loadPoValueRows() {
    return this.prisma.purchaseOrder.findMany({
      where: {
        status: {
          notIn: [
            PurchaseOrderStatus.CANCELLED,
            PurchaseOrderStatus.REJECTED,
            PurchaseOrderStatus.PENDING_CEO_APPROVAL,
          ],
        },
      },
      select: {
        id: true,
        vendorId: true,
        supplierId: true,
        vendor: { select: { companyName: true } },
        supplier: { select: { companyName: true } },
        adHocPartyName: true,
        lines: { select: { lineTotal: true } },
      },
    });
  }

  /**
   * BOM intakes whose Item/Product/BOM records exist (status CREATED) but which
   * have never had an RFQ raised against them — sourcing work that was set up
   * and then left. The opportunity/customer is deliberately NOT selected.
   */
  private loadUntouchedIntakes() {
    return this.prisma.customerBomIntake.findMany({
      where: {
        status: CustomerBomIntakeStatus.CREATED,
        rfqs: { none: {} },
      },
      select: {
        id: true,
        productName: true,
        updatedAt: true,
        bomId: true,
        businessUnit: { select: { code: true, name: true } },
        _count: { select: { lines: true } },
      },
      orderBy: { updatedAt: 'asc' },
    });
  }

  /**
   * Purchase-side non-conformances. Every NonConformanceReport is raised by QC
   * rejecting a GRN line, and every GRN sits against a PO — so this model is
   * inherently vendor/supplier-caused. Internal production non-conformances are
   * a different model (QmsNonConformance) and are deliberately not read here.
   */
  private loadNcrs(startsOn: Date, endsBefore: Date) {
    return this.prisma.nonConformanceReport.findMany({
      where: { createdAt: { gte: startsOn, lt: endsBefore } },
      select: {
        id: true,
        ncrNumber: true,
        status: true,
        disposition: true,
        rejectedQuantity: true,
        createdAt: true,
        item: { select: { name: true, itemCode: true } },
        grn: {
          select: {
            grnNumber: true,
            purchaseOrder: {
              select: {
                poNumber: true,
                vendorId: true,
                supplierId: true,
                vendor: { select: { companyName: true } },
                supplier: { select: { companyName: true } },
                adHocPartyName: true,
              },
            },
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  /** Received but not yet inspected — material sitting at the QC gate. */
  private loadGrnBacklog() {
    return this.prisma.goodsReceiptNote.findMany({
      where: { status: GoodsReceiptNoteStatus.PENDING_QC },
      select: {
        id: true,
        grnNumber: true,
        receivedDate: true,
        purchaseOrder: {
          select: {
            poNumber: true,
            vendor: { select: { companyName: true } },
            supplier: { select: { companyName: true } },
            adHocPartyName: true,
          },
        },
      },
      orderBy: { receivedDate: 'asc' },
    });
  }

  /** Submitted quotes carrying a lead time, for the trend. */
  private loadLeadTimeQuotes(startsOn: Date, endsBefore: Date) {
    return this.prisma.rfqQuote.findMany({
      where: {
        submittedAt: { not: null, gte: startsOn, lt: endsBefore },
        quotedLeadTimeDays: { not: null },
      },
      select: {
        id: true,
        submittedAt: true,
        quotedLeadTimeDays: true,
        invitee: {
          select: {
            vendor: { select: { id: true, companyName: true } },
            supplier: { select: { id: true, companyName: true } },
          },
        },
      },
    });
  }

  // ── §1 RFQ health ────────────────────────────────────────────────────────

  private rfqHealth(
    activeRfqs: Awaited<ReturnType<ScmDashboardService['loadActiveRfqs']>>,
    awardedRfqs: Awaited<ReturnType<ScmDashboardService['loadAwardedRfqs']>>,
    invitees: Awaited<ReturnType<ScmDashboardService['loadSubmittedInvitees']>>,
    now: Date,
    periodLabel: string,
  ) {
    const draft = activeRfqs.filter((rfq) => rfq.status === RfqStatus.DRAFT);
    const awaitingPm = draft.filter((rfq) => !rfq.pmApprovedAt);

    // ── Response time: invitee link live → quote submitted.
    // The moment an RFQ was issued is not timestamped anywhere (issuing flips
    // the status and rewrites the tokens; it stores no `issuedAt`), so the clock
    // starts at RFQ creation — the earliest defensible start — and the PM
    // approval lag is reported separately so the reader can see how much of the
    // window was our own gate rather than the vendor being slow.
    const responders = invitees.filter(
      (invitee) =>
        !invitee.revokedAt &&
        invitee.quoteStatus === RfqQuoteStatus.SUBMITTED &&
        invitee.submittedAt,
    );
    const responseDays = responders.map((invitee) =>
      daysBetween(invitee.rfq.createdAt, invitee.submittedAt!),
    );
    const pmLagDays = invitees
      .filter((invitee) => invitee.rfq.pmApprovedAt)
      .map((invitee) =>
        daysBetween(invitee.rfq.createdAt, invitee.rfq.pmApprovedAt!),
      );

    // ── Per-partner response time and participation.
    const byPartner = new Map<
      string,
      {
        key: string;
        partnerName: string;
        partnerType: 'VENDOR' | 'SUPPLIER';
        invited: number;
        submitted: number;
        declined: number;
        silent: number;
        responseDays: number[];
        revisions: number;
        revisionRequests: number;
      }
    >();
    for (const invitee of invitees) {
      if (invitee.revokedAt) continue;
      const partner = invitee.vendor ?? invitee.supplier;
      if (!partner) continue;
      const key = partner.id;
      const entry = byPartner.get(key) ?? {
        key,
        partnerName: partner.companyName,
        partnerType: invitee.vendor
          ? ('VENDOR' as const)
          : ('SUPPLIER' as const),
        invited: 0,
        submitted: 0,
        declined: 0,
        silent: 0,
        responseDays: [],
        revisions: 0,
        revisionRequests: 0,
      };
      entry.invited += 1;
      if (invitee.quoteStatus === RfqQuoteStatus.SUBMITTED) {
        entry.submitted += 1;
        if (invitee.submittedAt) {
          entry.responseDays.push(
            daysBetween(invitee.rfq.createdAt, invitee.submittedAt),
          );
        }
      } else if (invitee.quoteStatus === RfqQuoteStatus.DECLINED) {
        entry.declined += 1;
      } else {
        // INVITED or VIEWED, never answered — the reliability problem a
        // qualification score cannot show.
        entry.silent += 1;
      }
      entry.revisions += invitee.quotes.filter(
        (quote) => quote.revisionNumber > 1,
      ).length;
      if (invitee.revisionRequestedAt) entry.revisionRequests += 1;
      byPartner.set(key, entry);
    }

    const participants = [...byPartner.values()].map((entry) => ({
      key: entry.key,
      partnerName: entry.partnerName,
      partnerType: entry.partnerType,
      invited: entry.invited,
      submitted: entry.submitted,
      declined: entry.declined,
      silent: entry.silent,
      participationPercent: percent(
        ratePercent(entry.submitted, entry.invited),
      ),
      averageResponseDays: averageNumber(entry.responseDays),
      revisions: entry.revisions,
      revisionRequests: entry.revisionRequests,
    }));

    const invitedTotal = participants.reduce((sum, p) => sum + p.invited, 0);
    const submittedTotal = participants.reduce(
      (sum, p) => sum + p.submitted,
      0,
    );

    // ── Non-lowest awards, using the award gate's own equality rule.
    const awardCycleDays: number[] = [];
    const nonLowest: Array<{
      rfqId: string;
      rfqNumber: string;
      title: string;
      awardedTo: string;
      awardedAt: Date;
      premiumAmount: string | null;
      premiumPercent: string | null;
      justification: string | null;
      quotesCompared: number;
    }> = [];
    let comparable = 0;
    let lowestWins = 0;
    for (const rfq of awardedRfqs) {
      if (rfq.awardDecisionAt) {
        awardCycleDays.push(daysBetween(rfq.createdAt, rfq.awardDecisionAt));
      }
      const totals = rfq.invitees
        .map((invitee) => invitee.quotes[0]?.totalQuotedValue)
        .filter((total): total is Prisma.Decimal => !!total);
      const awardedInvitee = rfq.invitees.find(
        (invitee) => invitee.id === rfq.awardedInviteeId,
      );
      const awarded = awardedInvitee?.quotes[0]?.totalQuotedValue;
      if (!awarded) continue;
      const wasLowest = awardWasLowest(awarded, totals);
      if (wasLowest === null) continue;
      comparable += 1;
      if (wasLowest) {
        lowestWins += 1;
        continue;
      }
      const lowest = totals.reduce((min, t) => (t.lessThan(min) ? t : min));
      const premium = premiumOverLowest(awarded, lowest);
      nonLowest.push({
        rfqId: rfq.id,
        rfqNumber: rfq.rfqNumber,
        title: rfq.title,
        awardedTo:
          awardedInvitee?.vendor?.companyName ??
          awardedInvitee?.supplier?.companyName ??
          'Unnamed partner',
        awardedAt: rfq.awardDecisionAt!,
        premiumAmount: money(premium.amount),
        premiumPercent: percent(premium.percent),
        justification: rfq.awardJustification,
        quotesCompared: totals.length,
      });
    }

    const revisionTotal = participants.reduce((sum, p) => sum + p.revisions, 0);
    const revisionRequestTotal = participants.reduce(
      (sum, p) => sum + p.revisionRequests,
      0,
    );

    return {
      open: {
        total: activeRfqs.length,
        draft: draft.length,
        awaitingPmApproval: awaitingPm.length,
        pmRejected: draft.filter(
          (rfq) => !rfq.pmApprovedAt && rfq.pmRejectionComment,
        ).length,
        approvedNotIssued: draft.filter((rfq) => rfq.pmApprovedAt).length,
        issued: activeRfqs.filter((rfq) => rfq.status === RfqStatus.ISSUED)
          .length,
        closedAwaitingAward: activeRfqs.filter(
          (rfq) => rfq.status === RfqStatus.CLOSED,
        ).length,
        /** The PM queue itself, oldest first — the bottleneck if it backs up. */
        awaitingPmApprovalRfqs: awaitingPm
          .slice(0, NAMED_ROW_LIMIT)
          .map((rfq) => ({
            id: rfq.id,
            rfqNumber: rfq.rfqNumber,
            title: rfq.title,
            lineCount: rfq._count.lines,
            inviteeCount: rfq._count.invitees,
            createdAt: rfq.createdAt,
            waitingDays: daysBetween(rfq.createdAt, now),
            rejectedOnce: !!rfq.pmRejectionComment,
          })),
      },
      responseTime: {
        averageDays: averageNumber(responseDays),
        quotesMeasured: responseDays.length,
        status: (responseDays.length ? 'AVAILABLE' : 'NO_DATA') as DataMaturity,
        /** Stated on the page: the clock's start is creation, not issue. */
        note: 'Measured from RFQ creation to quote submission. Issuing an RFQ is not separately timestamped, so creation is the earliest defensible start of the clock.',
        pmApprovalLagDays: averageNumber(pmLagDays),
        pmApprovalsMeasured: pmLagDays.length,
      },
      awardCycle: {
        averageDays: averageNumber(awardCycleDays),
        rfqsMeasured: awardCycleDays.length,
        status: (awardCycleDays.length
          ? 'AVAILABLE'
          : 'NO_DATA') as DataMaturity,
        note: awardCycleDays.length
          ? `RFQ creation to award decision, for awards made in ${periodLabel}`
          : `No RFQ has been awarded in ${periodLabel} yet`,
      },
      participation: {
        invited: invitedTotal,
        submitted: submittedTotal,
        percent: percent(ratePercent(submittedTotal, invitedTotal)),
        status: (invitedTotal ? 'AVAILABLE' : 'NO_DATA') as DataMaturity,
        note: invitedTotal
          ? 'Of every invitee on an issued RFQ, how many actually quoted. Revoked links are excluded — a pulled link was never a chance to respond.'
          : 'No RFQ has been issued to an invitee yet',
        /** Worst participation first: who is qualified but never answers. */
        partners: [...participants]
          .sort(
            (left, right) =>
              right.silent - left.silent ||
              left.submitted / Math.max(left.invited, 1) -
                right.submitted / Math.max(right.invited, 1) ||
              left.partnerName.localeCompare(right.partnerName),
          )
          .slice(0, NAMED_ROW_LIMIT),
      },
      nonLowestAwards: {
        count: nonLowest.length,
        comparableAwards: comparable,
        lowestWins,
        percent: percent(ratePercent(nonLowest.length, comparable)),
        status: (comparable ? 'AVAILABLE' : 'NO_DATA') as DataMaturity,
        note: comparable
          ? 'Every award whose quote was not the lowest total received, with the justification recorded at the time — the award gate makes that justification mandatory.'
          : `No award in ${periodLabel} has two comparable quotes behind it`,
        awards: nonLowest.slice(0, NAMED_ROW_LIMIT),
      },
      quoteRevisions: {
        revisions: revisionTotal,
        revisionRequests: revisionRequestTotal,
        note: revisionTotal
          ? 'Negotiated follow-up quotes submitted through a reopened link. Revision 1 is the original sealed bid and is not counted.'
          : 'The post-close negotiation mechanism has not been used yet',
        /** Which partners are being renegotiated with, busiest first. */
        partners: participants
          .filter(
            (partner) => partner.revisions > 0 || partner.revisionRequests > 0,
          )
          .sort(
            (left, right) =>
              right.revisions - left.revisions ||
              right.revisionRequests - left.revisionRequests,
          )
          .slice(0, NAMED_ROW_LIMIT)
          .map((partner) => ({
            key: partner.key,
            partnerName: partner.partnerName,
            partnerType: partner.partnerType,
            revisions: partner.revisions,
            revisionRequests: partner.revisionRequests,
          })),
      },
    };
  }

  // ── §2 Purchase order health ─────────────────────────────────────────────

  private purchaseOrderHealth(
    openPos: Awaited<ReturnType<ScmDashboardService['loadOpenPos']>>,
    adHocPending: Awaited<ReturnType<ScmDashboardService['loadAdHocPending']>>,
    adHocApprovedThisPeriod: number,
    awardedRfqs: Awaited<ReturnType<ScmDashboardService['loadAwardedRfqs']>>,
    now: Date,
    periodLabel: string,
  ) {
    /** PO value = sum of its stored line totals, exactly as PO detail shows it. */
    const valueOf = (po: { lines: Array<{ lineTotal: Prisma.Decimal }> }) =>
      sumDecimals(po.lines.map((line) => line.lineTotal));

    const overdue = openPos.filter(
      (po) => po.expectedDeliveryDate && po.expectedDeliveryDate < now,
    );
    const undated = openPos.filter((po) => !po.expectedDeliveryDate);
    const partyOf = (po: {
      vendor: { companyName: string } | null;
      supplier: { companyName: string } | null;
      adHocPartyName: string | null;
    }) =>
      po.vendor?.companyName ??
      po.supplier?.companyName ??
      po.adHocPartyName ??
      'Unnamed party';

    // ── Award → PO issued. The only link between an award and the PO it
    // pre-drafted is the provenance note the award writes (there is no stored
    // rfqId), so match coverage is reported alongside the average: an unmatched
    // award shows up as missing coverage, never as a silently skewed number.
    const awardedAtByNumber = new Map(
      awardedRfqs
        .filter((rfq) => rfq.awardDecisionAt)
        .map((rfq) => [rfq.rfqNumber, rfq.awardDecisionAt!] as const),
    );
    const poCycleDays: number[] = [];
    const matchedRfqNumbers = new Set<string>();
    for (const po of openPos) {
      if (!po.issuedAt) continue;
      const rfqNumber = rfqNumberFromPoNote(po.notes);
      if (!rfqNumber) continue;
      const awardedAt = awardedAtByNumber.get(rfqNumber);
      if (!awardedAt) continue;
      matchedRfqNumbers.add(rfqNumber);
      poCycleDays.push(daysBetween(awardedAt, po.issuedAt));
    }

    return {
      open: {
        count: openPos.length,
        value: money(sumDecimals(openPos.map(valueOf))),
        pendingReceipt: openPos.filter(
          (po) => po.status === PurchaseOrderStatus.ISSUED,
        ).length,
        partiallyReceived: openPos.filter(
          (po) => po.status === PurchaseOrderStatus.PARTIALLY_RECEIVED,
        ).length,
        note: 'Issued and partially received orders — goods still owed to us. Cancelled, rejected and unapproved orders are excluded.',
      },
      overdue: {
        count: overdue.length,
        value: money(sumDecimals(overdue.map(valueOf))),
        /** Named so the reader can chase them, worst first. */
        orders: overdue.slice(0, NAMED_ROW_LIMIT).map((po) => ({
          id: po.id,
          poNumber: po.poNumber,
          status: po.status,
          partyName: partyOf(po),
          expectedDeliveryDate: po.expectedDeliveryDate,
          daysOverdue: daysBetween(po.expectedDeliveryDate!, now),
          value: money(valueOf(po)),
        })),
        /** Not overdue and not on time — simply unmeasurable, said so. */
        withoutExpectedDate: undated.length,
      },
      adHoc: {
        pendingCount: adHocPending.length,
        pendingValue: money(sumDecimals(adHocPending.map(valueOf))),
        oldestPendingAt: adHocPending[0]?.createdAt ?? null,
        approvedThisPeriod: adHocApprovedThisPeriod,
        note: `An ad-hoc order has neither a registered vendor nor a registered supplier behind it, so it bypasses the vetted base and needs CEO approval. ${adHocApprovedThisPeriod} were approved in ${periodLabel}.`,
        orders: adHocPending.slice(0, NAMED_ROW_LIMIT).map((po) => ({
          id: po.id,
          poNumber: po.poNumber,
          partyName: po.adHocPartyName ?? 'Unnamed party',
          createdAt: po.createdAt,
          waitingDays: daysBetween(po.createdAt, now),
          value: money(valueOf(po)),
        })),
      },
      cycleTime: {
        averageDays: averageNumber(poCycleDays),
        posMeasured: poCycleDays.length,
        awardsInPeriod: awardedAtByNumber.size,
        awardsMatched: matchedRfqNumbers.size,
        status: (poCycleDays.length ? 'AVAILABLE' : 'NO_DATA') as DataMaturity,
        note:
          poCycleDays.length === 0
            ? 'A purchase order carries no stored link to the RFQ it was awarded from. The award stamps the RFQ number into the order’s notes, and no still-open order currently carries a readable stamp, so this cannot be measured yet.'
            : `Award decision to purchase order issued, matched through the provenance note the award writes. Covers ${matchedRfqNumbers.size} of ${awardedAtByNumber.size} awards in ${periodLabel} — an order whose notes were edited before issue cannot be matched.`,
      },
    };
  }

  // ── §3 Vendor / supplier base ────────────────────────────────────────────

  private supplyBase(
    vendors: Array<{
      id: string;
      companyName: string;
      status: VendorStatus;
      statusOverridden: boolean;
      createdAt: Date;
    }>,
    suppliers: Array<{
      id: string;
      companyName: string;
      status: SupplierStatus;
      statusOverridden: boolean;
      createdAt: Date;
    }>,
    poValueRows: Awaited<ReturnType<ScmDashboardService['loadPoValueRows']>>,
    startsOn: Date,
    endsBefore: Date,
    periodLabel: string,
  ) {
    const partners = [
      ...vendors.map((vendor) => ({
        ...vendor,
        kind: 'VENDOR' as const,
        status: vendor.status as string,
      })),
      ...suppliers.map((supplier) => ({
        ...supplier,
        kind: 'SUPPLIER' as const,
        status: supplier.status as string,
      })),
    ];

    const classification = CLASSIFICATION_LADDER.map((status) => ({
      status,
      label: titleCase(status),
      vendors: vendors.filter((vendor) => vendor.status === status).length,
      suppliers: suppliers.filter((supplier) => supplier.status === status)
        .length,
      total: partners.filter((partner) => partner.status === status).length,
    }));

    const auditQueue = AUDIT_QUEUE_STATUSES.map((status) => ({
      status,
      label: titleCase(status),
      vendors: vendors.filter((vendor) => vendor.status === status).length,
      suppliers: suppliers.filter((supplier) => supplier.status === status)
        .length,
      total: partners.filter((partner) => partner.status === status).length,
    }));

    const overridden = partners.filter((partner) => partner.statusOverridden);
    const onboardedThisPeriod = partners.filter(
      (partner) =>
        partner.createdAt >= startsOn && partner.createdAt < endsBefore,
    );

    // ── Concentration on the supply side, using the same ranking helper the
    // Sales dashboard uses for customer concentration.
    const byParty = new Map<string, { name: string; value: Prisma.Decimal }>();
    for (const po of poValueRows) {
      const key =
        po.vendorId ?? po.supplierId ?? `adhoc:${po.adHocPartyName ?? po.id}`;
      const name =
        po.vendor?.companyName ??
        po.supplier?.companyName ??
        (po.adHocPartyName ? `${po.adHocPartyName} (ad-hoc)` : 'Unnamed party');
      const value = sumDecimals(po.lines.map((line) => line.lineTotal));
      const entry = byParty.get(key) ?? { name, value: ZERO };
      byParty.set(key, { name, value: entry.value.plus(value) });
    }
    const total = sumDecimals(
      [...byParty.values()].map((entry) => entry.value),
    );
    const ranked = shares([...byParty.values()], total, CONCENTRATION_LIMIT);

    return {
      registered: {
        total: partners.length,
        vendors: vendors.length,
        suppliers: suppliers.length,
        classified: partners.filter((partner) =>
          (CLASSIFICATION_LADDER as readonly string[]).includes(partner.status),
        ).length,
        unclassified: partners.filter(
          (partner) =>
            !(CLASSIFICATION_LADDER as readonly string[]).includes(
              partner.status,
            ),
        ).length,
        note: 'Vendors (fabrication and assembly partners) and suppliers (raw material) are separate registers with their own questionnaires and audits; both are counted here.',
      },
      classification,
      onboarded: {
        thisPeriod: onboardedThisPeriod.length,
        vendors: onboardedThisPeriod.filter((p) => p.kind === 'VENDOR').length,
        suppliers: onboardedThisPeriod.filter((p) => p.kind === 'SUPPLIER')
          .length,
        percentOfBase: percent(
          ratePercent(onboardedThisPeriod.length, partners.length),
        ),
        note: `Registered in ${periodLabel}, against a base of ${partners.length}.`,
      },
      auditQueue: {
        total: auditQueue.reduce((sum, row) => sum + row.total, 0),
        stages: auditQueue,
        note: 'Partners whose questionnaire is in and whose audit is still owed — the Internal Auditor workload. Neither module has a draft audit state (creating an audit finalizes it), so this queue is measured on the partner, not on a half-finished audit record.',
      },
      overrides: {
        count: overridden.length,
        note: overridden.length
          ? 'These classifications came from a SuperAdmin override rather than an audit score. An override should be revisited, not quietly permanent.'
          : 'No classification is currently running on a SuperAdmin override.',
        partners: overridden
          .sort((left, right) =>
            left.companyName.localeCompare(right.companyName),
          )
          .slice(0, NAMED_ROW_LIMIT)
          .map((partner) => ({
            id: partner.id,
            partnerName: partner.companyName,
            partnerType: partner.kind,
            status: partner.status,
            statusLabel: titleCase(partner.status),
          })),
      },
      concentration: {
        totalPoValue: money(total),
        status: (total.greaterThan(0)
          ? 'AVAILABLE'
          : 'NO_DATA') as DataMaturity,
        note: total.greaterThan(0)
          ? 'Share of all purchase-order value per party — the supply-side mirror of customer concentration. Unapproved, rejected and cancelled orders are excluded.'
          : 'No purchase order carries a value yet',
        topPartnerName: ranked[0]?.name ?? null,
        topPartnerPercent: percent(ranked[0]?.percentOfTotal ?? null),
        partners: ranked.map((entry) => ({
          name: entry.name,
          value: money(entry.value)!,
          percentOfTotal: percent(entry.percentOfTotal),
        })),
      },
    };
  }

  // ── §4 External vendor-operated project progress (reused, not rebuilt) ───

  /**
   * The full detail list, not a summary. Every actively vendor-executed PLM line
   * with the vendor's own last self-report and its cadence verdict, grouped by
   * vendor so the SCM Head can chase one specific partner. The self-report and
   * the RED/AMBER cadence call are the PLM module's, unchanged.
   *
   * `customerName` is stripped from every row on the way out — it arrives on the
   * PLM row but has no place on a supply-side dashboard.
   */
  private vendorProjects(
    vendorLines: ScmLine[],
    selfReports: Map<string, VendorSelfReport>,
  ) {
    const byVendor = new Map<
      string,
      {
        key: string;
        vendorName: string;
        vendorId: string | null;
        activeLines: number;
        blockedLines: number;
        overdueUpdates: number;
        dueSoonUpdates: number;
        onScheduleUpdates: number;
        lines: Array<ReturnType<ScmDashboardService['vendorLineRow']>>;
      }
    >();
    for (const line of vendorLines) {
      const key = line.facilityVendorId ?? line.facilityLabel;
      const entry = byVendor.get(key) ?? {
        key,
        vendorName: line.facilityLabel,
        vendorId: line.facilityVendorId,
        activeLines: 0,
        blockedLines: 0,
        overdueUpdates: 0,
        dueSoonUpdates: 0,
        onScheduleUpdates: 0,
        lines: [],
      };
      entry.activeLines += 1;
      if (line.health === 'BLOCKED') entry.blockedLines += 1;
      if (line.vendorCadenceStatus === 'RED') entry.overdueUpdates += 1;
      if (line.vendorCadenceStatus === 'AMBER') entry.dueSoonUpdates += 1;
      if (line.vendorCadenceStatus === 'GREEN') entry.onScheduleUpdates += 1;
      entry.lines.push(
        this.vendorLineRow(line, selfReports.get(line.trackerId) ?? null),
      );
      byVendor.set(key, entry);
    }

    const vendors = [...byVendor.values()]
      .map((vendor) => ({
        ...vendor,
        // Worst line first inside each vendor, so the row to act on reads first.
        lines: vendor.lines.sort(
          (left, right) =>
            Number(right.updateOverdue) - Number(left.updateOverdue) ||
            Number(!!right.blocker) - Number(!!left.blocker) ||
            (left.daysUntilDue ?? Number.POSITIVE_INFINITY) -
              (right.daysUntilDue ?? Number.POSITIVE_INFINITY),
        ),
      }))
      .sort(
        (left, right) =>
          right.overdueUpdates - left.overdueUpdates ||
          right.blockedLines - left.blockedLines ||
          right.activeLines - left.activeLines ||
          left.vendorName.localeCompare(right.vendorName),
      );

    return {
      vendorCount: vendors.length,
      lineCount: vendorLines.length,
      overdueUpdates: vendors.reduce(
        (sum, vendor) => sum + vendor.overdueUpdates,
        0,
      ),
      blockedLines: vendors.reduce(
        (sum, vendor) => sum + vendor.blockedLines,
        0,
      ),
      unlinkedVendorCount: vendors.filter((vendor) => !vendor.vendorId).length,
      note: vendors.length
        ? 'Self-reported progress and the 24-hour cadence escalation, exactly as the PLM vendor portal records them. A vendor with no Vendor Master link is named from the kickoff’s free-text vendor name.'
        : 'No order line is currently being executed by an external vendor.',
      vendors,
    };
  }

  /** One vendor-executed line, customer identity deliberately absent. */
  private vendorLineRow(line: ScmLine, selfReport: VendorSelfReport | null) {
    return {
      trackerId: line.trackerId,
      orderId: line.orderId,
      orderNumber: line.orderNumber,
      productName: line.productName,
      productSku: line.productSku,
      splitQuantity: line.splitQuantity,
      currentStage: line.currentStage,
      ownerName: line.ownerName,
      ageDays: line.ageDays,
      promisedDeliveryDate: line.promisedDeliveryDate,
      daysUntilDue: line.daysUntilDue,
      blocker: line.blocker,
      health: line.health,
      cadenceStatus: line.vendorCadenceStatus,
      updateOverdue: line.vendorCadenceStatus === 'RED',
      cadenceDueAt: line.vendorCadenceDueAt,
      lastUpdateAt: line.lastVendorUpdateAt,
      production: line.production,
      selfReport,
    };
  }

  /**
   * The latest self-report per TRACKER (not per vendor): §4 is the actionable
   * list, so each line carries its own last report rather than the vendor's most
   * recent one across all its lines.
   */
  private async selfReportsByTracker(vendorLines: ScmLine[]) {
    const byTracker = new Map<string, VendorSelfReport>();
    const trackerIds = vendorLines.map((line) => line.trackerId);
    if (trackerIds.length === 0) return byTracker;
    const updates = await this.prisma.plmProductionUpdate.findMany({
      where: { trackerId: { in: trackerIds } },
      orderBy: { createdAt: 'desc' },
      select: {
        trackerId: true,
        createdAt: true,
        reporterDisplayName: true,
        completedSteps: true,
        fabricationPercent: true,
        surfaceFinishPercent: true,
        assemblyPercent: true,
        notes: true,
      },
    });
    for (const update of updates) {
      // Newest first, so the first update seen for a tracker is its latest.
      if (byTracker.has(update.trackerId)) continue;
      byTracker.set(update.trackerId, {
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
        notes: update.notes,
      });
    }
    return byTracker;
  }

  // ── §5 Sourcing backlog ──────────────────────────────────────────────────

  /**
   * Sourcing work that was set up and then left. Two shapes, both real:
   * a BOM intake whose Item/Product/BOM records exist but which has never had an
   * RFQ raised against it, and an RFQ that was drafted with sourcing lines and
   * never issued. Both are aged, because a two-day-old draft is not a backlog.
   */
  private sourcingBacklog(
    activeRfqs: Awaited<ReturnType<ScmDashboardService['loadActiveRfqs']>>,
    intakes: Awaited<ReturnType<ScmDashboardService['loadUntouchedIntakes']>>,
    now: Date,
  ) {
    const stalledDrafts = activeRfqs.filter(
      (rfq) => rfq.status === RfqStatus.DRAFT && rfq._count.lines > 0,
    );
    return {
      total: intakes.length + stalledDrafts.length,
      intakes: {
        count: intakes.length,
        note: intakes.length
          ? 'Customer BOM intakes whose Item, Product and BOM records were created but which have never had an RFQ raised against them.'
          : 'Every BOM intake with created records has an RFQ against it.',
        rows: intakes.slice(0, NAMED_ROW_LIMIT).map((intake) => ({
          id: intake.id,
          productName: intake.productName,
          businessUnit: intake.businessUnit.code,
          lineCount: intake._count.lines,
          hasBom: !!intake.bomId,
          readySince: intake.updatedAt,
          idleDays: daysBetween(intake.updatedAt, now),
        })),
      },
      draftRfqs: {
        count: stalledDrafts.length,
        note: stalledDrafts.length
          ? 'RFQs with sourcing lines populated that have never been issued to an invitee. Some are waiting on Project Manager approval — that count is in RFQ health above.'
          : 'No RFQ is sitting in draft with sourcing lines populated.',
        rows: stalledDrafts.slice(0, NAMED_ROW_LIMIT).map((rfq) => ({
          id: rfq.id,
          rfqNumber: rfq.rfqNumber,
          title: rfq.title,
          lineCount: rfq._count.lines,
          inviteeCount: rfq._count.invitees,
          awaitingPmApproval: !rfq.pmApprovedAt,
          fromKickoff: !!rfq.projectKickoffId,
          fromBomIntake: !!rfq.customerBomIntakeId,
          idleSince: rfq.updatedAt,
          idleDays: daysBetween(rfq.updatedAt, now),
        })),
      },
    };
  }

  // ── §6 Cost performance ──────────────────────────────────────────────────

  /**
   * Resource-plan variance aggregated across every project that has a plan,
   * built from the SCM module's OWN `crossProjectSummary` — the same per-line
   * benchmark-vs-negotiated arithmetic the resource plan page shows, not a second
   * version of it.
   *
   * That method carries its own access rule (benchmark cost is visible to SCM,
   * Finance and the CEO only). Rather than widening it, a grantee who cannot see
   * item cost gets a RESTRICTED section: the executive dashboard grant does not
   * silently become a cost-visibility grant.
   */
  private async loadCostVariance(user: AuthenticatedUser) {
    let rows: Awaited<
      ReturnType<ScmResourcePlanService['crossProjectSummary']>
    >;
    try {
      rows = await this.resourcePlans.crossProjectSummary(user);
    } catch (error) {
      if (error instanceof ForbiddenException) {
        return {
          status: 'RESTRICTED' as const,
          note: 'Resource-plan cost variance is visible to SCM, Finance and the CEO only. Executive Dashboard access does not by itself grant item-cost visibility, so this section is withheld rather than widened.',
          projectsWithPlan: 0,
          projectsCostComplete: 0,
          projectsOverBenchmark: 0,
          totalBenchmarkCost: null,
          totalNegotiatedCost: null,
          varianceAmount: null,
          variancePercent: null,
          projects: [],
        };
      }
      throw error;
    }

    const decimal = (value: string | null) =>
      value === null ? null : new Prisma.Decimal(value);
    const benchmark = sumDecimals(
      rows
        .map((row) => decimal(row.totalBenchmarkCost))
        .filter((value): value is Prisma.Decimal => value !== null),
    );
    const negotiated = sumDecimals(
      rows
        .map((row) => decimal(row.totalNegotiatedCost))
        .filter((value): value is Prisma.Decimal => value !== null),
    );
    const variance = negotiated.minus(benchmark);

    return {
      status: (rows.length ? 'AVAILABLE' : 'NO_DATA') as
        DataMaturity | 'RESTRICTED',
      note: rows.length
        ? 'Negotiated cost against the benchmark snapshotted when each plan was generated, summed across every project with a plan. A plan with unpriced lines falls back to benchmark for those lines, so an incomplete plan reads as zero variance rather than a false saving — the cost-complete count below says how many are fully priced.'
        : 'No project has a resource plan yet.',
      projectsWithPlan: rows.length,
      projectsCostComplete: rows.filter((row) => row.isCostComplete).length,
      projectsOverBenchmark: rows.filter((row) => {
        const amount = decimal(row.varianceAmount);
        return amount !== null && amount.greaterThan(0);
      }).length,
      totalBenchmarkCost: money(benchmark),
      totalNegotiatedCost: money(negotiated),
      varianceAmount: money(variance),
      variancePercent: benchmark.greaterThan(0)
        ? percent(variance.dividedBy(benchmark).times(100))
        : null,
      /** Worst overrun first. Customer identity is deliberately dropped. */
      projects: [...rows]
        .sort((left, right) => {
          const a = decimal(right.varianceAmount) ?? ZERO;
          const b = decimal(left.varianceAmount) ?? ZERO;
          return a.comparedTo(b);
        })
        .slice(0, NAMED_ROW_LIMIT)
        .map((row) => ({
          planId: row.planId,
          projectKickoffId: row.projectKickoffId,
          projectName: row.projectName,
          orderNumber: row.orderNumber,
          totalBenchmarkCost: row.totalBenchmarkCost,
          totalNegotiatedCost: row.totalNegotiatedCost,
          varianceAmount: row.varianceAmount,
          variancePercent: row.variancePercent,
          isCostComplete: row.isCostComplete,
          lineCount: row.lineCount,
          negotiatedLineCount: row.negotiatedLineCount,
        })),
    };
  }

  // ── §7 Quality of supply ─────────────────────────────────────────────────

  private qualityOfSupply(
    ncrs: Awaited<ReturnType<ScmDashboardService['loadNcrs']>>,
    grnBacklog: Awaited<ReturnType<ScmDashboardService['loadGrnBacklog']>>,
    monthKeys: string[],
    months: Array<{ key: string; label: string }>,
    now: Date,
    periodLabel: string,
  ) {
    const partyOf = (ncr: (typeof ncrs)[number]) => {
      const po = ncr.grn.purchaseOrder;
      return {
        key: po.vendorId ?? po.supplierId ?? `adhoc:${po.adHocPartyName ?? ''}`,
        name:
          po.vendor?.companyName ??
          po.supplier?.companyName ??
          (po.adHocPartyName
            ? `${po.adHocPartyName} (ad-hoc)`
            : 'Unnamed party'),
        type: po.vendorId
          ? ('VENDOR' as const)
          : po.supplierId
            ? ('SUPPLIER' as const)
            : ('AD_HOC' as const),
      };
    };

    const byPartner = new Map<
      string,
      {
        key: string;
        partnerName: string;
        partnerType: 'VENDOR' | 'SUPPLIER' | 'AD_HOC';
        ncrCount: number;
        openCount: number;
        rejectedQuantity: Prisma.Decimal;
        returned: number;
      }
    >();
    for (const ncr of ncrs) {
      const party = partyOf(ncr);
      const entry = byPartner.get(party.key) ?? {
        key: party.key,
        partnerName: party.name,
        partnerType: party.type,
        ncrCount: 0,
        openCount: 0,
        rejectedQuantity: ZERO,
        returned: 0,
      };
      entry.ncrCount += 1;
      if (ncr.status === NonConformanceReportStatus.OPEN) entry.openCount += 1;
      entry.rejectedQuantity = entry.rejectedQuantity.plus(
        ncr.rejectedQuantity,
      );
      if (ncr.disposition === NcrDispositionType.RETURN_TO_SUPPLIER) {
        entry.returned += 1;
      }
      byPartner.set(party.key, entry);
    }

    const trend = monthlyCount(
      ncrs.map((ncr) => monthKeyOf(ncr.createdAt)),
      monthKeys,
    );
    const labelByKey = new Map(months.map((month) => [month.key, month.label]));

    return {
      ncrs: {
        raisedThisPeriod: ncrs.length,
        open: ncrs.filter(
          (ncr) => ncr.status === NonConformanceReportStatus.OPEN,
        ).length,
        dispositioned: ncrs.filter(
          (ncr) => ncr.status === NonConformanceReportStatus.DISPOSITIONED,
        ).length,
        closed: ncrs.filter(
          (ncr) => ncr.status === NonConformanceReportStatus.CLOSED,
        ).length,
        status: (ncrs.length ? 'AVAILABLE' : 'NO_DATA') as DataMaturity,
        note: 'Every one of these is supply-side by construction: a non-conformance report exists only because QC rejected a received goods line against a purchase order. Internal production non-conformances are a separate register and are not counted here.',
        trend: trend.map((point) => ({
          key: point.key,
          label: labelByKey.get(point.key) ?? point.key,
          value: point.value,
        })),
        direction: trendDirection(trend.map((point) => point.value)),
        dispositions: Object.values(NcrDispositionType).map((disposition) => ({
          disposition,
          label: titleCase(disposition),
          count: ncrs.filter((ncr) => ncr.disposition === disposition).length,
        })),
        undispositioned: ncrs.filter((ncr) => ncr.disposition === null).length,
        /** Newest first, named so a specific rejection can be followed up. */
        recent: ncrs.slice(0, NAMED_ROW_LIMIT).map((ncr) => ({
          id: ncr.id,
          ncrNumber: ncr.ncrNumber,
          itemName: ncr.item.name,
          itemCode: ncr.item.itemCode,
          partnerName: partyOf(ncr).name,
          poNumber: ncr.grn.purchaseOrder.poNumber,
          grnNumber: ncr.grn.grnNumber,
          rejectedQuantity: ncr.rejectedQuantity.toFixed(2),
          status: ncr.status,
          disposition: ncr.disposition,
          raisedAt: ncr.createdAt,
        })),
      },
      /** Which partners are actually causing the rejections, worst first. */
      partners: [...byPartner.values()]
        .sort(
          (left, right) =>
            right.ncrCount - left.ncrCount ||
            right.openCount - left.openCount ||
            left.partnerName.localeCompare(right.partnerName),
        )
        .slice(0, NAMED_ROW_LIMIT)
        .map((entry) => ({
          key: entry.key,
          partnerName: entry.partnerName,
          partnerType: entry.partnerType,
          ncrCount: entry.ncrCount,
          openCount: entry.openCount,
          returned: entry.returned,
          rejectedQuantity: entry.rejectedQuantity.toFixed(2),
        })),
      grnBacklog: {
        count: grnBacklog.length,
        oldestReceivedAt: grnBacklog[0]?.receivedDate ?? null,
        note: grnBacklog.length
          ? 'Received and awaiting QC inspection — material at the gate that has not yet become usable stock or an NCR.'
          : 'No received goods are waiting on QC inspection.',
        rows: grnBacklog.slice(0, NAMED_ROW_LIMIT).map((grn) => ({
          id: grn.id,
          grnNumber: grn.grnNumber,
          poNumber: grn.purchaseOrder.poNumber,
          partyName:
            grn.purchaseOrder.vendor?.companyName ??
            grn.purchaseOrder.supplier?.companyName ??
            grn.purchaseOrder.adHocPartyName ??
            'Unnamed party',
          receivedDate: grn.receivedDate,
          waitingDays: daysBetween(grn.receivedDate, now),
        })),
      },
      periodLabel,
    };
  }

  // ── §8 Lead time trend ───────────────────────────────────────────────────

  /**
   * Average vendor-quoted lead time per month. A rising line is the early
   * supply-stress signal — direction is reported raw (RISING / FALLING) and the
   * page states what rising means, so the arithmetic never carries the judgement.
   */
  private leadTime(
    quotes: Awaited<ReturnType<ScmDashboardService['loadLeadTimeQuotes']>>,
    months: Array<{ key: string; label: string }>,
    periodLabel: string,
  ) {
    const rows = quotes.map((quote) => ({
      monthKey: monthKeyOf(quote.submittedAt!),
      value: quote.quotedLeadTimeDays!,
      partnerId: quote.invitee.vendor?.id ?? quote.invitee.supplier?.id ?? null,
      partnerName:
        quote.invitee.vendor?.companyName ??
        quote.invitee.supplier?.companyName ??
        'Unnamed partner',
    }));
    const series = monthlyAverage(
      rows,
      months.map((month) => month.key),
    );

    const byPartner = new Map<string, { name: string; values: number[] }>();
    for (const row of rows) {
      const key = row.partnerId ?? row.partnerName;
      const entry = byPartner.get(key) ?? { name: row.partnerName, values: [] };
      entry.values.push(row.value);
      byPartner.set(key, entry);
    }

    return {
      averageDays: averageNumber(rows.map((row) => row.value)),
      quotesMeasured: rows.length,
      status: (rows.length ? 'AVAILABLE' : 'NO_DATA') as DataMaturity,
      note: rows.length
        ? `Lead time as quoted by the partner on every submitted quote in ${periodLabel}. A rising line means partners are quoting longer than they were — a supply-stress signal ahead of any missed delivery.`
        : `No quote submitted in ${periodLabel} carries a lead time.`,
      direction: trendDirection(series.map((point) => point.value)),
      trend: series.map((point, index) => ({
        key: point.key,
        label: months[index].label,
        value: point.value,
      })),
      /** Slowest quoters first — who is stretching the schedule. */
      partners: [...byPartner.entries()]
        .map(([key, entry]) => ({
          key,
          partnerName: entry.name,
          quotesMeasured: entry.values.length,
          averageDays: averageNumber(entry.values)!,
        }))
        .sort(
          (left, right) =>
            right.averageDays - left.averageDays ||
            left.partnerName.localeCompare(right.partnerName),
        )
        .slice(0, NAMED_ROW_LIMIT),
    };
  }
}

/** The vendor's own last report on one line — what they told us, not measured. */
export interface VendorSelfReport {
  reportedAt: Date;
  reporterDisplayName: string;
  stepPercent: number | null;
  completedSteps: number | null;
  fabricationPercent: number | null;
  surfaceFinishPercent: number | null;
  assemblyPercent: number | null;
  notes: string | null;
}
