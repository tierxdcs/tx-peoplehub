'use client';

import { useEffect, useRef, useState } from 'react';
import { Loader2, Trash2, Upload, User } from 'lucide-react';
import { Button } from './button';
import { uploadEmployeePhoto } from '../../lib/employee-photo';
import { cn } from '../../lib/utils';

/**
 * Reusable employee-photo control. Two modes:
 *  - "draft" (onboarding): uploads the file to R2 and reports the storageKey
 *    back via onUploaded — the caller persists it when the form is submitted.
 *  - "managed" (editing an existing employee): the caller supplies an initial
 *    signed previewUrl and handles persistence (set/remove) via onUploaded /
 *    onRemove; this component only does the upload + local preview.
 *
 * It shows a live preview (from the just-picked File, or the supplied
 * previewUrl), a progress state, and inline errors so both surfaces behave
 * identically.
 */
export function EmployeePhotoField({
  previewUrl,
  onUploaded,
  onRemove,
  disabled,
  className,
}: {
  /** Existing photo URL to show initially (managed mode). */
  previewUrl?: string | null;
  /** Called with the uploaded object's storageKey once the PUT completes. */
  onUploaded: (storageKey: string) => void | Promise<void>;
  /** If provided, a Remove button appears (managed mode). */
  onRemove?: () => void | Promise<void>;
  disabled?: boolean;
  className?: string;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  // Local object-URL preview of a freshly picked file (takes precedence over
  // the server previewUrl until the page reloads with the new signed URL).
  const [localPreview, setLocalPreview] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);

  // Revoke the object URL when it changes/unmounts to avoid a memory leak.
  useEffect(() => {
    return () => {
      if (localPreview) URL.revokeObjectURL(localPreview);
    };
  }, [localPreview]);

  const shownPreview = localPreview ?? previewUrl ?? null;

  async function handlePick(file: File | undefined) {
    if (!file) return;
    setError(null);
    // Show the picked image immediately.
    const objectUrl = URL.createObjectURL(file);
    setLocalPreview((prev) => {
      if (prev) URL.revokeObjectURL(prev);
      return objectUrl;
    });
    setBusy(true);
    setProgress(0);
    try {
      const storageKey = await uploadEmployeePhoto(file, setProgress);
      await onUploaded(storageKey);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Upload failed');
      // Drop the failed preview so the UI doesn't imply success.
      setLocalPreview((prev) => {
        if (prev) URL.revokeObjectURL(prev);
        return null;
      });
    } finally {
      setBusy(false);
      // Reset the input so re-picking the same file fires onChange again.
      if (inputRef.current) inputRef.current.value = '';
    }
  }

  async function handleRemove() {
    if (!onRemove) return;
    setError(null);
    setBusy(true);
    try {
      await onRemove();
      setLocalPreview((prev) => {
        if (prev) URL.revokeObjectURL(prev);
        return null;
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to remove photo');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className={cn('flex items-center gap-4', className)}>
      <span className="flex size-20 shrink-0 items-center justify-center overflow-hidden rounded-full border bg-muted text-muted-foreground">
        {shownPreview ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={shownPreview}
            alt="Employee photo"
            className="size-full object-cover"
          />
        ) : (
          <User className="size-8" />
        )}
      </span>

      <div className="space-y-2">
        <input
          ref={inputRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={(e) => void handlePick(e.target.files?.[0])}
          disabled={disabled || busy}
        />
        <div className="flex flex-wrap items-center gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={disabled || busy}
            onClick={() => inputRef.current?.click()}
          >
            {busy ? (
              <>
                <Loader2 className="size-4 animate-spin" />
                {progress > 0 && progress < 1
                  ? `Uploading ${Math.round(progress * 100)}%`
                  : 'Uploading…'}
              </>
            ) : (
              <>
                <Upload className="size-4" />
                {shownPreview ? 'Replace photo' : 'Upload photo'}
              </>
            )}
          </Button>
          {onRemove && shownPreview && !busy && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={disabled}
              onClick={() => void handleRemove()}
            >
              <Trash2 className="size-4" /> Remove
            </Button>
          )}
        </div>
        <p className="text-xs text-muted-foreground">
          JPG or PNG, up to 10 MB. Used for ID cards and other collaterals.
        </p>
        {error && <p className="text-xs text-destructive">{error}</p>}
      </div>
    </div>
  );
}
