'use client';

import { useState } from 'react';
import { apiFetch, ApiError } from '../../lib/api';
import { useAuth } from '../../lib/auth-context';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '../ui/dialog';
import { Field } from '../ui/field';
import { Input } from '../ui/input';
import { Button } from '../ui/button';
import { useToast } from '../ui/toaster';

/**
 * Self-service password change for the logged-in user. Verifies the current
 * password server-side, requires the new one twice (typo guard), and enforces
 * the same 8-char minimum the backend does.
 *
 * `forced` mode is used when an admin force-reset set mustChangePassword: the
 * dialog can't be dismissed, and the copy tells the user why. Either way, the
 * server returns a fresh access token (tokenVersion bumped, flag cleared) that
 * we adopt so the current session keeps working and the forced-change gate lifts.
 */
export function ResetPasswordDialog({
  onClose,
  forced = false,
}: {
  onClose: () => void;
  forced?: boolean;
}) {
  const toast = useToast();
  const { applyAccessToken } = useAuth();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (next.length < 8) {
      setError('New password must be at least 8 characters.');
      return;
    }
    if (next !== confirm) {
      setError('New password and confirmation do not match.');
      return;
    }
    setSubmitting(true);
    try {
      const res = await apiFetch<{ accessToken?: string }>(
        '/auth/change-password',
        {
          method: 'POST',
          body: JSON.stringify({
            currentPassword: current,
            newPassword: next,
          }),
        },
      );
      // Adopt the freshly-issued token (clears mustChangePassword, applies the
      // new tokenVersion so our own session survives while others are killed).
      if (res?.accessToken) applyAccessToken(res.accessToken);
      toast.success('Password changed.');
      onClose();
    } catch (err) {
      setError(
        err instanceof ApiError ? err.message : 'Failed to change password',
      );
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog
      open
      // In forced mode the dialog can't be dismissed — the user must change
      // their password to proceed (the backend blocks everything else anyway).
      onOpenChange={(o) => !o && !submitting && !forced && onClose()}
    >
      <DialogContent
        {...(forced
          ? {
              onEscapeKeyDown: (e: Event) => e.preventDefault(),
              onPointerDownOutside: (e: Event) => e.preventDefault(),
              onInteractOutside: (e: Event) => e.preventDefault(),
            }
          : {})}
      >
        <DialogHeader>
          <DialogTitle>
            {forced ? 'Set a new password' : 'Reset password'}
          </DialogTitle>
          <DialogDescription>
            {forced
              ? 'An administrator reset your password. Enter the temporary password you were given and choose a new one to continue.'
              : 'Enter your current password and choose a new one.'}
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <Field label="Current password" htmlFor="currentPassword" required>
            <Input
              id="currentPassword"
              type="password"
              autoComplete="current-password"
              value={current}
              onChange={(e) => setCurrent(e.target.value)}
              required
            />
          </Field>
          <Field label="New password" htmlFor="newPassword" required>
            <Input
              id="newPassword"
              type="password"
              autoComplete="new-password"
              minLength={8}
              value={next}
              onChange={(e) => setNext(e.target.value)}
              required
            />
          </Field>
          <Field
            label="Confirm new password"
            htmlFor="confirmPassword"
            required
            error={
              confirm.length > 0 && confirm !== next
                ? 'Passwords do not match'
                : undefined
            }
          >
            <Input
              id="confirmPassword"
              type="password"
              autoComplete="new-password"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              aria-invalid={confirm.length > 0 && confirm !== next}
              required
            />
          </Field>

          {error && <p className="text-sm text-destructive">{error}</p>}

          <DialogFooter>
            {!forced && (
              <Button
                type="button"
                variant="outline"
                onClick={onClose}
                disabled={submitting}
              >
                Cancel
              </Button>
            )}
            <Button
              type="submit"
              disabled={submitting || !current || !next || !confirm}
            >
              {submitting ? 'Changing…' : 'Change password'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
