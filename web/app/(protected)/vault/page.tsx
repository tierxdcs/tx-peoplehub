'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Folder, Search as SearchIcon } from 'lucide-react';
import { apiFetch, ApiError } from '../../lib/api';
import type {
  VaultDownloadUrlResponse,
  VaultFile,
  VaultFolder,
  VaultSearchResult,
} from '../../lib/types';
import { useAuth } from '../../lib/auth-context';
import {
  SCard,
  SignalHeader,
  SignalPage,
  SIGNAL_HAIRLINE,
} from '../../components/ui/signal';
import { Button } from '../../components/ui/button';
import { Skeleton } from '../../components/ui/skeleton';
import { EmptyState } from '../../components/ui/empty-state';
import { useToast } from '../../components/ui/toaster';
import { useConfirm } from '../../components/ui/confirm';
import { cn } from '../../lib/utils';
import { NewFolderDialog } from './_components/new-folder-dialog';
import { RenameFolderDialog } from './_components/rename-folder-dialog';
import { InternalShareDialog } from './_components/internal-share-dialog';
import { ExternalShareDialog } from './_components/external-share-dialog';
import { PreviewModal } from './_components/preview-modal';
import { VersionPanel } from './_components/version-panel';
import { VaultBrowseBar } from './_components/vault-browse-bar';
import { VaultFileView } from './_components/vault-file-view';
import { VaultFolderList } from './_components/vault-folder-list';
import { VaultRecentRail } from './_components/vault-recent-rail';
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
    <SignalPage>
      <SignalHeader
        title="Vault"
        description="Your documents and the folders you have access to."
        actions={
          canCreateFolder ? (
            <Button onClick={() => setShowNew(true)}>+ New Folder</Button>
          ) : undefined
        }
      />

      <div className="space-y-4 px-5 pb-7 pt-[18px] lg:px-7">
        {error && (
          <p className="text-[12.5px] font-semibold text-[#C13438] dark:text-[#FF8A8D]">
            {error}
          </p>
        )}

        <VaultBrowseBar
          state={browse}
          onChange={(patch) =>
            setBrowse((current) => ({ ...current, ...patch }))
          }
          view={view}
          onViewChange={(next) => {
            setView(next);
            saveViewMode(next);
          }}
          searchPlaceholder="Search all of Vault…"
          summary={summary}
        />

        {/* Folders and the latest documents side by side: the recent files are a
            persistent rail rather than a section stacked underneath, so neither
            costs a scroll to reach. Below xl the rail stacks under the folders. */}
        <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,1fr)_360px]">
          <div className="min-w-0 space-y-4">
            {browsing ? (
              <>
                {results && results.folders.length > 0 && (
                  <VaultFolderList
                    folders={results.folders}
                    title="Matching folders"
                    subtitle={`${results.folders.length} match${
                      results.folders.length === 1 ? '' : 'es'
                    }`}
                  />
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
                    <SCard className="flex flex-col items-center py-2">
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
                    </SCard>
                  )}
              </>
            ) : loading ? (
              <SCard className="overflow-hidden">
                {Array.from({ length: 6 }).map((_, i) => (
                  <div
                    key={i}
                    className={cn(
                      'flex items-center gap-3 border-b px-4 py-3 last:border-b-0',
                      SIGNAL_HAIRLINE,
                    )}
                  >
                    <Skeleton className="size-5 rounded" />
                    <Skeleton className="h-4 w-40" />
                    <Skeleton className="h-4 w-20" />
                  </div>
                ))}
              </SCard>
            ) : folders.length === 0 ? (
              <SCard>
                <EmptyState
                  icon={Folder}
                  title="No folders yet"
                  description={
                    canCreateFolder
                      ? 'Create a folder to start organizing documents.'
                      : 'You don’t have access to any folders yet.'
                  }
                />
              </SCard>
            ) : (
              <VaultFolderList
                folders={folders}
                title="Folders"
                subtitle={`${folders.length} you can access`}
                onRename={setRenameTarget}
              />
            )}
          </div>

          <VaultRecentRail
            files={recent}
            loading={loading}
            actions={fileActions}
            className="xl:sticky xl:top-[4.5rem]"
          />
        </div>
      </div>

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
    </SignalPage>
  );
}
