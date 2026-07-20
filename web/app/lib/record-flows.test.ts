import { describe, expect, it } from 'vitest';
import {
  bidFlow,
  orderFlow,
  poFlow,
  rfqFlow,
  vendorFlow,
  supplierFlow,
  kickoffFlow,
} from './record-flows';

describe('record flows — stage derived from actual status', () => {
  it('bid: maps each live status and flags dead ones as cancelled', () => {
    expect(bidFlow('DRAFT').currentStage).toBe('draft');
    expect(bidFlow('PENDING_APPROVAL').currentStage).toBe('pending');
    expect(bidFlow('SENT').currentStage).toBe('sent');
    expect(bidFlow('ACCEPTED').currentStage).toBe('accepted');
    expect(bidFlow('REJECTED').cancelled).toBe(true);
    expect(bidFlow('EXPIRED').cancelled).toBe(true);
    expect(bidFlow('REJECTED').currentStage).toBeNull();
  });

  it('order: confirmed → delivered, cancelled is terminal', () => {
    expect(orderFlow('CONFIRMED').currentStage).toBe('confirmed');
    expect(orderFlow('IN_PRODUCTION').currentStage).toBe('production');
    expect(orderFlow('DELIVERED').currentStage).toBe('delivered');
    expect(orderFlow('CANCELLED').cancelled).toBe(true);
  });

  it('PO: draft → issued → received', () => {
    expect(poFlow('DRAFT').currentStage).toBe('draft');
    expect(poFlow('PARTIALLY_RECEIVED').currentStage).toBe('partial');
    expect(poFlow('FULLY_RECEIVED').currentStage).toBe('full');
    expect(poFlow('CANCELLED').cancelled).toBe(true);
  });

  it('RFQ: draft → issued → closed → awarded', () => {
    expect(rfqFlow('DRAFT').currentStage).toBe('draft');
    expect(rfqFlow('CLOSED').currentStage).toBe('closed');
    expect(rfqFlow('AWARDED').currentStage).toBe('awarded');
    expect(rfqFlow('CANCELLED').cancelled).toBe(true);
  });

  it('vendor/supplier: questionnaire → submitted → audit → classified', () => {
    expect(vendorFlow('PENDING_QUESTIONNAIRE').currentStage).toBe('questionnaire');
    expect(vendorFlow('QUESTIONNAIRE_SUBMITTED').currentStage).toBe('submitted');
    expect(vendorFlow('UNDER_AUDIT').currentStage).toBe('audit');
    // Any terminal classification lands on "classified".
    expect(vendorFlow('APPROVED_PREFERRED').currentStage).toBe('classified');
    expect(vendorFlow('NOT_APPROVED').currentStage).toBe('classified');
    expect(supplierFlow('APPROVED').currentStage).toBe('classified');
  });

  it('kickoff: derives from status + counts, completed wins', () => {
    expect(kickoffFlow({ status: 'DRAFT', attendeeCount: 0, actionItemCount: 0 }).currentStage).toBe('created');
    expect(kickoffFlow({ status: 'DRAFT', attendeeCount: 3, actionItemCount: 0 }).currentStage).toBe('attendees');
    expect(kickoffFlow({ status: 'DRAFT', attendeeCount: 3, actionItemCount: 2 }).currentStage).toBe('actions');
    // Completed status overrides the counts.
    expect(kickoffFlow({ status: 'COMPLETED', attendeeCount: 0, actionItemCount: 0 }).currentStage).toBe('completed');
  });
});
