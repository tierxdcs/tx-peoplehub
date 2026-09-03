/**
 * GST state codes for the place-of-supply picker, plus the intra/inter-state
 * rate split that follows from the chosen state.
 *
 * MIRRORS `src/modules/finance-ar/gst-states.ts`, which is the canonical copy
 * and the one the server validates against — the two builds share no module, so
 * the tables are duplicated on purpose. See that file for why codes 25, 28 and
 * 99 are absent and 97 is present.
 */
export interface GstState {
  /** Two-digit GSTN state code, zero-padded. */
  code: string;
  /** GSTN's own spelling — this is what prints on the tax invoice. */
  name: string;
}

/** Alphabetical by name; the dropdown renders this order as-is. */
export const GST_STATES: GstState[] = [
  { code: '35', name: 'Andaman and Nicobar Islands' },
  { code: '37', name: 'Andhra Pradesh' },
  { code: '12', name: 'Arunachal Pradesh' },
  { code: '18', name: 'Assam' },
  { code: '10', name: 'Bihar' },
  { code: '04', name: 'Chandigarh' },
  { code: '22', name: 'Chhattisgarh' },
  { code: '26', name: 'Dadra and Nagar Haveli and Daman and Diu' },
  { code: '07', name: 'Delhi' },
  { code: '30', name: 'Goa' },
  { code: '24', name: 'Gujarat' },
  { code: '06', name: 'Haryana' },
  { code: '02', name: 'Himachal Pradesh' },
  { code: '01', name: 'Jammu and Kashmir' },
  { code: '20', name: 'Jharkhand' },
  { code: '29', name: 'Karnataka' },
  { code: '32', name: 'Kerala' },
  { code: '38', name: 'Ladakh' },
  { code: '31', name: 'Lakshadweep' },
  { code: '23', name: 'Madhya Pradesh' },
  { code: '27', name: 'Maharashtra' },
  { code: '14', name: 'Manipur' },
  { code: '17', name: 'Meghalaya' },
  { code: '15', name: 'Mizoram' },
  { code: '13', name: 'Nagaland' },
  { code: '21', name: 'Odisha' },
  { code: '97', name: 'Other Territory' },
  { code: '34', name: 'Puducherry' },
  { code: '03', name: 'Punjab' },
  { code: '08', name: 'Rajasthan' },
  { code: '11', name: 'Sikkim' },
  { code: '33', name: 'Tamil Nadu' },
  { code: '36', name: 'Telangana' },
  { code: '16', name: 'Tripura' },
  { code: '09', name: 'Uttar Pradesh' },
  { code: '05', name: 'Uttarakhand' },
  { code: '19', name: 'West Bengal' },
];

/**
 * Karnataka — every Phaze unit is here, so this state is the intra/inter-state
 * boundary: supply to Karnataka is CGST + SGST, anywhere else is IGST.
 */
export const COMPANY_GST_STATE_CODE = '29';

/** The standard GST slab, and the default a new voucher opens with. */
export const DEFAULT_GST_RATE = 18;

export function gstStateByCode(code: string): GstState | undefined {
  return GST_STATES.find((s) => s.code === code);
}

/**
 * The state a GSTIN is registered in: the first two digits ARE the statutory
 * state code (33GSPTN0000A1Z5 is Tamil Nadu). Null when there is no GSTIN on
 * record or the prefix is not a state — an unregistered party is a real case, and
 * guessing a state for one would put the wrong tax on the document.
 *
 * The server's copy of this lives in `src/modules/scm-purchasing/
 * purchase-order-gst.ts`, which is what actually validates a purchase order.
 */
export function gstStateCodeFromGstin(
  gstin: string | null | undefined,
): string | null {
  const prefix = gstin?.trim().slice(0, 2) ?? '';
  return prefix.length === 2 && gstStateByCode(prefix) ? prefix : null;
}

export function gstStateByName(name: string): GstState | undefined {
  return GST_STATES.find(
    (s) => s.name.toLowerCase() === name.trim().toLowerCase(),
  );
}

export function isIntraStateSupply(code: string): boolean {
  return code === COMPANY_GST_STATE_CODE;
}

export interface GstRateSplit {
  igstRate: number;
  cgstRate: number;
  sgstRate: number;
}

/**
 * Split a total GST rate the way the place of supply requires: intra-state
 * halves it into CGST + SGST, inter-state puts all of it on IGST. Taking a
 * *total* rather than a fixed 18 means a preparer who has chosen a 5%, 12% or
 * 28% slab keeps that slab when the state changes — only the split moves.
 */
export function splitGstRate(
  totalRate: number,
  placeOfSupplyStateCode: string,
): GstRateSplit {
  const total = Number.isFinite(totalRate) ? Math.max(totalRate, 0) : 0;
  if (!isIntraStateSupply(placeOfSupplyStateCode))
    return { igstRate: total, cgstRate: 0, sgstRate: 0 };
  // Round the half so an odd slab (5% → 2.5) stays a clean two-decimal rate
  // rather than a binary-fraction tail.
  const half = Math.round((total / 2) * 100) / 100;
  return { igstRate: 0, cgstRate: half, sgstRate: half };
}

/**
 * Why the entered split contradicts the place of supply, or null when it is
 * consistent. A soft warning only: the preparer may still save, because a
 * handful of supplies (SEZ, exports) are IGST-liable even within the state.
 */
export function gstSplitWarning(
  placeOfSupplyStateCode: string,
  { igstRate, cgstRate, sgstRate }: GstRateSplit,
): string | null {
  const intra = isIntraStateSupply(placeOfSupplyStateCode);
  const stateName =
    gstStateByCode(placeOfSupplyStateCode)?.name ?? 'this state';
  if (igstRate > 0 && (cgstRate > 0 || sgstRate > 0))
    return 'IGST is combined with CGST/SGST on this invoice. A supply is either inter-state (IGST alone) or intra-state (CGST + SGST) — using both is usually a GST filing error.';
  if (intra && igstRate > 0)
    return `The place of supply is ${stateName}, the company's own state, so this is an intra-state supply and should carry CGST + SGST rather than IGST.`;
  if (!intra && (cgstRate > 0 || sgstRate > 0))
    return `The place of supply is ${stateName}, outside the company's state, so this is an inter-state supply and should carry IGST rather than CGST + SGST.`;
  if (cgstRate !== sgstRate)
    return 'CGST and SGST are always equal halves of the same rate.';
  return null;
}
