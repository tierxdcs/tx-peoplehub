import { describe, expect, it } from 'vitest';
import {
  filterRequisitions,
  requisitionFilterOptions,
  requisitionSearchText,
  requisitionStage,
  sortRequisitions,
  type RequisitionRegisterRow,
} from './candidate-requisition-register';

const row = (
  overrides: Partial<RequisitionRegisterRow> & { requisitionNumber: string },
): RequisitionRegisterRow => ({
  positionTitle: 'Mechanical assy Man',
  status: 'APPROVED',
  hiringStage: null,
  budgetAnnualCtc: '252000.00',
  selectedCandidateName: null,
  requestedBy: { id: 'emp-1', firstName: 'Ravi', lastName: 'Kulal H' },
  vertical: { name: 'Production & Operations' },
  ...overrides,
});

describe('requisitionStage', () => {
  it('shows the approval status until the requisition is approved', () => {
    expect(
      requisitionStage(
        row({
          requisitionNumber: 'REQ-2026-0019',
          status: 'PENDING_VERTICAL_APPROVAL',
        }),
      ),
    ).toBe('PENDING VERTICAL APPROVAL');
  });

  it("shows HR's hiring stage once it is approved", () => {
    expect(
      requisitionStage(
        row({
          requisitionNumber: 'REQ-2026-0021',
          hiringStage: 'INTERVIEWING',
        }),
      ),
    ).toBe('INTERVIEWING');
  });

  it('reads a selected candidate as FULFILLED', () => {
    // By this point the candidate has accepted and been onboarded — selection
    // alone never reaches this label.
    expect(
      requisitionStage(
        row({
          requisitionNumber: 'REQ-2026-0014',
          hiringStage: 'CANDIDATE_SELECTED',
        }),
      ),
    ).toBe('FULFILLED');
  });

  it('keeps a rejection visible even though the hiring stage is set', () => {
    // A rejected requisition may carry a stale stage; the refusal is what matters.
    expect(
      requisitionStage(
        row({
          requisitionNumber: 'REQ-2026-0002',
          status: 'REJECTED',
          hiringStage: 'JOB_POSTED',
        }),
      ),
    ).toBe('REJECTED');
  });
});

describe('filterRequisitions', () => {
  const rows = [
    row({ requisitionNumber: 'REQ-2026-0021', hiringStage: 'OFFER_EXTENDED' }),
    row({
      requisitionNumber: 'REQ-2026-0019',
      status: 'PENDING_VERTICAL_APPROVAL',
    }),
    row({
      requisitionNumber: 'REQ-2026-0014',
      hiringStage: 'CANDIDATE_SELECTED',
    }),
    row({ requisitionNumber: 'REQ-2026-0009', status: 'CANCELLED' }),
    row({
      requisitionNumber: 'REQ-2026-0013',
      vertical: { name: 'Supply Chain Management' },
      requestedBy: { id: 'emp-2', firstName: 'Krishna', lastName: 'VR' },
    }),
  ];
  const numbers = (result: RequisitionRegisterRow[]) =>
    result.map((r) => r.requisitionNumber);

  it('returns everything when nothing is chosen', () => {
    expect(
      filterRequisitions(rows, { stage: '', vertical: '', requesterId: '' }),
    ).toHaveLength(5);
  });

  it('groups the live work under Open and the settled ones under Closed', () => {
    expect(
      numbers(
        filterRequisitions(rows, {
          stage: 'group:open',
          vertical: '',
          requesterId: '',
        }),
      ),
    ).toEqual(['REQ-2026-0021', 'REQ-2026-0019', 'REQ-2026-0013']);
    expect(
      numbers(
        filterRequisitions(rows, {
          stage: 'group:closed',
          vertical: '',
          requesterId: '',
        }),
      ),
    ).toEqual(['REQ-2026-0014', 'REQ-2026-0009']);
  });

  it('matches an exact stage', () => {
    expect(
      numbers(
        filterRequisitions(rows, {
          stage: 'OFFER EXTENDED',
          vertical: '',
          requesterId: '',
        }),
      ),
    ).toEqual(['REQ-2026-0021']);
  });

  it('combines stage, vertical and requester as an AND', () => {
    expect(
      numbers(
        filterRequisitions(rows, {
          stage: 'group:open',
          vertical: 'Supply Chain Management',
          requesterId: 'emp-2',
        }),
      ),
    ).toEqual(['REQ-2026-0013']);
    // …and the same requester in a vertical they have nothing in returns none.
    expect(
      filterRequisitions(rows, {
        stage: '',
        vertical: 'Production & Operations',
        requesterId: 'emp-2',
      }),
    ).toEqual([]);
  });
});

describe('sortRequisitions', () => {
  const rows = [
    row({ requisitionNumber: 'REQ-2026-0013', budgetAnnualCtc: '420000.00' }),
    row({
      requisitionNumber: 'REQ-2026-0021',
      positionTitle: 'SCM Coordinator',
      budgetAnnualCtc: '198000.00',
      hiringStage: 'OFFER_EXTENDED',
    }),
    row({
      requisitionNumber: 'REQ-2026-0019',
      status: 'PENDING_VERTICAL_APPROVAL',
      budgetAnnualCtc: null,
    }),
  ];
  const numbers = (result: RequisitionRegisterRow[]) =>
    result.map((r) => r.requisitionNumber);

  it('orders by requisition number in both directions', () => {
    expect(
      numbers(sortRequisitions(rows, 'requisitionNumber', 'desc')),
    ).toEqual(['REQ-2026-0021', 'REQ-2026-0019', 'REQ-2026-0013']);
    expect(numbers(sortRequisitions(rows, 'requisitionNumber', 'asc'))).toEqual(
      ['REQ-2026-0013', 'REQ-2026-0019', 'REQ-2026-0021'],
    );
  });

  it('sinks a missing budget to the bottom whichever way the column points', () => {
    expect(numbers(sortRequisitions(rows, 'budgetAnnualCtc', 'desc'))).toEqual([
      'REQ-2026-0013',
      'REQ-2026-0021',
      'REQ-2026-0019',
    ]);
    expect(numbers(sortRequisitions(rows, 'budgetAnnualCtc', 'asc'))).toEqual([
      'REQ-2026-0021',
      'REQ-2026-0013',
      'REQ-2026-0019',
    ]);
  });

  it('orders stages by the lifecycle, not the alphabet', () => {
    // APPROVED before OFFER EXTENDED before REJECTED — alphabetically these
    // three would come out in an order that means nothing.
    const staged = [
      row({ requisitionNumber: 'REQ-1', status: 'REJECTED' }),
      row({ requisitionNumber: 'REQ-2', hiringStage: 'OFFER_EXTENDED' }),
      row({ requisitionNumber: 'REQ-3' }),
    ];
    expect(numbers(sortRequisitions(staged, 'stage', 'asc'))).toEqual([
      'REQ-3',
      'REQ-2',
      'REQ-1',
    ]);
  });

  it('breaks ties on the requisition number so the order is stable', () => {
    const tied = [
      row({ requisitionNumber: 'REQ-2026-0015' }),
      row({ requisitionNumber: 'REQ-2026-0018' }),
      row({ requisitionNumber: 'REQ-2026-0016' }),
    ];
    // Same position, same budget, same stage — newest first, deterministically.
    expect(numbers(sortRequisitions(tied, 'positionTitle', 'asc'))).toEqual([
      'REQ-2026-0018',
      'REQ-2026-0016',
      'REQ-2026-0015',
    ]);
  });

  it('leaves the input array untouched', () => {
    const original = [...rows];
    sortRequisitions(rows, 'positionTitle', 'asc');
    expect(rows).toEqual(original);
  });
});

describe('requisitionFilterOptions', () => {
  it('offers only the stages, verticals and requesters actually present', () => {
    const options = requisitionFilterOptions([
      row({ requisitionNumber: 'REQ-1', hiringStage: 'OFFER_EXTENDED' }),
      row({ requisitionNumber: 'REQ-2', status: 'PENDING_VERTICAL_APPROVAL' }),
      row({
        requisitionNumber: 'REQ-3',
        vertical: { name: 'Supply Chain Management' },
        requestedBy: { id: 'emp-2', firstName: 'Krishna', lastName: 'VR' },
      }),
      // A duplicate requester and vertical must not produce duplicate options.
      row({ requisitionNumber: 'REQ-4', status: 'PENDING_VERTICAL_APPROVAL' }),
    ]);

    expect(options.stages).toEqual([
      'PENDING VERTICAL APPROVAL',
      'APPROVED',
      'OFFER EXTENDED',
    ]);
    expect(options.verticals).toEqual([
      'Production & Operations',
      'Supply Chain Management',
    ]);
    expect(options.requesters).toEqual([
      { id: 'emp-2', name: 'Krishna VR' },
      { id: 'emp-1', name: 'Ravi Kulal H' },
    ]);
  });
});

describe('requisitionSearchText', () => {
  it('covers the number, position, stage, requester, vertical and candidate', () => {
    const text = requisitionSearchText(
      row({
        requisitionNumber: 'REQ-2026-0021',
        positionTitle: 'SCM Coordinator',
        hiringStage: 'OFFER_EXTENDED',
        selectedCandidateName: 'Pallavi V L',
      }),
    );
    expect(text).toContain('REQ-2026-0021');
    expect(text).toContain('SCM Coordinator');
    expect(text).toContain('OFFER EXTENDED');
    expect(text).toContain('Ravi Kulal H');
    expect(text).toContain('Production & Operations');
    expect(text).toContain('Pallavi V L');
  });
});
