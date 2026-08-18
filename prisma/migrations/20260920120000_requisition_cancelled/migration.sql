-- Requesters can cancel their own still-pending requisition (e.g. to correct a
-- mistake and raise a fresh one). Add the terminal CANCELLED state.
ALTER TYPE "CandidateRequisitionStatus" ADD VALUE 'CANCELLED';
