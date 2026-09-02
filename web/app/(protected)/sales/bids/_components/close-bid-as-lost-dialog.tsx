'use client';

import { useEffect, useState } from 'react';
import { apiFetch, ApiError } from '../../../../lib/api';
import { Bid, BidStatus } from '../../../../lib/types';
import { formatINR } from '../../../../lib/sales';
import { useNumberFormat } from '../../../../lib/number-format-context';
import { Button } from '../../../../components/ui/button';
import { Field } from '../../../../components/ui/field';
import { Textarea } from '../../../../components/ui/textarea';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../../../../components/ui/dialog';

/**
 * Statuses from which a bid can be closed as lost. Mirrors
 * CLOSEABLE_AS_LOST_STATUSES in bids.service.ts — a bid that had (or was about
 * to have) a price in front of the customer. Kept in sync deliberately so the
 * button is hidden rather than the server 400ing on click.
 */
const CLOSEABLE_AS_LOST: BidStatus[] = ['APPROVED', 'SENT', 'EXPIRED'];

export function canCloseBidAsLost(
  bid: Pick<Bid, 'status' | 'convertedOrderId'>,
) {
  return CLOSEABLE_AS_LOST.includes(bid.status) && !bid.convertedOrderId;
}

/**
 * Close a single bid as lost with a mandatory reason. Used from both the bid
 * detail page and the opportunity's bids table, since an opportunity commonly
 * carries several bids of which only one is won.
 */
export function CloseBidAsLostDialog({
  bid,
  open,
  onOpenChange,
  onClosed,
}: {
  bid: Bid;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onClosed: (updated: Bid) => void;
}) {
  const { style: numberFormatStyle } = useNumberFormat();
  const [lostReason, setLostReason] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) return;
    setLostReason('');
    setError(null);
    setSubmitting(false);
  }, [open]);

  async function submit() {
    const reason = lostReason.trim();
    if (!reason) {
      setError('A reason is required — record why this bid was lost.');
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const updated = await apiFetch<Bid>(`/bids/${bid.id}/close-as-lost`, {
        method: 'PATCH',
        body: JSON.stringify({ lostReason: reason }),
      });
      onClosed(updated);
      onOpenChange(false);
    } catch (err) {
      setError(
        err instanceof ApiError
          ? err.message
          : 'Failed to close the bid as lost',
      );
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Close {bid.bidNumber} as lost?</DialogTitle>
          <DialogDescription>
            {formatINR(bid.grandTotal, numberFormatStyle)} comes out of live
            pipeline. The bid stays on record and still counts in the win rate —
            it just stops being treated as expected revenue. This cannot be
            undone from the UI.
          </DialogDescription>
        </DialogHeader>

        <Field label="Reason" required>
          <Textarea
            value={lostReason}
            onChange={(e) => setLostReason(e.target.value)}
            placeholder="e.g. Lost to competitor on price; customer cited 12% lower quote"
            className="min-h-24"
            maxLength={1000}
          />
        </Field>

        {error && <p className="text-sm text-destructive">{error}</p>}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            variant="destructive"
            onClick={submit}
            disabled={submitting || !lostReason.trim()}
          >
            {submitting ? 'Closing…' : 'Close as Lost'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
