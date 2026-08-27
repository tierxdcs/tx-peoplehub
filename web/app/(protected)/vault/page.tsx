'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  Building2,
  Clock,
  Folder,
  FolderLock,
  Pencil,
  Search as SearchIcon,
  Users,
} from 'lucide-react';
import { apiFetch, ApiError } from '../../lib/api';
import type {
  VaultDownloadUrlResponse,
  VaultFile,
  VaultFolder,
  VaultSearchResult,
} from '../../lib/types';
import { useAuth } from '../../lib/auth-context';
import { PageContainer } from '../../components/ui/page-container';
import { PageHeader } from '../../components/ui/page-header';
import { Card, CardContent } from '../../components/ui/card';
import { Badge } from '../../components/ui/badge';
import { Button } from '../../components/ui/button';
import { Skeleton } from '../../components/ui/skeleton';
import { EmptyState } from '../../components/ui/empty-state';
import { useToast } from '../../components/ui/toaster';
import { useConfirm } from '../../components/ui/confirm';
import { NewFolderDialog } from './_components/new-folder-dialog';
import { RenameFolderDialog } from './_components/rename-folder-dialog';
import { InternalShareDialog } from './_components/internal-share-dialog';
import { ExternalShareDialog } from './_components/external-share-dialog';
import { PreviewModal } from './_components/preview-modal';
import { VersionPanel } from './_components/version-panel';
import { VaultBrowseBar } from './_components/vault-browse-bar';
import { VaultFileView } from './_components/vault-file-view';
import { folderScopeLabel, folderScopeVariant } from './_lib/vault-format';
import {
  EMPTY_BROWSE_STATE,
  buildSearchQuery,
  isBrowsing,
  loadViewMode,
  saveViewMode,
  type VaultBrowseState,
  type VaultViewMode,
} from './_lib/vault-query';

type Dialog =
  | { kind: 'preview'; file: VaultFile }
  | { kind: 'shareFile'; file: VaultFile }
  | { kind: 'linkFile'; file: VaultFile }
  | { kind: 'versions'; file: VaultFile }
  | null;

const RECENT_LIMIT = 8;

export default function VaultLandingPage() {
  const router = useRouter();
  const { user } = useAuth();
  const toast = useToast();
  const confirm = useConfirm();

  const [folders, setFolders] = useState<VaultFolder[]>([]);
  const [recent, setRecent] = useState<VaultFile[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showNew, setShowNew] = useState(false);
  const [renameTarget, setRenameTarget] = useState<VaultFolder | null>(null);
  const [dialog, setDialog] = useState<Dialog>(null);

  // Search from the landing page is inherently vault-wide — there is no current
  // folder to scope to, so no scope toggle is offered here.
  const [browse, setBrowse] = useState<VaultBrowseState>({
    ...EMPTY_BROWSE_STATE,
    scope: 'VAULT',
  });
  const [debouncedTerm, setDebouncedTerm] = useState('');
  const [results, setResults] = useState<VaultSearchResult | null>(null);
  const [searching, setSearching] = useState(false);
  const [view, setView] = useState<VaultViewMode>('grid');

  const canCreateFolder =
    user?.role === 'MANAGER' ||
    user?.role === 'ADMIN' ||
    user?.role === 'SUPER_ADMIN';
  const isSuperAdmin = user?.role === 'SUPER_ADMIN';

  useEffect(() => {
    setView(loadViewMode());
  }, []);

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedTerm(browse.term), 250);
    return () => clearTimeout(timer);
  }, [browse.term]);

  const query = useMemo<VaultBrowseState>(
    () => ({ ...browse, term: debouncedTerm }),
    [browse, debouncedTerm],
  );
  const browsing = isBrowsing(query);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      // Recent files are a convenience — a failure there must not cost the user
      // their folder list, so it's resolved independently.
      const [roots, latest] = await Promise.all([
        apiFetch<VaultFolder[]>('/vault/folders/roots'),
        apiFetch<VaultFile[]>(`/vault/files/recent?limit=${RECENT_LIMIT}`).catch(
          () => [] as VaultFile[],
        ),
      ]);
      setFolders(roots);
      setRecent(latest);
    } catch {
      setError('Failed to load your folders.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!isBrowsing(query)) {
      setResults(null);
      return;
    }
    let cancelled = false;
    setSearching(true);
    apiFetch<VaultSearchResult>(`/vault/files/search?${buildSearchQuery(query)}`)
      .then((result) => {
        if (!cancelled) setResults(result);
      })
      .catch(() => {
        if (!cancelled) {
          setResults({
            folders: [],
            files: [],
            totalFileMatches: 0,
            truncated: false,
          });
          toast.error('Search failed.');
        }
      })
      .finally(() => {
        if (!cancelled) setSearching(false);
      });
    return () => {
      cancelled = true;
    };
    // toast is stable; excluding it avoids re-running the search on re-render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query]);

  function iconFor(folder: VaultFolder) {
    if (folder.type === 'PERSONAL') return FolderLock;
    if (folder.visibilityScope === 'COMPANY_WIDE') return Building2;
    if (folder.visibilityScope === 'TEAM') return Users;
    return Folder;
  }

  async function handleDownload(file: VaultFile) {
    try {
      const res = await apiFetch<VaultDownloadUrlResponse>(
        `/vault/files/${file.id}/download-url`,
      );
      window.open(res.downloadUrl, '_blank', 'noopener');
    } catch {
      toast.error('Failed to get download link');
    }
  }

  async function handleDeleteFile(file: VaultFile) {
    const ok = await confirm({
      title: `Delete “${file.name}”?`,
      description: 'The file and all its versions will be removed.',
      confirmLabel: 'Delete',
      destructive: true,
    });
    if (!ok) return;
    try {
      await apiFetch(`/vault/files/${file.id}`, { method: 'DELETE' });
      toast.success('File deleted.');
      await load();
      // Re-run the search (if one is open) so the deleted row disappears from
      // the results too: a new state identity is what the search effect keys on.
      setBrowse((current) => ({ ...current }));
    } catch (err) {
      toast.error(
        err instanceof ApiError ? err.message : 'Failed to delete file',
      );
    }
  }

  const fileActions = {
    onPreview: (file: VaultFile) => setDialog({ kind: 'preview', file }),
    onDownload: handleDownload,
    onVersions: (file: VaultFile) => setDialog({ kind: 'versions', file }),
    onShare: (file: VaultFile) => setDialog({ kind: 'shareFile', file }),
    onLink: (file: VaultFile) => setDialog({ kind: 'linkFile', file }),
    onDelete: handleDeleteFile,
  };

  const summary = searching
    ? 'Searching…'
    : results
      ? `${results.files.length} of ${results.totalFileMatches} file${
          results.totalFileMatches === 1 ? '' : 's'
        }${results.truncated ? ' (more exist — narrow the filters)' : ''}${
          results.folders.length > 0
            ? `, ${results.folders.length} folder${
                results.folders.length === 1 ? '' : 's'
              }`
            : ''
        }`
      : undefined;

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

      <VaultBrowseBar
        state={browse}
        onChange={(patch) => setBrowse((current) => ({ ...current, ...patch }))}
        view={view}
        onViewChange={(next) => {
          setView(next);
          saveViewMode(next);
        }}
        searchPlaceholder="Search all of Vault…"
        summary={summary}
      />

      {browsing ? (
        <>
          {results && results.folders.length > 0 && (
            <div className="mb-6">
              <h2 className="mb-2 text-sm font-medium text-muted-foreground">
                Matching folders
              </h2>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {results.folders.map((folder) => {
                  const Icon = iconFor(folder);
                  return (
                    <button
                      key={folder.id}
                      onClick={() => router.push(`/vault/folders/${folder.id}`)}
                      className="text-left"
                    >
                      <Card className="transition-colors hover:border-primary/50 hover:bg-accent/40">
                        <CardContent className="flex items-center gap-3 p-4">
                          <Icon className="size-7 shrink-0 text-muted-foreground" />
                          <p className="min-w-0 flex-1 truncate font-medium">
                            {folder.name}
                          </p>
                        </CardContent>
                      </Card>
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {results && results.files.length > 0 && (
            <VaultFileView
              files={results.files}
              view={view}
              showFolder
              actions={fileActions}
            />
          )}

          {!searching &&
            results &&
            results.files.length === 0 &&
            results.folders.length === 0 && (
              <div className="flex flex-col items-center">
                <EmptyState
                  icon={SearchIcon}
                  title="No matches"
                  description="No file or folder you can access matches your search and filters."
                />
                <Button
                  variant="outline"
                  onClick={() =>
                    setBrowse({ ...EMPTY_BROWSE_STATE, scope: 'VAULT' })
                  }
                >
                  Clear search and filters
                </Button>
              </div>
            )}
        </>
      ) : loading ? (
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
        <>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {folders.map((folder) => {
              const Icon = iconFor(folder);
              return (
                <Card
                  key={folder.id}
                  role="button"
                  tabIndex={0}
                  onClick={() => router.push(`/vault/folders/${folder.id}`)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      router.push(`/vault/folders/${folder.id}`);
                    }
                  }}
                  className="group cursor-pointer transition-colors hover:border-primary/50 hover:bg-accent/40"
                >
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
                    {folder.access.canWrite && (
                      <button
                        type="button"
                        aria-label={`Rename ${folder.name}`}
                        title="Rename"
                        onClick={(e) => {
                          e.stopPropagation();
                          setRenameTarget(folder);
                        }}
                        className="rounded p-1 text-muted-foreground opacity-0 transition-opacity hover:text-foreground group-hover:opacity-100"
                      >
                        <Pencil className="size-4" />
                      </button>
                    )}
                  </CardContent>
                </Card>
              );
            })}
          </div>

          {recent.length > 0 && (
            <section className="mt-8">
              <div className="mb-2 flex items-baseline gap-2">
                <h2 className="flex items-center gap-2 text-sm font-medium">
                  <Clock className="size-4 text-muted-foreground" /> Recent
                  files
                </h2>
                {/* Vault keeps no internal view log, so this is honestly
                    "added or updated" — never "recently viewed". */}
                <span className="text-xs text-muted-foreground">
                  Most recently added or updated across your folders
                </span>
              </div>
              <VaultFileView
                files={recent}
                view={view}
                showFolder
                actions={fileActions}
              />
            </section>
          )}
        </>
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

      {renameTarget && (
        <RenameFolderDialog
          folder={renameTarget}
          onClose={() => setRenameTarget(null)}
          onRenamed={() => {
            setRenameTarget(null);
            void load();
          }}
        />
      )}

      {dialog?.kind === 'preview' && (
        <PreviewModal
          fileId={dialog.file.id}
          fileName={dialog.file.name}
          onClose={() => setDialog(null)}
        />
      )}
      {dialog?.kind === 'shareFile' && (
        <InternalShareDialog
          resourceType="FILE"
          resourceId={dialog.file.id}
          resourceName={dialog.file.name}
          onClose={() => setDialog(null)}
        />
      )}
      {dialog?.kind === 'linkFile' && (
        <ExternalShareDialog
          resourceType="FILE"
          resourceId={dialog.file.id}
          resourceName={dialog.file.name}
          onClose={() => setDialog(null)}
        />
      )}
      {dialog?.kind === 'versions' && (
        <VersionPanel
          file={dialog.file}
          onClose={() => setDialog(null)}
          onChanged={load}
        />
      )}
    </PageContainer>
  );
}
