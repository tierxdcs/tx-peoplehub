/**
 * Central UI-label map for the Tally-style Finance presentation layer.
 *
 * This is the SINGLE place terminology is aligned to Tally so an accountant
 * sees familiar words. It is PURELY a display concern — it renames nothing in
 * the database, API routes, DTOs, or Prisma models (those keep their PhazeOne
 * names, e.g. `SalesInvoice`, `/finance/ar/invoices`). Renaming those would be
 * churn with no user benefit and would break the Dispatch → draft-invoice
 * integration, so it is deliberately avoided.
 *
 * Consumers: the finance section of `nav.ts` and each finance page's
 * `<PageHeader title>`. Add a new entry here (never a hardcoded string in a
 * page) when a finance label needs to change.
 */

/** Tally-facing labels for the primary finance nav items / page titles. */
export const FINANCE_LABELS = {
  dayBook: 'Day Book',
  salesVoucher: 'Sales Vouchers',
  purchaseVoucher: 'Purchase Vouchers',
  receiptVoucher: 'Receipt Vouchers',
  paymentVoucher: 'Payment Vouchers',
  journalVoucher: 'Journal Vouchers',
  contraVoucher: 'Contra Vouchers',
  ledgers: 'Ledgers',
  customers: 'Customers',
  vendors: 'Vendors',
  // Reports
  trialBalance: 'Trial Balance',
  profitAndLoss: 'Profit & Loss',
  balanceSheet: 'Balance Sheet',
  outstandingReceivable: 'Outstanding (Receivable)',
  outstandingPayable: 'Outstanding (Payable)',
  gstReports: 'GST Reports',
  paymentCalendar: 'Payment Calendar',
  statutoryFilings: 'Statutory Filings',
  periodClose: 'Period Close',
} as const;

/** The five Day-Book voucher categories, with their display labels. */
export const DAYBOOK_VOUCHER_TYPES = [
  { value: 'SALES', label: 'Sales' },
  { value: 'PURCHASE', label: 'Purchase' },
  { value: 'RECEIPT', label: 'Receipt' },
  { value: 'PAYMENT', label: 'Payment' },
  { value: 'JOURNAL', label: 'Journal' },
] as const;

export type DaybookVoucherType = (typeof DAYBOOK_VOUCHER_TYPES)[number]['value'];

const VOUCHER_TYPE_LABEL: Record<string, string> = Object.fromEntries(
  DAYBOOK_VOUCHER_TYPES.map((t) => [t.value, t.label]),
);

/** Human label for a Day-Book voucher-type code (falls back to the code). */
export function voucherTypeLabel(value: string): string {
  return VOUCHER_TYPE_LABEL[value] ?? value;
}
