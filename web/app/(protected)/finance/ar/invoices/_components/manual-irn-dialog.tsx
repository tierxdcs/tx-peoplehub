'use client';

import { ChangeEvent, FormEvent, useEffect, useState } from 'react';
import { Upload } from 'lucide-react';
import { apiFetch, ApiError } from '../../../../../lib/api';
import { Button } from '../../../../../components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../../../../../components/ui/dialog';
import { Input } from '../../../../../components/ui/input';
import { Label } from '../../../../../components/ui/label';
import { Textarea } from '../../../../../components/ui/textarea';
import { useToast } from '../../../../../components/ui/toaster';

export function ManualIrnDialog({
  invoiceId,
  open,
  onOpenChange,
  onSaved,
}: {
  invoiceId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved: () => Promise<void> | void;
}) {
  const toast = useToast();
  const [irn, setIrn] = useState('');
  const [acknowledgementNumber, setAcknowledgementNumber] = useState('');
  const [acknowledgementDate, setAcknowledgementDate] = useState('');
  const [signedQrCode, setSignedQrCode] = useState('');
  const [qrFileName, setQrFileName] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setIrn('');
    setAcknowledgementNumber('');
    setAcknowledgementDate('');
    setSignedQrCode('');
    setQrFileName('');
  }, [open]);

  function readQrImage(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      toast.error('Choose a QR code image file');
      return;
    }
    if (file.size > 256 * 1024) {
      toast.error('QR code image must be 256 KB or smaller');
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      setSignedQrCode(String(reader.result ?? ''));
      setQrFileName(file.name);
    };
    reader.onerror = () => toast.error('Could not read the QR code image');
    reader.readAsDataURL(file);
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (irn.length !== 64) {
      toast.error('IRN must be exactly 64 characters');
      return;
    }
    setSaving(true);
    try {
      await apiFetch(`/finance/ar/invoices/${invoiceId}/manual-irn`, {
        method: 'POST',
        body: JSON.stringify({
          irn,
          acknowledgementNumber,
          acknowledgementDate: new Date(acknowledgementDate).toISOString(),
          signedQrCode,
        }),
      });
      toast.success('IRN recorded and e-invoice marked as generated');
      onOpenChange(false);
      await onSaved();
    } catch (error) {
      toast.error(
        error instanceof ApiError ? error.message : 'Failed to record IRN',
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Enter IRN manually</DialogTitle>
          <DialogDescription>
            Record the values returned by the government IRP after your CA has
            registered this invoice. This issues and posts the invoice.
          </DialogDescription>
        </DialogHeader>
        <form className="space-y-4" onSubmit={submit}>
          <div className="space-y-1.5">
            <Label htmlFor={`manual-irn-${invoiceId}`}>IRN</Label>
            <Input
              id={`manual-irn-${invoiceId}`}
              maxLength={64}
              pattern="[A-Fa-f0-9]{64}"
              required
              value={irn}
              onChange={(event) => setIrn(event.target.value.trim())}
              placeholder="64-character Invoice Reference Number"
            />
            <p className="text-xs text-muted-foreground">{irn.length}/64 characters</p>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor={`manual-ack-${invoiceId}`}>Acknowledgement number</Label>
              <Input
                id={`manual-ack-${invoiceId}`}
                required
                value={acknowledgementNumber}
                onChange={(event) => setAcknowledgementNumber(event.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor={`manual-ack-date-${invoiceId}`}>Acknowledgement date</Label>
              <Input
                id={`manual-ack-date-${invoiceId}`}
                type="datetime-local"
                required
                value={acknowledgementDate}
                onChange={(event) => setAcknowledgementDate(event.target.value)}
              />
            </div>
          </div>
          <div className="space-y-2">
            <Label>Signed QR code</Label>
            <label className="flex min-h-11 cursor-pointer items-center justify-center gap-2 rounded-md border px-3 text-sm hover:bg-muted">
              <Upload className="h-4 w-4" />
              {qrFileName || 'Upload QR image'}
              <input className="sr-only" type="file" accept="image/*" onChange={readQrImage} />
            </label>
            <div className="text-center text-xs text-muted-foreground">or paste the signed QR payload</div>
            <Textarea
              required
              rows={4}
              value={signedQrCode.startsWith('data:image/') ? '' : signedQrCode}
              onChange={(event) => {
                setSignedQrCode(event.target.value);
                setQrFileName('');
              }}
              disabled={signedQrCode.startsWith('data:image/')}
              placeholder="Signed QR payload returned by IRP"
            />
            {qrFileName && (
              <Button type="button" size="sm" variant="ghost" onClick={() => { setSignedQrCode(''); setQrFileName(''); }}>
                Remove image
              </Button>
            )}
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button disabled={saving} type="submit">
              {saving ? 'Saving…' : 'Save IRN and issue invoice'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
