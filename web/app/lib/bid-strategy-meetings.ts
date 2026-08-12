'use client';

import { apiFetch } from './api';

export type StrategyMeetingMode = 'VIRTUAL' | 'IN_PERSON' | 'HYBRID';
export type StrategyActionStatus = 'OPEN' | 'DONE';

export interface BidStrategyMeeting {
  id: string;
  bidId: string;
  meetingDate: string;
  meetingMode: StrategyMeetingMode;
  meetingLink: string | null;
  notes: string;
  createdByName: string;
  createdAt: string;
  attendees: Array<{
    id: string;
    employeeId: string | null;
    externalName: string | null;
    displayName: string;
    email: string | null;
    isInternal: boolean;
  }>;
  actionItems: Array<{
    id: string;
    description: string;
    ownerId: string;
    ownerName: string;
    dueDate: string | null;
    status: StrategyActionStatus;
  }>;
}

export interface CreateBidStrategyMeetingInput {
  meetingDate: string;
  meetingMode: StrategyMeetingMode;
  meetingLink?: string;
  notes: string;
  attendees: Array<{ employeeId?: string; externalName?: string }>;
  actionItems: Array<{ description: string; ownerId: string; dueDate?: string }>;
}

export const listBidStrategyMeetings = (bidId: string) =>
  apiFetch<BidStrategyMeeting[]>(`/bids/${bidId}/strategy-meetings`);

export const listStrategyEmployeeOptions = (bidId: string) =>
  apiFetch<Array<{ id: string; firstName: string; lastName: string; employeeId: string }>>(
    `/bids/${bidId}/strategy-meetings/employee-options`,
  );

export const createBidStrategyMeeting = (
  bidId: string,
  input: CreateBidStrategyMeetingInput,
) =>
  apiFetch<BidStrategyMeeting>(`/bids/${bidId}/strategy-meetings`, {
    method: 'POST',
    body: JSON.stringify(input),
  });

export const updateStrategyActionStatus = (
  bidId: string,
  actionItemId: string,
  status: StrategyActionStatus,
) =>
  apiFetch(`/bids/${bidId}/strategy-meetings/action-items/${actionItemId}/status`, {
    method: 'PATCH',
    body: JSON.stringify({ status }),
  });
