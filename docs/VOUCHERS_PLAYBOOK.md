# Finance Vouchers Operating Playbook

**System:** Phaze ERP  
**Audience:** Accounts staff, Accounts Head, Sales/SCM stakeholders, approvers and auditors  
**Purpose:** Prepare, approve, post, review and correct finance vouchers without bypassing ledger or maker-checker controls.

## Voucher lifecycle at a glance

`Business event → Select voucher type → Enter party and details → Validate balance → Save Draft → Submit → Independent approval → Post to ledger → Review in Day Book`

A voucher is not an isolated form. Sales, Purchase, Receipt and Payment Vouchers are the Tally-style entry surfaces for the existing AR/AP subledgers. Approval posts the accounting effect through the shared journal engine.

## Roles and access

| Role | Responsibility |
|---|---|
| Accounts staff | Creates, checks, saves and submits vouchers; resolves rejection comments. |
| Accounts Head | Independently approves/posts or rejects pending vouchers. Cannot approve a voucher they created. |
| Super Admin | Can enter and view finance records, and designates the sole Accounts Head; Super Admin is not automatically the voucher approver. |
| Sales / Logistics / SCM | Supplies commercial evidence such as order, dispatch, customer invoice or vendor bill context. |
| Auditor | Reviews approved evidence and reports where an active read-only grant exists. |

Only an active Accounts-vertical employee, the designated Accounts Head or Super Admin can enter the Finance module. Only the designated Accounts Head can approve/post vouchers.

## Before using vouchers

1. Super Admin confirms one active employee is designated **Accounts Head**.
2. Accounts confirms required ledger accounts and parent groups exist under **Masters → Ledgers**.
3. Customer and vendor/supplier masters are correct.
4. GSTIN, place of supply, HSN/SAC, tax rates and bank/cash ledgers are verified.
5. The supporting invoice, dispatch, receipt, approval, bank reference or adjustment evidence is available.
6. The accounting date belongs to an open period.

Never create a voucher merely to force a report to agree. Correct the originating master or business document, or use an authorised reversal/adjustment route.

## Voucher map

| Voucher | Use it for | Numbering | Primary accounting effect |
|---|---|---|---|
| Sales Voucher | Customer invoice / accounts receivable | INV-YYYY-#### | Dr Accounts Receivable; Cr Revenue and GST payable. |
| Purchase Voucher | Vendor bill / accounts payable | BILL-YYYY-##### | Dr Expense/asset/input tax; Cr Accounts Payable. |
| Receipt Voucher | Money received from customer | RCT-YYYY-#### | Dr Bank/charges/TDS; Cr AR or Customer Advance. |
| Payment Voucher | Money paid to vendor | PAY-YYYY-##### | Dr AP or Vendor Advance; Cr Bank. |
| Journal Voucher | General balanced manual adjustment | JV-YYYY-##### | User-selected debit and credit ledgers. |
| Contra Voucher | Bank-to-cash, cash-to-bank or inter-bank transfer | CV-YYYY-##### | Dr receiving bank/cash; Cr source bank/cash. |
| Credit / Debit Note | Authorised correction to receivable/payable/tax | CN-/DN-YYYY-##### | Posts the approved adjustment and preserves original evidence. |

Voucher numbers show **Auto** during entry because the server allocates the number when the record is created.

## Shared entry and approval workflow

Every Tally-style entry screen uses the same layout:

- Voucher number and date.
- Type-specific party, allocation or ledger fields.
- Running summary and balance/readiness indicator.
- Narration.
- **Save as Draft** and **Submit for Approval**.

### Draft and validation

1. Choose the correct voucher type before entering data.
2. Enter the voucher date and mandatory fields.
3. Review the live totals and balance indicator.
4. Add a narration that explains the business event and evidence reference.
5. Select **Save as Draft** when evidence or review is incomplete.
6. Select **Submit for Approval** only when the voucher is ready and the balance/readiness gate is green.

### Maker-checker approval

1. Accounts Head opens the relevant voucher register and pending item.
2. Compare the voucher to source evidence, party master, date, amount, tax and allocation.
3. Approve when correct. Approval posts the voucher or advances its controlled issue step.
4. Reject with a specific corrective reason when incorrect.
5. Maker corrects the rejected voucher and resubmits.

Self-approval is blocked even when the maker is the Accounts Head. Another eligible maker should prepare vouchers that the Accounts Head must approve.

## 1. Sales Voucher

**Route:** Vouchers → Sales Vouchers → New Sales Voucher

Use for an AR customer invoice. A logistics dispatch may also seed a Draft invoice through the same underlying invoice record.

### Entry procedure

1. Select voucher date, customer and due date.
2. Enter each line description, HSN/SAC, quantity and unit price.
3. Select place-of-supply state and state code.
4. Apply the correct IGST or intra-state tax treatment.
5. Review subtotal, GST and total.
6. Add narration and supporting reference.
7. Save Draft or Submit for Approval.

Status flow:

`Draft → Pending Approval → GST Pending or Issued → Partially Paid → Paid`

On approval, an e-invoice-enabled GST customer may enter **GST Pending** until GST submission succeeds. Otherwise the invoice is issued and posted: Dr AR, Cr Revenue, Cr GST payable. Credit-control can block submission until the Finance Head records an authorised override.

### Sales Voucher controls

- Party, description, HSN/SAC and positive total are required.
- Verify that the invoice does not duplicate a dispatch or earlier invoice.
- The outstanding amount initially equals the invoice total.
- Do not treat Draft or Pending Approval as a customer-issued invoice.

## 2. Purchase Voucher

**Route:** Vouchers → Purchase Vouchers → New Purchase Voucher

Use for a vendor/supplier bill. The direct-entry voucher creates the same Accounts Payable Invoice used by the AP register.

### Entry procedure

1. Select voucher date and vendor/supplier.
2. Enter the vendor’s invoice number and due date.
3. Add every item/service line with description, HSN/SAC, quantity, unit price and applicable data.
4. Apply invoice-level IGST or CGST/SGST correctly.
5. Review taxable value, input GST and grand total.
6. Add narration and attach/retain source bill evidence according to policy.
7. Save Draft or Submit for Approval.

Approval posts the payable and relevant debit/tax legs. Duplicate vendor invoice numbers, incorrect tax jurisdiction and mismatched receipt/PO evidence must be resolved before approval.

## 3. Receipt Voucher

**Route:** Vouchers → Receipt Vouchers → New Receipt Voucher

Use when money is received from a customer.

### Entry procedure

1. Select customer.
2. Select an open invoice, or leave allocation blank to record an unapplied customer advance.
3. Enter amount and mandatory Bank Reference/UTR.
4. Review the invoice outstanding amount and allocation.
5. Add narration and submit.

Validation requires the allocated invoice to belong to the same customer, remain open and have enough outstanding balance. Allocations cannot exceed the receipt plus recognised TDS. Approval posts bank/charges/TDS, clears AR for allocations and credits Customer Advances for any unapplied balance. Invoice status becomes Partially Paid or Paid.

## 4. Payment Voucher

**Route:** Vouchers → Payment Vouchers → New Payment Voucher

Use when paying a vendor/supplier.

1. Select vendor/supplier.
2. Allocate to an eligible approved/open bill, or leave blank for an unallocated vendor payment.
3. Enter the payment amount and required payment information.
4. Verify vendor bank details and approval evidence outside the voucher where required.
5. Review allocation and outstanding bill balance.
6. Save Draft or Submit for Approval.

Accounts Head approval is required and self-approval is blocked. Never split or leave a payment unallocated merely to bypass an invoice mismatch.

## 5. Journal Voucher

**Route:** Vouchers → Journal Vouchers → New Journal Voucher

Use for a general accounting entry that does not belong to Sales, Purchase, Receipt, Payment or Contra.

1. Enter date and meaningful narration.
2. Add at least two ledger lines.
3. For each line, select a ledger and enter either Debit or Credit—not both.
4. Add/remove lines until total debit equals total credit.
5. Confirm the balance badge shows **Balanced**.
6. Save Draft or Submit for Approval.

Approval posts the balanced journal. Common valid cases include authorised accruals, reclassifications and corrections. Do not use a manual journal to conceal a missing customer/vendor voucher or bypass tax and subledger controls.

## 6. Contra Voucher

**Route:** Vouchers → Contra Vouchers → New Contra Voucher

Use only for transfers between bank/cash-eligible ledgers:

- Bank to cash.
- Cash to bank.
- One bank account to another.

1. Select different From and To bank/cash ledgers.
2. Enter a positive transfer amount.
3. Add narration identifying transfer evidence.
4. Save Draft or Submit for Approval.

Approval posts Dr receiving ledger and Cr source ledger. A transfer involving an expense, revenue, receivable or payable ledger belongs in another voucher type—usually a Journal Voucher—not Contra.

## 7. Credit and Debit Notes

**Route:** Vouchers → Credit & Debit Notes

Use an adjustment note when an already-recorded commercial amount must be reduced or increased with a controlled reason. Never edit the historical posted voucher to simulate the correction.

1. Select the correct note type and affected party/document.
2. Enter adjustment date, reason, amount and tax treatment.
3. Attach or retain the commercial authorisation/evidence.
4. Submit for Accounts Head approval.
5. Confirm the note posts and the affected balance changes as intended.

## 8. Day Book review

**Route:** Vouchers → Day Book

The Day Book is the read-only chronological union of Sales, Purchase, Receipt, Payment, Journal and Contra voucher records.

1. Select From and To dates.
2. Optionally filter voucher type.
3. Select Refresh.
4. Review date, type, voucher number, party/description, amount and status.
5. Open the source register/detail for investigation.

The Day Book is evidence that a voucher record exists; confirm **Posted/Issued** status and the linked journal before treating it as a completed accounting event.

## Reversal and correction rules

- Never delete or overwrite a posted voucher to correct history.
- Correct Draft or Rejected records before resubmission.
- Reject an incorrect Pending Approval voucher rather than approving and “fixing later.”
- Reverse a posted manual journal through the authorised reversal action, which creates the opposite journal and retains both records.
- Use Credit/Debit Notes or the relevant receipt/payment reversal/adjustment flow for subledger corrections.
- Never backdate into a closed accounting period.
- Preserve narration, rejection reason, approver and timestamps.

## Exception guide

| Situation | Required action |
|---|---|
| Submit button is disabled | Complete mandatory fields and resolve the readiness/balance indicator. |
| Accounts Head cannot approve | Confirm the user is the designated Accounts Head and did not create the voucher. |
| Super Admin cannot approve | Super Admin access is not Accounts Head authority; designate the correct Accounts Head. |
| Sales Voucher blocked by credit control | Review exposure and obtain the recorded Finance Head override before resubmission. |
| GST invoice remains GST Pending | Review gateway error and retry the controlled GST-send action; do not create a duplicate invoice. |
| Receipt allocation exceeds outstanding | Correct allocation or leave the excess as a valid unapplied advance. |
| Receipt invoice belongs to another customer | Select an invoice belonging to the receipt party. |
| Purchase bill appears duplicated | Stop and verify vendor invoice number, vendor and source document. |
| Journal is unbalanced | Correct debit/credit lines; an unbalanced journal cannot be submitted. |
| Contra ledger is rejected | Use only bank/cash ledgers; select Journal or the correct subledger voucher otherwise. |
| Error found after posting | Use a reversal or approved adjustment; never edit posted history. |
| Voucher missing from Day Book | Check date range, type filter, source register and posting/status. |

## Voucher approval checklist

- [ ] Correct voucher type was selected.
- [ ] Voucher date is in the correct open accounting period.
- [ ] Party and source evidence agree.
- [ ] No duplicate invoice, receipt, payment or reference exists.
- [ ] HSN/SAC, place of supply and GST treatment are correct.
- [ ] Quantities, rates, taxable value, tax and total were independently recalculated.
- [ ] Receipt/payment allocation belongs to the same party and does not exceed outstanding.
- [ ] Journal debits equal credits.
- [ ] Contra uses two different bank/cash ledgers.
- [ ] Narration identifies the business purpose and evidence.
- [ ] Maker and approver are different people.
- [ ] Approval produced the expected status and journal effect.
- [ ] Voucher appears correctly in the Day Book and relevant outstanding report.

## Month-end hand-off

1. Review Draft, Rejected and Pending Approval vouchers; resolve or document ownership.
2. Reconcile bank receipts/payments and unapplied advances.
3. Reconcile AR and AP outstanding balances to party evidence.
4. Review GST-pending invoices and adjustment notes.
5. Review unusual manual journals and contra transfers.
6. Confirm posted vouchers fall in the correct period.
7. Retain approval, reversal and supporting-document evidence for audit.

## Data handling and audit discipline

- Voucher amounts, bank references, tax IDs and party balances are confidential.
- Do not share voucher exports outside authorised Finance/audit channels.
- Use ERP records and Vault evidence rather than uncontrolled spreadsheets as the source of truth.
- Posted journals, maker/approver identity and timestamps form the accounting audit trail.
- A status label is not a substitute for verifying the ledger effect and supporting evidence.
