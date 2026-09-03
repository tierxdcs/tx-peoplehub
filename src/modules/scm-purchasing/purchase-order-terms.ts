/**
 * The standard terms and conditions printed as an annexure page on every
 * Purchase Order. The PO's opening line already tells the party to supply
 * "in accordance with the terms and conditions of this purchase order" — this
 * is what that sentence refers to.
 *
 * ── This is the canonical copy. Keep it byte-identical to the web twin ──
 * web/app/lib/purchase-order-terms.ts
 * The two halves of the app are deployed separately and share no bundle, so the
 * text is duplicated exactly as LETTERHEAD/COMPANY and amountToIndianWords
 * already are. Unlike a layout drift, a clause that differs between the emailed
 * PDF and the downloaded one is a contractual problem, so
 * purchase-order-terms.spec.ts reads the web file and fails if they diverge.
 * Edit both, or the suite breaks.
 */

export interface PurchaseOrderTermsClause {
  /** Bold lead-in, e.g. "Liquidated Damages (LD)". */
  label: string;
  /** The clause itself. Plain text; the renderers escape it. */
  text: string;
}

/**
 * Subject line for the annexure. Stated on the page because these terms are
 * written for fabricated hardware, and a party should be able to see the scope
 * they were drafted against.
 */
export const PURCHASE_ORDER_TERMS: PurchaseOrderTermsClause[] = [
  {
    label: 'Scope',
    text: 'Supply shall be strictly as per approved PO, drawings, BOM, specifications and agreed quality requirements.',
  },
  {
    label: 'Material & Quality',
    text: 'Supplier shall use only approved materials, components and makes. Any substitution or deviation requires prior written approval from the Buyer.',
  },
  {
    label: 'Drawing Approval',
    text: 'Supplier shall verify all drawings/BOMs before starting production. No fabrication shall commence on outdated or unapproved revisions.',
  },
  {
    label: 'Inspection & Testing',
    text: "Buyer reserves the right to inspect the material at the Supplier's premises. For PDUs, applicable FAT/testing reports shall be provided before dispatch.",
  },
  {
    label: 'Delivery',
    text: 'Delivery shall be made strictly as per the PO committed date. Supplier shall immediately notify any anticipated delay with a recovery plan.',
  },
  {
    label: 'Liquidated Damages (LD)',
    text: 'Delay attributable to the Supplier shall attract 0.5% of the value of the delayed material per week or part thereof, subject to a maximum of 5% of the total PO value.',
  },
  {
    label: 'Rejection / Rework',
    text: 'Non-conforming or defective material shall be repaired, reworked or replaced by the Supplier at its own cost, including applicable transportation costs.',
  },
  {
    label: 'Warranty',
    text: 'Minimum 12 months from commissioning or 18 months from dispatch, whichever is later, against manufacturing defects and workmanship issues.',
  },
  {
    label: 'Price',
    text: 'PO prices shall be firm and fixed and shall include all agreed fabrication, labour, consumables, packing and other applicable costs unless specifically stated otherwise.',
  },
  {
    label: 'Delivery & Packing',
    text: "Supplier shall ensure proper packing and protection against damage, moisture and transit-related issues. Any damage due to inadequate packing shall be the Supplier's responsibility.",
  },
  {
    label: 'Risk Purchase',
    text: "In case of continued delay or failure to supply/rectify defects, Buyer reserves the right to procure from an alternate supplier at the Supplier's risk and cost.",
  },
  {
    label: 'Cancellation',
    text: 'Buyer reserves the right to cancel the PO, fully or partially, in case of significant delay, repeated quality failures or material breach of agreed terms.',
  },
  {
    label: 'Documentation',
    text: 'Supplier shall provide required test reports, material certificates, inspection reports, warranty certificates, packing list and other agreed documents along with the supply.',
  },
  {
    label: 'Confidentiality',
    text: 'All Buyer drawings, designs, BOMs and technical information shall remain confidential and shall not be reproduced or shared without written approval.',
  },
  {
    label: 'Compliance',
    text: 'Supplier shall comply with all applicable Indian statutory, safety, quality and applicable BIS/IEC requirements relevant to the supplied product.',
  },
  {
    label: 'PO Changes',
    text: 'Any change in quantity, price, specification or delivery schedule shall be valid only with written approval from the Buyer.',
  },
];
