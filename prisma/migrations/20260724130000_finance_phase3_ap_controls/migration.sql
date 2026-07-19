-- Finance-grade integrity checks kept at the database boundary as a second
-- line of defence behind DTO and service validation.
ALTER TABLE "accounts_payable_invoices"
  ADD CONSTRAINT "ap_invoice_exactly_one_party_check" CHECK (
    ("partyType" = 'SUPPLIER' AND "supplierId" IS NOT NULL AND "vendorId" IS NULL)
    OR ("partyType" = 'VENDOR' AND "vendorId" IS NOT NULL AND "supplierId" IS NULL)
  ),
  ADD CONSTRAINT "ap_invoice_amounts_nonnegative_check" CHECK (
    "taxableAmount" >= 0 AND "inputCgstAmount" >= 0 AND
    "inputSgstAmount" >= 0 AND "inputIgstAmount" >= 0 AND
    "otherCharges" >= 0 AND "tdsAmount" >= 0 AND
    "totalAmount" >= 0 AND "paidAmount" >= 0 AND "outstandingAmount" >= 0
  );

ALTER TABLE "accounts_payable_invoice_lines"
  ADD CONSTRAINT "ap_invoice_line_values_check" CHECK (
    "quantity" > 0 AND "unitPrice" >= 0 AND "taxableAmount" >= 0 AND
    "taxAmount" >= 0 AND "lineTotal" >= 0
  );

ALTER TABLE "accounts_payable_payments"
  ADD CONSTRAINT "ap_payment_exactly_one_party_check" CHECK (
    ("partyType" = 'SUPPLIER' AND "supplierId" IS NOT NULL AND "vendorId" IS NULL)
    OR ("partyType" = 'VENDOR' AND "vendorId" IS NOT NULL AND "supplierId" IS NULL)
  ),
  ADD CONSTRAINT "ap_payment_amount_positive_check" CHECK ("amount" > 0);

ALTER TABLE "ap_payment_allocations"
  ADD CONSTRAINT "ap_payment_allocation_amount_positive_check" CHECK ("amount" > 0);
