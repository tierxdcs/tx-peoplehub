import { describe, expect, it } from 'vitest';
import {
  checklistState,
  isChoiceQuestion,
  isNumericQuestion,
  questionResult,
  type InspectionQuestion,
} from './incoming-inspection';

/**
 * These rules also live on the server (IncomingInspectionService), which is the
 * authority. The client copy exists so the QC screen can show a live PASS/FAIL
 * and pre-fill the accept/reject quantities — so the cases that matter are the
 * ones where the two could drift apart and let the inspector submit something
 * the server will refuse.
 */

const q = (overrides: Partial<InspectionQuestion> = {}): InspectionQuestion => ({
  id: 'q-1',
  section: 'Receipt',
  sequence: 1,
  prompt: 'Packaging intact, no transit damage',
  responseType: 'YES_NO_NA',
  required: true,
  unit: null,
  lowerLimit: null,
  upperLimit: null,
  acceptanceCriteria: null,
  evidenceOnFailure: true,
  ...overrides,
});

describe('questionResult', () => {
  it('maps the three fixed vocabularies', () => {
    expect(questionResult(q(), 'YES')).toBe('PASS');
    expect(questionResult(q(), 'NO')).toBe('FAIL');
    expect(questionResult(q(), 'NA')).toBe('NOT_APPLICABLE');
    const pf = q({ responseType: 'PASS_FAIL_NA' });
    expect(questionResult(pf, 'PASS')).toBe('PASS');
    expect(questionResult(pf, 'FAIL')).toBe('FAIL');
    const ok = q({ responseType: 'OK_NOTOK_NA' });
    expect(questionResult(ok, 'OK')).toBe('PASS');
    expect(questionResult(ok, 'NOT OK')).toBe('FAIL');
  });

  it('is case- and whitespace-insensitive, as the server is', () => {
    expect(questionResult(q(), '  yes ')).toBe('PASS');
    expect(questionResult(q(), 'no')).toBe('FAIL');
  });

  it('does not claim a pass for an unanswered or unrecognised answer', () => {
    // Grey, not green: the server rejects these outright, so the screen must
    // never render them as conformance.
    expect(questionResult(q(), undefined)).toBeNull();
    expect(questionResult(q(), '')).toBeNull();
    expect(questionResult(q(), 'Yeah')).toBeNull();
  });

  it('judges a measurement against the question limits, inclusively', () => {
    const m = q({
      responseType: 'MEASUREMENT',
      lowerLimit: '0.4',
      upperLimit: '1.6',
    });
    expect(questionResult(m, '1.2')).toBe('PASS');
    expect(questionResult(m, '0.4')).toBe('PASS');
    expect(questionResult(m, '1.6')).toBe('PASS');
    expect(questionResult(m, '0.39')).toBe('FAIL');
    expect(questionResult(m, '1.61')).toBe('FAIL');
  });

  it('applies a one-sided limit on its own side only', () => {
    const lower = q({ responseType: 'NUMBER', lowerLimit: '6' });
    expect(questionResult(lower, '5.9')).toBe('FAIL');
    expect(questionResult(lower, '600')).toBe('PASS');
    const upper = q({ responseType: 'NUMBER', upperLimit: '6' });
    expect(questionResult(upper, '6.1')).toBe('FAIL');
    expect(questionResult(upper, '-3')).toBe('PASS');
  });

  it('records an unbounded number and free text without grading them', () => {
    expect(questionResult(q({ responseType: 'NUMBER' }), '42')).toBeNull();
    expect(questionResult(q({ responseType: 'TEXT' }), 'looks fine')).toBeNull();
    expect(questionResult(q({ responseType: 'DATE' }), '2026-08-31')).toBeNull();
  });

  it('classifies response types the form has to render differently', () => {
    expect(isChoiceQuestion('YES_NO_NA')).toBe(true);
    expect(isChoiceQuestion('TEXT')).toBe(false);
    expect(isNumericQuestion('MEASUREMENT')).toBe(true);
    expect(isNumericQuestion('RATING')).toBe(true);
    expect(isNumericQuestion('DATE')).toBe(false);
  });
});

describe('checklistState', () => {
  it('is complete and passing once every question conforms', () => {
    const state = checklistState([q()], { 'q-1': 'YES' }, {});
    expect(state).toMatchObject({
      result: 'PASS',
      complete: true,
      failedPrompts: [],
      blocker: null,
    });
  });

  it('blocks on an unanswered required question, naming it', () => {
    const state = checklistState([q()], {}, {});
    expect(state.complete).toBe(false);
    expect(state.blocker).toBe('Answer "Packaging intact, no transit damage".');
  });

  it('lets an optional question stay blank', () => {
    const state = checklistState(
      [q({ id: 'q-9', required: false, responseType: 'TEXT' })],
      {},
      {},
    );
    expect(state).toMatchObject({ complete: true, result: 'PASS', blocker: null });
  });

  it('fails the line and lists every failed check', () => {
    const questions = [
      q({ id: 'a', prompt: 'Packaging intact', evidenceOnFailure: false }),
      q({ id: 'b', prompt: 'Quantity matches challan', evidenceOnFailure: false }),
      q({ id: 'c', prompt: 'Part marking legible', evidenceOnFailure: false }),
    ];
    const state = checklistState(
      questions,
      { a: 'NO', b: 'YES', c: 'NO' },
      {},
    );
    expect(state.result).toBe('FAIL');
    expect(state.failedPrompts).toEqual([
      'Packaging intact',
      'Part marking legible',
    ]);
    // A failed checklist is still a complete one — it is what the inspector
    // submits to reject the lot.
    expect(state.complete).toBe(true);
  });

  it('demands a written observation on a failure the template wants evidence for', () => {
    const state = checklistState([q()], { 'q-1': 'NO' }, {});
    expect(state.result).toBe('FAIL');
    expect(state.complete).toBe(false);
    expect(state.blocker).toBe(
      'Record what was observed for "Packaging intact, no transit damage".',
    );

    const withNote = checklistState(
      [q()],
      { 'q-1': 'NO' },
      { 'q-1': 'Corner crushed on carton 2' },
    );
    expect(withNote).toMatchObject({ result: 'FAIL', complete: true, blocker: null });
  });

  it('does not accept whitespace as the observation', () => {
    const state = checklistState([q()], { 'q-1': 'NO' }, { 'q-1': '   ' });
    expect(state.complete).toBe(false);
  });

  it('blocks a non-numeric answer to a measurement', () => {
    const state = checklistState(
      [q({ responseType: 'MEASUREMENT', prompt: 'Surface finish Ra', upperLimit: '1.6' })],
      { 'q-1': 'smooth' },
      {},
    );
    expect(state.complete).toBe(false);
    expect(state.blocker).toBe('"Surface finish Ra" expects a number.');
  });

  it('reports only the first blocker, so the inspector fixes one thing at a time', () => {
    const questions = [q({ id: 'a', prompt: 'First' }), q({ id: 'b', prompt: 'Second' })];
    expect(checklistState(questions, {}, {}).blocker).toBe('Answer "First".');
  });

  it('is never complete with no questions at all', () => {
    // An empty template must not read as a satisfied checklist — that would let
    // a line through the mandatory gate with nothing inspected.
    expect(checklistState([], {}, {}).complete).toBe(false);
  });
});
