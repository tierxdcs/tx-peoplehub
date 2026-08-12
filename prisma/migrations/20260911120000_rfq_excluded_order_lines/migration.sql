-- AlterTable: curated order-line context for RFQs. Additive and nullable-safe —
-- existing rows default to an empty array, so every order line is shown exactly
-- as before. A non-empty set excludes those OrderLineItem ids from this RFQ's
-- read-time order context only; the Order and its line items are untouched.
ALTER TABLE "rfqs" ADD COLUMN     "excludedOrderLineIds" TEXT[] DEFAULT ARRAY[]::TEXT[];
