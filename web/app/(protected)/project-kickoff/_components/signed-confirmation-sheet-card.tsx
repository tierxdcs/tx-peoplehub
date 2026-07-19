'use client';

import { useCallback, useEffect, useState } from 'react';
import { FileCheck2 } from 'lucide-react';
import { ApiError } from '../../../lib/api';
import {
  getKickoffConfirmationSheet,
  type KickoffConfirmationSheet,
} from '../../../lib/project-kickoff';
import { Card, CardContent, CardHeader, CardTitle } from '../../../components/ui/card';
import { Button } from '../../../components/ui/button';
import { useToast } from '../../../components/ui/toaster';

/**
 * Surfaces the linked Order's EXECUTED Order Confirmation Sheet at the top of
 * the kickoff detail page, so attendees can open the real customer-signed
 * document during the meeting without navigating away. Fetches on mount (the
 * download URL is a short-lived presigned R2 link, so it's re-requested per
 * view rather than cached in the kickoff detail payload).
 */
export function SignedConfirmationSheetCard({ kickoffId }: { kickoffId: string }) {
  const toast = useToast();
  const [sheet, setSheet] = useState<KickoffConfirmationSheet | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setSheet(await getKickoffConfirmationSheet(kickoffId));
    } catch {
      // Non-fatal — the card just won't render its contents.
      setSheet(null);
    } finally {
      setLoading(false);
    }
  }, [kickoffId]);

  useEffect(() => {
    void load();
  }, [load]);

  /**
   * Re-presign on click so the opened URL is always fresh (a URL fetched on
   * mount may have expired by the time the meeting reaches this point).
   */
  async function viewSigned() {
    try {
      const fresh = await getKickoffConfirmationSheet(kickoffId);
      if (fresh?.downloadUrl) {
        window.open(fresh.downloadUrl, '_blank', 'noopener,noreferrer');
      } else {
        toast.error('No signed document is available for this order.');
      }
    } catch (err) {
      toast.error(
        err instanceof ApiError ? err.message : 'Failed to open signed document',
      );
    }
  }

  // While loading, or if the order somehow has no executed sheet, render
  // nothing — the page shows the true current state, not a stale placeholder.
  if (loading || !sheet) return null;

  const executed = sheet.executedAt
    ? new Date(sheet.executedAt).toLocaleDateString()
    : '—';

  return (
    <Card className="mb-4 border-primary/30">
      <CardHeader className="flex-row items-center justify-between space-y-0">
        <CardTitle className="flex items-center gap-2 text-base">
          <FileCheck2 className="size-4 text-primary" />
          Signed Order Confirmation Sheet
        </CardTitle>
        <Button
          size="sm"
          onClick={viewSigned}
          disabled={!sheet.hasSignedCopy}
        >
          View Signed Document
        </Button>
      </CardHeader>
      <CardContent className="flex flex-wrap gap-x-8 gap-y-1 pt-0 text-sm">
        <div>
          <span className="text-muted-foreground">Confirmation no. </span>
          <span className="font-medium">{sheet.confirmationNumber}</span>
        </div>
        <div>
          <span className="text-muted-foreground">Executed </span>
          <span className="font-medium">{executed}</span>
        </div>
        {!sheet.hasSignedCopy && (
          <div className="text-muted-foreground">
            (Executed by countersignature — no scanned copy on file.)
          </div>
        )}
      </CardContent>
    </Card>
  );
}
