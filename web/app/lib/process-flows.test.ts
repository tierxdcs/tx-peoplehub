import { describe, expect, it } from 'vitest';
import { flowForVertical, VERTICAL_FLOWS } from './process-flows';

describe('canonical employee process flows', () => {
  it('carries every process family with learning detail', () => {
    // Seven per-vertical flows plus the cross-cutting sub-processes.
    expect(VERTICAL_FLOWS.length).toBeGreaterThanOrEqual(7);
    for (const flow of VERTICAL_FLOWS) {
      expect(flow.summary.length).toBeGreaterThan(20);
      expect(flow.participants.length).toBeGreaterThan(10);
      expect(flow.steps.length).toBeGreaterThan(3);
      // Details are now multi-sentence explanations, not one-liners.
      expect(flow.steps.every((step) => step.detail.length > 40)).toBe(true);
    }
  });

  it('maps every supported employee vertical to its canonical flow', () => {
    const verticalCodes = [
      'SALES',
      'RND',
      'DESIGN',
      'ENGINEERING',
      'SCM',
      'PRODUCTION',
      'QMS',
      'ACCOUNTS',
      'HR',
    ];
    for (const code of verticalCodes) {
      expect(flowForVertical(code)).not.toBeNull();
    }
  });

  it('gives every flow a unique primary code (pill / dashboard key)', () => {
    const primaryCodes = VERTICAL_FLOWS.map((f) => f.codes[0]);
    expect(new Set(primaryCodes).size).toBe(primaryCodes.length);
  });

  it('uses the same canonical Sales data wherever Sales guidance is requested', () => {
    expect(flowForVertical('SALES')).toBe(VERTICAL_FLOWS[0]);
  });

  it('keeps Design Engineering guidance distinct from the R&D BOM lifecycle', () => {
    const design = flowForVertical('DESIGN');
    const engineering = flowForVertical('ENGINEERING');
    const rnd = flowForVertical('RND');

    expect(design).toBe(engineering);
    expect(design).not.toBe(rnd);
    expect(design?.steps.map((step) => step.key)).toEqual(
      expect.arrayContaining([
        'request',
        'project',
        'controls',
        'documents',
        'internal-review',
        'customer-approval',
        'release',
        'transmittal',
        'change-control',
      ]),
    );
    expect(
      design?.steps.find((step) => step.key === 'release')?.gate,
    ).toBe(true);
    expect(
      design?.steps.find((step) => step.key === 'transmittal')?.detail,
    ).toContain('exact documents and revisions');
  });

  it('documents the newer pre-bid and sourcing playbooks in the shared source', () => {
    const strategy = VERTICAL_FLOWS.find((flow) =>
      flow.codes.includes('BID_STRATEGY'),
    );
    const customerBom = VERTICAL_FLOWS.find((flow) =>
      flow.codes.includes('CUSTOMER_BOM'),
    );
    const rfq = VERTICAL_FLOWS.find((flow) =>
      flow.codes.includes('RFQ_SOURCING'),
    );

    expect(strategy?.steps.map((step) => step.key)).toEqual(
      expect.arrayContaining([
        'record-meeting',
        'attendees',
        'actions',
        'handoff',
      ]),
    );
    expect(customerBom?.steps.map((step) => step.key)).toEqual(
      expect.arrayContaining(['resolve', 'create', 'review']),
    );
    expect(rfq?.steps.map((step) => step.key)).toEqual(
      expect.arrayContaining(['explode', 'documents', 'approve', 'award']),
    );
    expect(rfq?.steps.find((step) => step.key === 'approve')?.gate).toBe(true);
    expect(rfq?.steps.find((step) => step.key === 'award')?.detail).toContain(
      'Draft Purchase Order',
    );
  });

  it('documents the current HR requisition, offer, onboarding and provisioning lifecycle', () => {
    const hr = flowForVertical('HR');
    const recruitment = VERTICAL_FLOWS.find((flow) =>
      flow.codes.includes('RECRUITMENT'),
    );
    const offer = VERTICAL_FLOWS.find((flow) =>
      flow.codes.includes('OFFER_LETTER'),
    );

    expect(hr?.steps.map((step) => step.key)).toEqual(
      expect.arrayContaining([
        'requisition',
        'recruitment',
        'offer',
        'onboard',
        'access',
        'provisioning',
      ]),
    );
    expect(
      recruitment?.steps.find((step) => step.key === 'budget')?.detail,
    ).toContain('Key Responsibilities and KPIs');
    expect(
      recruitment?.steps.find((step) => step.key === 'selected')?.detail,
    ).toContain('Candidate Selected');
    expect(offer?.steps.find((step) => step.key === 'draft')?.detail).toContain(
      'pre-fill',
    );
  });

  it('documents customer complaint handling through an honest COPQ roll-up', () => {
    const complaint = VERTICAL_FLOWS.find((flow) =>
      flow.codes.includes('CUSTOMER_COMPLAINT'),
    );

    expect(complaint?.steps.map((step) => step.key)).toEqual(
      expect.arrayContaining([
        'register',
        'linked-ncr',
        'contain',
        'investigate',
        'disposition-copq',
        'capa',
        'effectiveness',
        'close-complaint',
        'analytics',
      ]),
    );
    expect(
      complaint?.steps.find((step) => step.key === 'linked-ncr')?.detail,
    ).toContain('automatically creates');
    expect(
      complaint?.steps.find((step) => step.key === 'disposition-copq')?.detail,
    ).toContain('remain manual');
    expect(
      complaint?.steps.find((step) => step.key === 'analytics')?.detail,
    ).toContain('unvalued');
    expect(
      complaint?.steps.filter((step) => step.gate).map((step) => step.key),
    ).toEqual(
      expect.arrayContaining([
        'disposition-copq',
        'effectiveness',
        'close-complaint',
      ]),
    );
  });
});
