'use client';

import { useCallback, useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { Download, FileWarning, Lock } from 'lucide-react';
import type { PublicSharedResource } from '../../../../lib/types';
import { resolvePublicShare } from '../../../../lib/vault-api';
import { BRAND } from '../../../../lib/theme';
import { Button } from '../../../../components/ui/button';
import { Input } from '../../../../components/ui/input';
import { Field } from '../../../../components/ui/field';
import { Spinner } from '../../../../components/ui/spinner';

/**
 * Public share landing (spec §5.2) — the ONE unauthenticated Vault surface.
 * Resolves the token via the anon resolvePublicShare() helper (no session
 * bearer), and renders one of:
 *  - the resolved resource (PDF/image inline, else a download button),
 *  - a password prompt when the link is protected,
 *  - a clean "expired / revoked / not found" message.
 * Lives outside the (protected) route group so no auth layout wraps it.
 */
export default function PublicSharePage() {
  const { token } = useParams<{ token: string }>();

  const [resource, setResource] = useState<PublicSharedResource | null>(null);
  const [loading, setLoading] = useState(true);
  const [needsPassword, setNeedsPassword] = useState(false);
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const resolve = useCallback(
    async (pwd?: string) => {
      const result = await resolvePublicShare(token, pwd);
      if (result.ok) {
        setResource(result.resource);
        setNeedsPassword(false);
        setMessage(null);
        return true;
      }
      if (result.passwordRequired) {
        setNeedsPassword(true);
        // On a failed password retry the message explains why; the first
        // prompt shows no error.
        setMessage(pwd ? result.message : null);
        return false;
      }
      setNeedsPassword(false);
      setMessage(result.message);
      return false;
    },
    [token],
  );

  useEffect(() => {
    // First attempt with no password — succeeds for open links, and tells us
    // whether a password is required for protected ones.
    resolve().finally(() => setLoading(false));
  }, [resolve]);

  async function handleSubmitPassword(e: React.FormEvent) {
    e.preventDefault();
    if (!password.trim()) return;
    setSubmitting(true);
    try {
      await resolve(password);
    } finally {
      setSubmitting(false);
    }
  }

  const isImage = resource?.mimeType?.startsWith('image/');
  const isPdf = resource?.mimeType === 'application/pdf';
  const canEmbed = resource?.url && (isImage || isPdf);

  return (
    <main className="mx-auto flex min-h-screen max-w-4xl flex-col px-4 py-8">
      <header className="mb-6">
        <p className="text-sm font-semibold text-primary">{BRAND.appName}</p>
        {resource && (
          <h1 className="mt-1 truncate text-xl font-semibold tracking-tight">
            {resource.name}
          </h1>
        )}
      </header>

      <div className="flex flex-1 flex-col items-center justify-center">
        {loading ? (
          <div className="flex flex-col items-center gap-3 text-muted-foreground">
            <Spinner className="size-6" />
            <p className="text-sm">Opening shared link…</p>
          </div>
        ) : needsPassword ? (
          <form
            onSubmit={handleSubmitPassword}
            className="w-full max-w-sm rounded-lg border p-6"
          >
            <div className="mb-4 flex flex-col items-center gap-2 text-center">
              <Lock className="size-8 text-muted-foreground" />
              <p className="text-sm text-muted-foreground">
                This link is password-protected.
              </p>
            </div>
            <Field label="Password" error={message ?? undefined}>
              <Input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoFocus
                aria-invalid={!!message}
              />
            </Field>
            <Button
              type="submit"
              className="mt-4 w-full"
              disabled={submitting || !password.trim()}
            >
              {submitting ? 'Unlocking…' : 'Unlock'}
            </Button>
          </form>
        ) : message ? (
          <div className="flex flex-col items-center gap-3 text-center">
            <FileWarning className="size-10 text-muted-foreground" />
            <p className="max-w-sm text-sm text-muted-foreground">{message}</p>
          </div>
        ) : resource ? (
          <div className="flex w-full flex-1 flex-col">
            {canEmbed ? (
              isPdf ? (
                <iframe
                  src={resource.url!}
                  title={resource.name}
                  className="h-[70vh] w-full rounded-md border"
                />
              ) : (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={resource.url!}
                  alt={resource.name}
                  className="mx-auto max-h-[70vh] rounded-md border object-contain"
                />
              )
            ) : (
              <div className="flex flex-col items-center gap-3 rounded-md border p-10 text-center">
                <FileWarning className="size-10 text-muted-foreground" />
                <p className="text-sm text-muted-foreground">
                  {resource.url
                    ? 'This file can’t be previewed here — download it to view.'
                    : 'This shared item has no downloadable content.'}
                </p>
              </div>
            )}
            {resource.url && (
              <div className="mt-4 flex justify-center">
                <Button
                  onClick={() =>
                    window.open(resource.url!, '_blank', 'noopener')
                  }
                >
                  <Download /> Download
                </Button>
              </div>
            )}
          </div>
        ) : null}
      </div>
    </main>
  );
}
