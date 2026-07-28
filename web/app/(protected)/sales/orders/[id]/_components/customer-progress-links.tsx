'use client';

import { useCallback, useEffect, useState } from 'react';
import { ClipboardCopy, ExternalLink, Link2, Trash2 } from 'lucide-react';
import { apiFetch, ApiError } from '../../../../../lib/api';
import { Button } from '../../../../../components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '../../../../../components/ui/card';
import { Input } from '../../../../../components/ui/input';
import { useToast } from '../../../../../components/ui/toaster';

type ProgressLink = {
  id: string;
  token: string;
  expiresAt: string;
  revokedAt: string | null;
  passwordProtected: boolean;
  createdAt: string;
};

export function CustomerProgressLinks({ orderId }: { orderId: string }) {
  const toast = useToast();
  const [links, setLinks] = useState<ProgressLink[]>([]);
  const [password, setPassword] = useState('');
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const publicUrl = (token: string) =>
    `${window.location.origin}/public/order-progress/${token}`;

  const load = useCallback(async () => {
    try {
      setLinks(
        await apiFetch<ProgressLink[]>(
          `/orders/${orderId}/customer-progress-links`,
        ),
      );
      setError(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Unable to load progress links');
    }
  }, [orderId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function create() {
    setCreating(true);
    try {
      const link = await apiFetch<ProgressLink>(
        `/orders/${orderId}/customer-progress-links`,
        {
          method: 'POST',
          body: JSON.stringify({ password: password.trim() || undefined }),
        },
      );
      await navigator.clipboard.writeText(publicUrl(link.token));
      setPassword('');
      toast.success('Customer progress link created and copied');
      await load();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Unable to create link');
    } finally {
      setCreating(false);
    }
  }

  return (
    <Card className="mt-4">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Link2 className="size-5" />
          Share progress with customer
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4 pt-0">
        <p className="text-sm text-muted-foreground">
          Creates a read-only, privacy-safe order tracker. Add a password if the
          link will be shared outside a controlled channel.
        </p>
        {error ? (
          <p className="text-sm text-destructive">{error}</p>
        ) : (
          <>
            <div className="flex max-w-xl flex-col gap-2 sm:flex-row">
              <Input
                type="password"
                name="customer-progress-link-password"
                autoComplete="new-password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                placeholder="Optional link password"
                aria-label="Optional link password"
              />
              <Button onClick={create} disabled={creating}>
                {creating ? 'Creating…' : 'Create & copy link'}
              </Button>
            </div>
            {links.length > 0 && (
              <div className="divide-y rounded-lg border">
                {links.map((link) => {
                  const expired = new Date(link.expiresAt) <= new Date();
                  const active = !link.revokedAt && !expired;
                  return (
                    <div
                      key={link.id}
                      className="flex flex-wrap items-center justify-between gap-3 p-3 text-sm"
                    >
                      <div>
                        <div className="font-medium">
                          {link.revokedAt
                            ? 'Revoked'
                            : expired
                              ? 'Expired'
                              : `Active until ${new Date(link.expiresAt).toLocaleDateString()}`}
                        </div>
                        <div className="text-xs text-muted-foreground">
                          Created {new Date(link.createdAt).toLocaleDateString()}
                          {link.passwordProtected ? ' · Password protected' : ''}
                        </div>
                      </div>
                      <div className="flex gap-1">
                        <Button
                          size="sm"
                          variant="ghost"
                          aria-label="Copy customer progress link"
                          onClick={() => void navigator.clipboard.writeText(publicUrl(link.token))}
                        >
                          <ClipboardCopy className="size-4" />
                        </Button>
                        <a href={publicUrl(link.token)} target="_blank" rel="noreferrer">
                          <Button size="sm" variant="ghost" aria-label="Open customer progress link">
                            <ExternalLink className="size-4" />
                          </Button>
                        </a>
                        {active && (
                          <Button
                            size="sm"
                            variant="ghost"
                            className="text-destructive"
                            aria-label="Revoke customer progress link"
                            onClick={async () => {
                              await apiFetch(
                                `/orders/${orderId}/customer-progress-links/${link.id}`,
                                { method: 'DELETE' },
                              );
                              toast.success('Link revoked');
                              await load();
                            }}
                          >
                            <Trash2 className="size-4" />
                          </Button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}
