import { BadRequestException, Injectable } from '@nestjs/common';
import {
  Prisma,
  QmsInspectionResult,
  QmsInspectionStatus,
  QmsResponseType,
} from '@prisma/client';
import { PrismaService } from '../../core/database/prisma.service';
import { QcChecklistResponseDto } from './dto/goods-receipt-note.dto';

/**
 * Incoming (GRN) inspection against a QMS question template.
 *
 * The QMS module already owns versioned, approval-gated question templates and
 * the QmsInspection record that freezes a template snapshot alongside its
 * answers. What was missing was the link from Stores: a GRN's QC gate decided
 * accepted/rejected quantities with nothing recording WHY. This service closes
 * that gap — every GRN line is inspected against an APPROVED template of type
 * INCOMING, and the checklist result drives the accept/reject decision.
 *
 * It reads the qms_* tables directly rather than calling QmsService, for two
 * reasons: importing QmsModule here would close a module cycle (Stores -> QMS ->
 * Notifications -> Stores), and the GRN gate needs a TERMINAL inspection created
 * inside the finalize transaction, not QmsService's two-step
 * complete -> QMS-Head-review flow which would leave received goods waiting on a
 * second person before any stock could move.
 */

/** The template shape offered to the QC screen. */
export interface IncomingTemplateQuestion {
  id: string;
  section: string;
  sequence: number;
  prompt: string;
  responseType: QmsResponseType;
  required: boolean;
  unit: string | null;
  lowerLimit: string | null;
  upperLimit: string | null;
  options: unknown;
  acceptanceCriteria: string | null;
  evidenceOnFailure: boolean;
}

export interface IncomingTemplate {
  id: string;
  templateCode: string;
  name: string;
  version: number;
  description: string | null;
  questions: IncomingTemplateQuestion[];
}

type TemplateRow = Prisma.QmsQuestionTemplateGetPayload<{
  include: { questions: true };
}>;
type QuestionRow = TemplateRow['questions'][number];

/** One evaluated answer, ready to be written as a QmsInspectionResponse. */
interface EvaluatedResponse {
  questionKey: string;
  section: string;
  sequence: number;
  promptSnapshot: string;
  responseType: QmsResponseType;
  required: boolean;
  answer: Prisma.InputJsonValue;
  result: QmsInspectionResult | null;
  comments: string | null;
}

export interface ChecklistEvaluation {
  /** PASS unless at least one question failed. Never inferred from quantities. */
  result: Extract<QmsInspectionResult, 'PASS' | 'FAIL'>;
  failedPrompts: string[];
  responses: EvaluatedResponse[];
}

/**
 * Accepted answers for the three-way response types, and what each means. An
 * answer outside these sets is rejected rather than silently treated as a pass —
 * a typo must never read as conformance.
 */
const CHOICE_ANSWERS: Record<
  string,
  Record<string, QmsInspectionResult>
> = {
  YES_NO_NA: {
    YES: 'PASS',
    NO: 'FAIL',
    NA: 'NOT_APPLICABLE',
    'N/A': 'NOT_APPLICABLE',
  },
  PASS_FAIL_NA: {
    PASS: 'PASS',
    FAIL: 'FAIL',
    NA: 'NOT_APPLICABLE',
    'N/A': 'NOT_APPLICABLE',
  },
  OK_NOTOK_NA: {
    OK: 'PASS',
    'NOT OK': 'FAIL',
    NOTOK: 'FAIL',
    NOT_OK: 'FAIL',
    NA: 'NOT_APPLICABLE',
    'N/A': 'NOT_APPLICABLE',
  },
};

/** Response types whose answer is a measured number a limit can be checked against. */
const NUMERIC_TYPES: QmsResponseType[] = [
  QmsResponseType.NUMBER,
  QmsResponseType.MEASUREMENT,
  QmsResponseType.RATING,
];

@Injectable()
export class IncomingInspectionService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * The APPROVED, INCOMING-type templates a QC inspector may inspect against.
   * DRAFT and PENDING_APPROVAL templates are deliberately absent: an unapproved
   * checklist must not be able to accept material into stock.
   */
  async templates(): Promise<IncomingTemplate[]> {
    const rows = await this.prisma.qmsQuestionTemplate.findMany({
      where: { templateType: 'INCOMING', status: 'APPROVED' },
      include: { questions: { orderBy: { sequence: 'asc' } } },
      orderBy: [{ templateCode: 'asc' }, { version: 'desc' }],
    });
    return rows.map((t) => this.toTemplate(t));
  }

  /** Loads the templates a finalize call referenced, keyed by id. */
  async loadTemplates(ids: string[]): Promise<Map<string, TemplateRow>> {
    const unique = [...new Set(ids)];
    if (!unique.length) return new Map();
    const rows = await this.prisma.qmsQuestionTemplate.findMany({
      where: { id: { in: unique } },
      include: { questions: { orderBy: { sequence: 'asc' } } },
    });
    const byId = new Map(rows.map((r) => [r.id, r]));
    for (const id of unique) {
      const t = byId.get(id);
      if (!t) {
        throw new BadRequestException(`Inspection template not found: ${id}`);
      }
      if (t.status !== 'APPROVED') {
        throw new BadRequestException(
          `Template ${t.templateCode} is ${t.status} — only an APPROVED template can be inspected against`,
        );
      }
      if (t.templateType !== 'INCOMING') {
        throw new BadRequestException(
          `Template ${t.templateCode} is a ${t.templateType} template — incoming goods must use an INCOMING template`,
        );
      }
    }
    return byId;
  }

  /**
   * Validates one line's answers against its template and derives the result.
   *
   * `label` prefixes every message so a rejected finalize names the offending
   * line (the QC screen inspects several items at once).
   */
  evaluate(
    template: TemplateRow,
    answers: QcChecklistResponseDto[],
    label: string,
  ): ChecklistEvaluation {
    const byKey = new Map(answers.map((a) => [a.questionKey, a]));
    if (byKey.size !== answers.length) {
      throw new BadRequestException(
        `${label}: the same checklist question was answered twice`,
      );
    }
    const questionIds = new Set(template.questions.map((q) => q.id));
    for (const a of answers) {
      if (!questionIds.has(a.questionKey)) {
        throw new BadRequestException(
          `${label}: answer references a question (${a.questionKey}) that is not on template ${template.templateCode}`,
        );
      }
    }

    const responses: EvaluatedResponse[] = [];
    const failedPrompts: string[] = [];
    for (const q of template.questions) {
      const given = byKey.get(q.id);
      const raw = given?.answer;
      const answer = typeof raw === 'string' ? raw.trim() : '';
      const comments = given?.comments?.trim() || null;

      if (!answer) {
        if (q.required) {
          throw new BadRequestException(
            `${label}: "${q.prompt}" is required and has not been answered`,
          );
        }
        responses.push({
          questionKey: q.id,
          section: q.section,
          sequence: q.sequence,
          promptSnapshot: q.prompt,
          responseType: q.responseType,
          required: q.required,
          answer: { value: '' },
          result: null,
          comments,
        });
        continue;
      }

      const result = this.resultFor(q, answer, label);
      if (result === 'FAIL') {
        failedPrompts.push(q.prompt);
        // The template asks for evidence when this check fails. There is no file
        // upload at the GRN gate, so the recorded equivalent is a written
        // observation — a bare "FAIL" with no reason is not an audit trail.
        if (q.evidenceOnFailure && !comments) {
          throw new BadRequestException(
            `${label}: "${q.prompt}" failed — record what was observed in the remarks for that question`,
          );
        }
      }
      responses.push({
        questionKey: q.id,
        section: q.section,
        sequence: q.sequence,
        promptSnapshot: q.prompt,
        responseType: q.responseType,
        required: q.required,
        answer: { value: answer },
        result,
        comments,
      });
    }

    return {
      result: failedPrompts.length ? 'FAIL' : 'PASS',
      failedPrompts,
      responses,
    };
  }

  /**
   * Per-question pass/fail. Choice answers map from a fixed vocabulary;
   * numeric answers are checked against the template's limits (the reason
   * lowerLimit/upperLimit exist). Free-text, dates and attachments are
   * informational — they are recorded but cannot by themselves fail a lot.
   */
  private resultFor(
    q: QuestionRow,
    answer: string,
    label: string,
  ): QmsInspectionResult | null {
    const choices = CHOICE_ANSWERS[q.responseType];
    if (choices) {
      const mapped = choices[answer.toUpperCase()];
      if (!mapped) {
        throw new BadRequestException(
          `${label}: "${q.prompt}" has an unrecognised answer (${answer}) — expected one of ${Object.keys(
            choices,
          )
            .filter((k) => k !== 'N/A' && k !== 'NOT_OK' && k !== 'NOTOK')
            .join(', ')}`,
        );
      }
      return mapped;
    }

    if (NUMERIC_TYPES.includes(q.responseType)) {
      const value = Number(answer);
      if (!Number.isFinite(value)) {
        throw new BadRequestException(
          `${label}: "${q.prompt}" expects a number (got ${answer})`,
        );
      }
      const lower = q.lowerLimit === null ? null : Number(q.lowerLimit);
      const upper = q.upperLimit === null ? null : Number(q.upperLimit);
      if (lower === null && upper === null) return null; // recorded, not graded
      if (lower !== null && value < lower) return 'FAIL';
      if (upper !== null && value > upper) return 'FAIL';
      return 'PASS';
    }

    return null;
  }

  /**
   * Writes the terminal inspection record for one GRN line inside the caller's
   * finalize transaction. Terminal by design — the QC inspector's decision IS
   * the decision, so there is no PENDING_REVIEW state holding stock back.
   *
   * `status`/`overallResult` describe the LOT: fully accepted is PASSED, fully
   * rejected is FAILED, and a split is CONDITIONAL_PASS. The checklist result
   * that produced it is preserved per-question in `responses`.
   */
  async createForGrnLine(
    tx: Prisma.TransactionClient,
    args: {
      template: TemplateRow;
      evaluation: ChecklistEvaluation;
      grnId: string;
      grnLineId: string;
      grnNumber: string;
      receivedQuantity: Prisma.Decimal;
      acceptedQuantity: Prisma.Decimal;
      rejectedQuantity: Prisma.Decimal;
      remarks?: string | null;
      inspectorId: string;
      inspectedAt: Date;
    },
  ): Promise<{ id: string; inspectionNumber: string }> {
    const { template, evaluation } = args;
    const status: QmsInspectionStatus = args.rejectedQuantity.equals(0)
      ? 'PASSED'
      : args.acceptedQuantity.equals(0)
        ? 'FAILED'
        : 'CONDITIONAL_PASS';
    const overallResult: QmsInspectionResult =
      status === 'PASSED'
        ? 'PASS'
        : status === 'FAILED'
          ? 'FAIL'
          : 'CONDITIONAL_PASS';

    const snapshot = {
      templateId: template.id,
      templateCode: template.templateCode,
      version: template.version,
      name: template.name,
      questions: template.questions,
    };

    const created = await tx.qmsInspection.create({
      data: {
        inspectionNumber: await this.nextInspectionNumber(tx),
        inspectionType: template.templateType,
        status,
        overallResult,
        templateSnapshot: snapshot as unknown as Prisma.InputJsonValue,
        grnId: args.grnId,
        grnLineId: args.grnLineId,
        quantityOffered: args.receivedQuantity,
        quantityInspected: args.receivedQuantity,
        quantityAccepted: args.acceptedQuantity,
        quantityRejected: args.rejectedQuantity,
        remarks: this.remarksFor(args.grnNumber, evaluation, args.remarks),
        inspectedById: args.inspectorId,
        inspectedAt: args.inspectedAt,
        createdById: args.inspectorId,
        responses: {
          create: evaluation.responses.map((r) => ({
            questionKey: r.questionKey,
            section: r.section,
            sequence: r.sequence,
            promptSnapshot: r.promptSnapshot,
            responseType: r.responseType,
            required: r.required,
            answer: r.answer,
            result: r.result,
            comments: r.comments,
          })),
        },
      },
      select: { id: true, inspectionNumber: true },
    });
    return created;
  }

  private remarksFor(
    grnNumber: string,
    evaluation: ChecklistEvaluation,
    inspectorRemarks: string | null | undefined,
  ): string {
    const parts = [`Incoming inspection at ${grnNumber}.`];
    if (evaluation.failedPrompts.length) {
      parts.push(`Failed checks: ${evaluation.failedPrompts.join('; ')}.`);
    }
    const own = inspectorRemarks?.trim();
    if (own) parts.push(own);
    return parts.join(' ');
  }

  /**
   * QI-YYYY-NNNNN, sharing the exact counter QmsService uses (finance_sequences,
   * entity QMS_INSPECTION) so numbers issued from the GRN gate and from the QMS
   * screens can never collide.
   */
  private async nextInspectionNumber(
    tx: Prisma.TransactionClient,
  ): Promise<string> {
    const year = new Date().getUTCFullYear();
    const seq = await tx.financeSequence.upsert({
      where: { entity_year: { entity: 'QMS_INSPECTION', year } },
      create: { entity: 'QMS_INSPECTION', year, lastValue: 1 },
      update: { lastValue: { increment: 1 } },
    });
    return `QI-${year}-${String(seq.lastValue).padStart(5, '0')}`;
  }

  private toTemplate(t: TemplateRow): IncomingTemplate {
    return {
      id: t.id,
      templateCode: t.templateCode,
      name: t.name,
      version: t.version,
      description: t.description,
      questions: t.questions.map((q) => ({
        id: q.id,
        section: q.section,
        sequence: q.sequence,
        prompt: q.prompt,
        responseType: q.responseType,
        required: q.required,
        unit: q.unit,
        lowerLimit: q.lowerLimit === null ? null : q.lowerLimit.toString(),
        upperLimit: q.upperLimit === null ? null : q.upperLimit.toString(),
        options: q.options,
        acceptanceCriteria: q.acceptanceCriteria,
        evidenceOnFailure: q.evidenceOnFailure,
      })),
    };
  }
}
