import { Prisma } from '@prisma/client';
import {
  COMPANY_GST_STATE_CODE,
  gstStateByCode,
  isIntraStateSupply,
} from '../finance-ar/gst-states';

/**
 * GST on a purchase order: order-level rates applied once to the summed line
 * total, the same model the Sales Voucher uses on the outward side.
 *
 * Which taxes apply is decided by the SUPPLIER's registration, not ours. Every
 * Phaze unit is in Karnataka, so a supplier registered in Karnataka is an
 * intra-state supply (CGST + SGST) and a supplier anywhere else is inter-state
 * (IGST). That is the mirror image of the sales side, where the customer's place
 * of supply decides it — see finance-ar/gst-states.ts, which owns the state table
 * and the intra/inter test both sides share.
 *
 * Pure Decimal arithmetic, no Prisma client and no Nest: the PO service and the
 * document renderer both need these numbers and must never disagree about them.
 */

/** Order-level rates as percentages, exactly as the PO row stores them. */
export interface PurchaseOrderGstRates {
  igstRate: Prisma.Decimal;
  cgstRate: Prisma.Decimal;
  sgstRate: Prisma.Decimal;
}

export interface PurchaseOrderGstBreakdown {
  /** The supplier's GST state, and its GSTN spelling for the printed order. */
  stateCode: string;
  stateName: string;
  /** True when the supplier is in the company's own state (CGST + SGST). */
  intraState: boolean;
  igstRate: Prisma.Decimal;
  cgstRate: Prisma.Decimal;
  sgstRate: Prisma.Decimal;
  igstAmount: Prisma.Decimal;
  cgstAmount: Prisma.Decimal;
  sgstAmount: Prisma.Decimal;
  /** IGST + CGST + SGST. Zero when the order carries no tax line. */
  totalTax: Prisma.Decimal;
  /** Taxable value + totalTax — what the party will invoice for. */
  grandTotal: Prisma.Decimal;
}

/**
 * The state code embedded in a GSTIN: the first two digits ARE the statutory
 * state code (33GSPTN0000A1Z5 is Tamil Nadu). Null when the party has no GSTIN
 * on record or the prefix is not a state we can bill against — an unregistered
 * supplier is a real case, and guessing a state for one would put the wrong tax
 * on the order.
 */
export function gstStateCodeFromGstin(
  gstin: string | null | undefined,
): string | null {
  const prefix = gstin?.trim().slice(0, 2) ?? '';
  return prefix.length === 2 && gstStateByCode(prefix) ? prefix : null;
}

/** A code the state table knows, falling back to the company's own state. */
export function normaliseGstStateCode(code: string | null | undefined): string {
  const trimmed = code?.trim() ?? '';
  return gstStateByCode(trimmed) ? trimmed : COMPANY_GST_STATE_CODE;
}

/**
 * Apply the rates to a taxable value. Each tax is rounded to paise on its own,
 * the way a supplier's invoice will show it, so the printed order and the
 * invoice raised against it reconcile line for line rather than off by a paisa.
 */
export function computePurchaseOrderGst(
  taxableAmount: Prisma.Decimal,
  stateCode: string,
  rates: PurchaseOrderGstRates,
): PurchaseOrderGstBreakdown {
  const code = normaliseGstStateCode(stateCode);
  const tax = (rate: Prisma.Decimal) =>
    taxableAmount.times(rate).dividedBy(100).toDecimalPlaces(2);
  const igstAmount = tax(rates.igstRate);
  const cgstAmount = tax(rates.cgstRate);
  const sgstAmount = tax(rates.sgstRate);
  const totalTax = igstAmount.plus(cgstAmount).plus(sgstAmount);
  return {
    stateCode: code,
    stateName: gstStateByCode(code)?.name ?? '',
    intraState: isIntraStateSupply(code),
    igstRate: rates.igstRate,
    cgstRate: rates.cgstRate,
    sgstRate: rates.sgstRate,
    igstAmount,
    cgstAmount,
    sgstAmount,
    totalTax,
    grandTotal: taxableAmount.plus(totalTax),
  };
}
