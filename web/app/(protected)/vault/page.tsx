'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Folder, FolderLock, Users, Building2 } from 'lucide-react';
import { apiFetch } from '../../lib/api';
import type { VaultFolder } from '../../lib/types';
import { useAuth } from '../../lib/auth-context';
import { PageContainer } from '../../components/ui/page-container';
import { PageHeader } from '../../components/ui/page-header';
import { Card, CardContent } from '../../components/ui/card';
import { Badge } from '../../components/ui/badge';
import { Button } from '../../components/ui/button';
import { Skeleton } from '../../components/ui/skeleton';
import { EmptyState } from '../../components/ui/empty-state';
import { NewFolderDialog } from './_components/new-folder-dialog';
import { folderScopeLabel, folderScopeVariant } from './_lib/vault-format';

export default function VaultLandingPage() {
  const router = useRouter();
  const { user } = useAuth();
  const [folders, setFolders] = useState<VaultFolder[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showNew, setShowNew] = useState(false);

  const canCreateFolder =
    user?.role === 'MANAGER' ||
    user?.role === 'ADMIN' ||
    user?.role === 'SUPER_ADMIN';
  const isSuperAdmin = user?.role === 'SUPER_ADMIN';

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const roots = await apiFetch<VaultFolder[]>('/vault/folders/roots');
      setFolders(roots);
    } catch {
      setError('Failed to load your folders.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  function iconFor(folder: VaultFolder) {
    if (folder.type === 'PERSONAL') return FolderLock;
    if (folder.visibilityScope === 'COMPANY_WIDE') return Building2;
    if (folder.visibilityScope === 'TEAM') return Users;
    return Folder;
  }

  return (
    <PageContainer>
      <PageHeader
        title="Vault"
        description="Your documents and the folders you have access to."
        action={
          canCreateFolder ? (
            <Button onClick={() => setShowNew(true)}>+ New Folder</Button>
          ) : undefined
        }
      />

      {error && <p className="mb-4 text-sm text-destructive">{error}</p>}

      {loading ? (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <Card key={i}>
              <CardContent className="p-4">
                <Skeleton className="h-5 w-32" />
                <Skeleton className="mt-3 h-4 w-20" />
              </CardContent>
            </Card>
          ))}
        </div>
      ) : folders.length === 0 ? (
        <EmptyState
          icon={Folder}
          title="No folders yet"
          description={
            canCreateFolder
              ? 'Create a folder to start organizing documents.'
              : 'You don’t have access to any folders yet.'
          }
        />
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {folders.map((folder) => {
            const Icon = iconFor(folder);
            return (
              <button
                key={folder.id}
                onClick={() => router.push(`/vault/folders/${folder.id}`)}
                className="text-left"
              >
                <Card className="transition-colors hover:border-primary/50 hover:bg-accent/40">
                  <CardContent className="flex items-center gap-3 p-4">
                    <Icon className="size-8 shrink-0 text-muted-foreground" />
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-medium">{folder.name}</p>
                      <div className="mt-1 flex items-center gap-2">
                        <Badge variant={folderScopeVariant(folder)}>
                          {folderScopeLabel(folder)}
                        </Badge>
                        {folder.versioningEnabled && (
                          <Badge variant="muted">Versioned</Badge>
                        )}
                      </div>
                    </div>
                  </CardContent>
                </Card>
              </button>
            );
          })}
        </div>
      )}

      {showNew && (
        <NewFolderDialog
          isSuperAdmin={!!isSuperAdmin}
          onClose={() => setShowNew(false)}
          onCreated={(folder) => {
            setShowNew(false);
            router.push(`/vault/folders/${folder.id}`);
          }}
        />
      )}
    </PageContainer>
  );
}
