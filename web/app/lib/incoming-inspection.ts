/**
 * Client-side mirror of the incoming-inspection grading rules the GRN QC gate
 * enforces on the server (`IncomingInspectionService`). Pure — no fetch, no
 * React — so the inspector sees a live PASS/FAIL as they answer instead of
 * discovering it in a rejected submit.
 *
 * The server grades independently and is the authority; this exists so the
 * screen can pre-fill the accept/reject quantities from the checklist and
 * disable Finalize on an incomplete one. If the two ever disagree, the server
 * wins and its message is shown.
 */

export type QmsResponseType =
  | 'YES_NO_NA'
  | 'PASS_FAIL_NA'
  | 'OK_NOTOK_NA'
  | 'TEXT'
  | 'NUMBER'
  | 'MEASUREMENT'
  | 'DATE'
  | 'SINGLE_CHOICE'
  | 'MULTIPLE_CHOICE'
  | 'RATING'
  | 'PHOTO'
  | 'DOCUMENT'
  | 'SIGNATURE';

export type QuestionResult = 'PASS' | 'FAIL' | 'NOT_APPLICABLE' | null;

export interface InspectionQuestion {
  id: string;
  section: string;
  sequence: number;
  prompt: string;
  responseType: QmsResponseType;
  required: boolean;
  unit: string | null;
  lowerLimit: string | null;
  upperLimit: string | null;
  acceptanceCriteria: string | null;
  evidenceOnFailure: boolean;
}

/** The selectable answers for the three fixed-vocabulary response types. */
export const CHOICE_OPTIONS: Partial<Record<QmsResponseType, string[]>> = {
  YES_NO_NA: ['YES', 'NO', 'NA'],
  PASS_FAIL_NA: ['PASS', 'FAIL', 'NA'],
  OK_NOTOK_NA: ['OK', 'NOT OK', 'NA'],
};

const CHOICE_RESULT: Record<string, QuestionResult> = {
  YES: 'PASS',
  PASS: 'PASS',
  OK: 'PASS',
  NO: 'FAIL',
  FAIL: 'FAIL',
  'NOT OK': 'FAIL',
  NA: 'NOT_APPLICABLE',
};

const NUMERIC_TYPES: QmsResponseType[] = ['NUMBER', 'MEASUREMENT', 'RATING'];

export function isChoiceQuestion(type: QmsResponseType): boolean {
  return CHOICE_OPTIONS[type] !== undefined;
}

export function isNumericQuestion(type: QmsResponseType): boolean {
  return NUMERIC_TYPES.includes(type);
}

/**
 * One question's result. Choice answers map from the fixed vocabulary; numeric
 * answers are graded against the question's limits. Free text, dates and
 * attachments are recorded but never fail a lot on their own — hence null.
 */
export function questionResult(
  q: Pick<InspectionQuestion, 'responseType' | 'lowerLimit' | 'upperLimit'>,
  answer: string | undefined,
): QuestionResult {
  const value = (answer ?? '').trim();
  if (!value) return null;
  if (isChoiceQuestion(q.responseType)) {
    return CHOICE_RESULT[value.toUpperCase()] ?? null;
  }
  if (isNumericQuestion(q.responseType)) {
    const n = Number(value);
    if (!Number.isFinite(n)) return null;
    const lower = q.lowerLimit === null ? null : Number(q.lowerLimit);
    const upper = q.upperLimit === null ? null : Number(q.upperLimit);
    if (lower === null && upper === null) return null;
    if (lower !== null && n < lower) return 'FAIL';
    if (upper !== null && n > upper) return 'FAIL';
    return 'PASS';
  }
  return null;
}

export interface ChecklistState {
  /** PASS unless a question failed. Meaningless while `complete` is false. */
  result: 'PASS' | 'FAIL';
  complete: boolean;
  failedPrompts: string[];
  /** The first thing stopping a submit, phrased for the inspector. */
  blocker: string | null;
}

/**
 * Whether a line's checklist is answered and what it says. `answers` and
 * `comments` are keyed by question id.
 */
export function checklistState(
  questions: InspectionQuestion[],
  answers: Record<string, string>,
  comments: Record<string, string>,
): ChecklistState {
  const failedPrompts: string[] = [];
  let blocker: string | null = null;

  for (const q of questions) {
    const answer = (answers[q.id] ?? '').trim();
    if (!answer) {
      if (q.required && !blocker) blocker = `Answer "${q.prompt}".`;
      continue;
    }
    if (isNumericQuestion(q.responseType) && !Number.isFinite(Number(answer))) {
      if (!blocker) blocker = `"${q.prompt}" expects a number.`;
      continue;
    }
    if (questionResult(q, answer) === 'FAIL') {
      failedPrompts.push(q.prompt);
      // Mirrors the server: a failed check whose template wants evidence needs
      // a written observation, since there is no upload at the GRN gate.
      if (q.evidenceOnFailure && !(comments[q.id] ?? '').trim() && !blocker) {
        blocker = `Record what was observed for "${q.prompt}".`;
      }
    }
  }

  return {
    result: failedPrompts.length ? 'FAIL' : 'PASS',
    complete: questions.length > 0 && !blocker,
    failedPrompts,
    blocker,
  };
}
