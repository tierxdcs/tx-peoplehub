import * as React from 'react';
import type { SignatureFont } from '../../lib/types';
import { signatureStyle } from '../../lib/signature';

/**
 * Presentational render of an internal e-signature snapshot. When `text` is
 * present it's shown in the chosen signature font with a small caption; when
 * absent it falls back to a plain "Approved by …" line. No data fetching.
 */
export function SignatureDisplay({
  text,
  font,
  approverName,
  date,
}: {
  text: string | null;
  font: SignatureFont | null;
  approverName?: string;
  date?: string | null;
}) {
  if (text) {
    return (
      <div>
        <div className="text-2xl leading-tight" style={signatureStyle(font)}>
          {text}
        </div>
        {(approverName || date) && (
          <div className="mt-1 text-xs text-muted-foreground">
            {approverName ?? ''}
            {approverName && date ? ' · ' : ''}
            {date ?? ''}
          </div>
        )}
      </div>
    );
  }

  return (
    <p className="text-sm text-muted-foreground">
      Approved by {approverName ?? '—'}
      {date ? ` on ${date}` : ''}
    </p>
  );
}
