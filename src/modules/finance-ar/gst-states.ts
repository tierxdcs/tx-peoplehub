/**
 * GST state codes — the statutory two-digit codes GSTN assigns to every state
 * and union territory. A tax invoice's "Place of Supply" is this pair (name +
 * code); the code is what reaches the IRP in the e-invoice payload
 * (ArService.buildGstPayload → `placeOfSupply`), so a wrong or unpaired code is
 * an IRP rejection, not a cosmetic error.
 *
 * Deliberately omitted:
 *  - 25 (Daman and Diu) and 28 (undivided Andhra Pradesh) — both retired, 25
 *    merged into 26 in 2020 and 28 bifurcated into 36/37. Offering them would
 *    let a preparer pick a code the portal refuses.
 *  - 99 (Centre Jurisdiction) — not a place of supply for a B2B sale.
 * 97 (Other Territory) is kept: it is the correct code for supplies into
 * territorial waters.
 *
 * MIRRORED in `web/app/lib/gst-states.ts` for the place-of-supply dropdown.
 * The two lists must stay in step; there is no shared module between the Nest
 * and Next builds, and this table changes only when Parliament redraws a state.
 */
export interface GstState {
  /** Two-digit GSTN state code, zero-padded. */
  readonly code: string;
  /** GSTN's own spelling — this is what prints on the tax invoice. */
  readonly name: string;
}

/** Alphabetical by name, so the dropdown that mirrors this needs no re-sort. */
export const GST_STATES: readonly GstState[] = [
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
 * Karnataka — every Phaze unit is here (see core/documents/letterhead.ts), so a
 * supply to this state is intra-state (CGST + SGST) and anywhere else is
 * inter-state (IGST). Same home state the bid path uses (bids.service.ts).
 */
export const COMPANY_GST_STATE_CODE = '29';

export function gstStateByCode(code: string): GstState | undefined {
  return GST_STATES.find((s) => s.code === code.trim());
}

/**
 * True when `code` is the company's own state, i.e. CGST + SGST applies rather
 * than IGST.
 */
export function isIntraStateSupply(code: string): boolean {
  return code.trim() === COMPANY_GST_STATE_CODE;
}

/**
 * The canonical (name, code) pair for a place of supply, or null when the code
 * is unknown or the name does not belong to it. Matching is case- and
 * whitespace-insensitive on the name because callers type it; the code must be
 * exact, since that is the field the IRP validates.
 */
export function resolvePlaceOfSupply(
  name: string,
  code: string,
): GstState | null {
  const state = gstStateByCode(code);
  if (!state) return null;
  return state.name.toLowerCase() === name.trim().toLowerCase() ? state : null;
}
