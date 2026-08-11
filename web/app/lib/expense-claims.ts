'use client';

import { apiFetch } from './api';

/**
 * Employee Expense Claims client. Every employee raises a claim for themselves;
 * the Accounts Head (or a Super Admin) approves/rejects/pays. Each line carries
 * a mandatory receipt uploaded via the two-step presigned-PUT flow. Mirrors the
 * per-domain lib convention (typed apiFetch wrappers + interfaces).
 */

export type ExpenseClaimStatus =
  | 'DRAFT'
  | 'SUBMITTED'
  | 'APPROVED'
  | 'REJECTED'
  | 'PAID';

export const EXPENSE_CLAIM_STATUS_LABEL: Record<ExpenseClaimStatus, string> = {
  DRAFT: 'Draft',
  SUBMITTED: 'Submitted',
  APPROVED: 'Approved',
  REJECTED: 'Rejected',
  PAID: 'Paid',
};

export interface ExpenseCategory {
  id: string;
  name: string;
  defaultExpenseLedgerId: string;
  ledgerCode: string;
  ledgerName: string;
  isActive: boolean;
}

export interface ExpenseLedgerOption {
  id: string;
  code: string;
  name: string;
}

export interface ExpenseClaimLine {
  id: string;
  expenseDate: string;
  categoryId: string;
  categoryName: string;
  description: string;
  amount: number;
  receiptId: string;
  receiptFilename: string;
}

export interface ExpenseClaim {
  id: string;
  claimNumber: string;
  employeeId: string;
  employeeName: string | null;
  title: string;
  status: ExpenseClaimStatus;
  totalAmount: number;
  submittedAt: string | null;
  approvedById: string | null;
  approvedByName: string | null;
  approvedAt: string | null;
  rejectedByName: string | null;
  rejectedAt: string | null;
  rejectionComment: string | null;
  paidByName: string | null;
  paidAt: string | null;
  approvalJournalId: string | null;
  paymentJournalId: string | null;
  lines: ExpenseClaimLine[];
  createdAt: string;
}

export interface ReceiptUploadTicket {
  receiptId: string;
  uploadUrl: string;
  expiresInSeconds: number;
}

export interface AddLineInput {
  expenseDate: string;
  categoryId: string;
  description: string;
  amount: number;
  receiptId: string;
}

// ── Categories ────────────────────────────────────────────────────────────

/** Active categories for the claim line picker (any employee). */
export function listActiveCategories() {
  return apiFetch<ExpenseCategory[]>('/expense-claims/categories');
}

/** All categories (admin management). */
export function listCategories() {
  return apiFetch<ExpenseCategory[]>('/expense-categories');
}

/** Expense-type ledgers a category may map to (admin picker). */
export function listExpenseLedgers() {
  return apiFetch<ExpenseLedgerOption[]>('/expense-categories/ledgers');
}

export function createCategory(input: {
  name: string;
  defaultExpenseLedgerId: string;
}) {
  return apiFetch<ExpenseCategory>('/expense-categories', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export function updateCategory(
  id: string,
  input: { name?: string; defaultExpenseLedgerId?: string; isActive?: boolean },
) {
  return apiFetch<ExpenseCategory>(`/expense-categories/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(input),
  });
}

// ── Receipts (two-step upload) ──────────────────────────────────────────────

export function createReceiptUploadUrl(input: {
  filename: string;
  contentType: string;
  sizeBytes: number;
}) {
  return apiFetch<ReceiptUploadTicket>('/expense-claims/receipts/upload-url', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export function confirmReceipt(receiptId: string) {
  return apiFetch<{ id: string; status: string }>(
    `/expense-claims/receipts/${receiptId}/confirm`,
    { method: 'POST', body: JSON.stringify({}) },
  );
}

export function receiptDownloadUrl(receiptId: string) {
  return apiFetch<{ url: string; expiresInSeconds: number }>(
    `/expense-claims/receipts/${receiptId}/download-url`,
  );
}

// ── Claims ──────────────────────────────────────────────────────────────────

export function listMyClaims() {
  return apiFetch<ExpenseClaim[]>('/expense-claims/mine');
}

export function listReviewClaims() {
  return apiFetch<ExpenseClaim[]>('/expense-claims/review');
}

export function getClaim(id: string) {
  return apiFetch<ExpenseClaim>(`/expense-claims/${id}`);
}

export function createClaim(input: { title: string }) {
  return apiFetch<ExpenseClaim>('/expense-claims', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export function updateClaim(id: string, input: { title: string }) {
  return apiFetch<ExpenseClaim>(`/expense-claims/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(input),
  });
}

export function addClaimLine(id: string, input: AddLineInput) {
  return apiFetch<ExpenseClaim>(`/expense-claims/${id}/lines`, {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export function removeClaimLine(id: string, lineId: string) {
  return apiFetch<ExpenseClaim>(`/expense-claims/${id}/lines/${lineId}`, {
    method: 'DELETE',
  });
}

export function submitClaim(id: string) {
  return apiFetch<ExpenseClaim>(`/expense-claims/${id}/submit`, {
    method: 'POST',
    body: JSON.stringify({}),
  });
}

export function approveClaim(id: string) {
  return apiFetch<ExpenseClaim>(`/expense-claims/${id}/approve`, {
    method: 'POST',
    body: JSON.stringify({}),
  });
}

export function rejectClaim(id: string, comment: string) {
  return apiFetch<ExpenseClaim>(`/expense-claims/${id}/reject`, {
    method: 'POST',
    body: JSON.stringify({ comment }),
  });
}

export function payClaim(id: string) {
  return apiFetch<ExpenseClaim>(`/expense-claims/${id}/pay`, {
    method: 'POST',
    body: JSON.stringify({}),
  });
}
