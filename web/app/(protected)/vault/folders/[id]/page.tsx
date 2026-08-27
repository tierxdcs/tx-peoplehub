'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import {
  File as FileIcon,
  Folder,
  Link2,
  Pencil,
  Search as SearchIcon,
  Share2,
  Trash2,
  Upload,
} from 'lucide-react';
import { apiFetch, ApiError } from '../../../../lib/api';
import type {
  VaultDownloadUrlResponse,
  VaultFile,
  VaultFolder,
  VaultSearchResult,
} from '../../../../lib/types';
import { useAuth } from '../../../../lib/auth-context';
import {
  SCard,
  SignalHeader,
  SignalPage,
} from '../../../../components/ui/signal';
import { Badge } from '../../../../components/ui/badge';
import { Button } from '../../../../components/ui/button';
import { Skeleton } from '../../../../components/ui/skeleton';
import { EmptyState } from '../../../../components/ui/empty-state';
import { useToast } from '../../../../components/ui/toaster';
import { useConfirm } from '../../../../components/ui/confirm';
import { NewFolderDialog } from '../../_components/new-folder-dialog';
import { RenameFolderDialog } from '../../_components/rename-folder-dialog';
import { InternalShareDialog } from '../../_components/internal-share-dialog';
import { ExternalShareDialog } from '../../_components/external-share-dialog';
import { PreviewModal } from '../../_components/preview-modal';
import { VersionPanel } from '../../_components/version-panel';
import { UploadQueueDialog } from '../../_components/upload-queue-dialog';
import { VaultBreadcrumb } from '../../_components/vault-breadcrumb';
import { VaultBrowseBar } from '../../_components/vault-browse-bar';
import { VaultFileView } from '../../_components/vault-file-view';
import { VaultFolderList } from '../../_components/vault-folder-list';
import {
  folderScopeLabel,
  folderScopeVariant,
} from '../../_lib/vault-format';
import {
  EMPTY_BROWSE_STATE,
  buildBrowseQuery,
  buildSearchQuery,
  isBrowsing,
  loadViewMode,
  saveViewMode,
  type VaultBrowseState,
  type VaultViewMode,
} from '../../_lib/vault-query';

type Dialog =
  | { kind: 'newSubfolder' }
  | { kind: 'rename' }
  | { kind: 'upload' }
  | { kind: 'shareFolder' }
  | { kind: 'linkFolder' }
  | { kind: 'preview'; file: VaultFile }
  | { kind: 'shareFile'; file: VaultFile }
  | { kind: 'linkFile'; file: VaultFile }
  | { kind: 'versions'; file: VaultFile }
  | null;

export default function FolderDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { user } = useAuth();
  const toast = useToast();
  const confirm = useConfirm();

  const [folder, setFolder] = useState<VaultFolder | null>(null);
  const [files, setFiles] = useState<VaultFile[]>([]);
  const [matchedFolders, setMatchedFolders] = useState<VaultFolder[] | null>(
    null,
  );
  const [totalMatches, setTotalMatches] = useState<number | null>(null);
  const [truncated, setTruncated] = useState(false);
  const [loading, setLoading] = useState(true);
  const [filesLoading, setFilesLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dialog, setDialog] = useState<Dialog>(null);

  // A folder page starts scoped to the folder you opened; "Entire Vault" is the
  // deliberate widening, never the default.
  const [browse, setBrowse] = useState<VaultBrowseState>({
    ...EMPTY_BROWSE_STATE,
    scope: 'FOLDER',
  });
  const [debouncedTerm, setDebouncedTerm] = useState('');
  const [view, setView] = useState<VaultViewMode>('grid');

  const isSuperAdmin = user?.role === 'SUPER_ADMIN';

  // localStorage is only readable after mount, so grid renders first and the
  // remembered choice is applied immediately after.
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

  const loadFolder = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setFolder(await apiFetch<VaultFolder>(`/vault/folders/${id}`));
    } catch (err) {
      setError(
        err instanceof ApiError && err.statusCode === 403
          ? 'You do not have access to this folder.'
          : 'Failed to load this folder.',
      );
    } finally {
      setLoading(false);
    }
  }, [id]);

  /**
   * Two request shapes, one funnel: browsing (a term and/or filters) goes to the
   * search endpoint so the chosen scope decides whether subfolders are included;
   * a plain visit lists just this folder, with sort applied.
   */
  const loadFiles = useCallback(async () => {
    setFilesLoading(true);
    try {
      if (isBrowsing(query)) {
        const result = await apiFetch<VaultSearchResult>(
          `/vault/files/search?${buildSearchQuery(query, id)}`,
        );
        setFiles(result.files);
        setMatchedFolders(result.folders);
        setTotalMatches(result.totalFileMatches);
        setTruncated(result.truncated);
      } else {
        const search = buildBrowseQuery(query);
        setFiles(
          await apiFetch<VaultFile[]>(
            `/vault/folders/${id}/files${search ? `?${search}` : ''}`,
          ),
        );
        setMatchedFolders(null);
        setTotalMatches(null);
        setTruncated(false);
      }
    } catch (err) {
      // The folder request owns the access/not-found message; a failure here is
      // about this list only, so don't blank the page out.
      if (!(err instanceof ApiError && err.statusCode === 403)) {
        toast.error('Failed to load files.');
      }
      setFiles([]);
    } finally {
      setFilesLoading(false);
    }
    // toast is stable for the component's life; excluding it keeps this from
    // re-firing a request on unrelated re-renders.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, query]);

  const reload = useCallback(async () => {
    await Promise.all([loadFolder(), loadFiles()]);
  }, [loadFolder, loadFiles]);

  useEffect(() => {
    void loadFolder();
  }, [loadFolder]);

  useEffect(() => {
    void loadFiles();
  }, [loadFiles]);

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
      await loadFiles();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Failed to delete file');
    }
  }

  async function handleDeleteFolder() {
    if (!folder) return;
    const ok = await confirm({
      title: `Delete “${folder.name}”?`,
      description:
        'The folder must be empty first. It will be archived and removed from your folder list. This cannot be undone here.',
      confirmLabel: 'Delete Folder',
      destructive: true,
    });
    if (!ok) return;
    try {
      await apiFetch(`/vault/folders/${folder.id}`, { method: 'DELETE' });
      toast.success(`Folder “${folder.name}” deleted.`);
      router.push('/vault');
    } catch (err) {
      // Surface the backend's specific message (e.g. "still contains 3 files
      // and 1 subfolder — remove these first") rather than a generic failure.
      toast.error(
        err instanceof ApiError ? err.message : 'Failed to delete folder',
      );
    }
  }

  if (loading) {
    return (
      <SignalPage>
        <SignalHeader backHref="/vault" backLabel="Vault" title="Vault" />
        <div className="px-5 pb-7 pt-[18px] lg:px-7">
          <Skeleton className="mb-4 h-5 w-48" />
          <Skeleton className="mb-6 h-9 w-64" />
          <Skeleton className="h-48 w-full" />
        </div>
      </SignalPage>
    );
  }

  if (error || !folder) {
    return (
      <SignalPage>
        <SignalHeader backHref="/vault" backLabel="Vault" title="Vault" />
        <div className="px-5 pb-7 pt-[18px] lg:px-7">
          <p className="text-[13px] font-semibold text-[#C13438] dark:text-[#FF8A8D]">
            {error ?? 'Folder not found.'}
          </p>
        </div>
      </SignalPage>
    );
  }

  const { access } = folder;
  // Browsing replaces the folder's own children with the folders that matched.
  const shownFolders = matchedFolders ?? folder.children ?? [];
  // External links aren't allowed on PERSONAL folders (backend rule), so hide
  // the action there rather than surface a guaranteed error.
  const canLinkFolder = access.canWrite && folder.type !== 'PERSONAL';
  // Folder delete is SUPER_ADMIN-only and DEFAULT-only (backend enforces both);
  // gate the action to match so it only shows where it can succeed.
  const canDeleteFolder =
    user?.role === 'SUPER_ADMIN' && folder.type === 'DEFAULT';

  const summary = filesLoading
    ? 'Loading…'
    : browsing
      ? `${files.length} of ${totalMatches ?? files.length} file${
          (totalMatches ?? files.length) === 1 ? '' : 's'
        }${truncated ? ' (more exist — narrow the filters)' : ''}${
          shownFolders.length > 0
            ? `, ${shownFolders.length} folder${shownFolders.length === 1 ? '' : 's'}`
            : ''
        }`
      : `${files.length} file${files.length === 1 ? '' : 's'}`;

  return (
    <SignalPage>
      <SignalHeader
        breadcrumb={
          <VaultBreadcrumb
            ancestors={folder.ancestors ?? []}
            current={folder.name}
          />
        }
        title={folder.name}
        chip={
          <span className="flex items-center gap-2">
            <Badge variant={folderScopeVariant(folder)}>
              {folderScopeLabel(folder)}
            </Badge>
            {folder.versioningEnabled && <Badge variant="muted">Versioned</Badge>}
          </span>
        }
        actions={
          <>
            {access.canWrite && (
              <Button variant="outline" onClick={() => setDialog({ kind: 'rename' })}>
                <Pencil /> Rename
              </Button>
            )}
            {access.canWrite && (
              <Button variant="outline" onClick={() => setDialog({ kind: 'shareFolder' })}>
                <Share2 /> Share
              </Button>
            )}
            {canLinkFolder && (
              <Button variant="outline" onClick={() => setDialog({ kind: 'linkFolder' })}>
                <Link2 /> Public link
              </Button>
            )}
            {access.canCreateSubfolder && (
              <Button variant="outline" onClick={() => setDialog({ kind: 'newSubfolder' })}>
                <Folder /> New Subfolder
              </Button>
            )}
            {access.canWrite && (
              <Button onClick={() => setDialog({ kind: 'upload' })}>
                <Upload /> Upload
              </Button>
            )}
            {canDeleteFolder && (
              <Button variant="destructive" onClick={handleDeleteFolder}>
                <Trash2 /> Delete Folder
              </Button>
            )}
          </>
        }
      />

      <div className="space-y-4 px-5 pb-7 pt-[18px] lg:px-7">
        <VaultBrowseBar
          state={browse}
          onChange={(patch) =>
            setBrowse((current) => ({ ...current, ...patch }))
          }
          scopeFolderName={folder.name}
          view={view}
          onViewChange={(next) => {
            setView(next);
            saveViewMode(next);
          }}
          summary={summary}
        />

        {shownFolders.length > 0 && (
          <VaultFolderList
            folders={shownFolders}
            title={browsing ? 'Matching folders' : 'Subfolders'}
            subtitle={`${shownFolders.length} folder${
              shownFolders.length === 1 ? '' : 's'
            }`}
          />
        )}

        {files.length === 0 ? (
          browsing ? (
            shownFolders.length === 0 && (
              <SCard className="flex flex-col items-center py-2">
                <EmptyState
                  icon={SearchIcon}
                  title="No matches"
                  description="Nothing here matches your search and filters."
                />
                <Button
                  variant="outline"
                  onClick={() =>
                    setBrowse({ ...EMPTY_BROWSE_STATE, scope: browse.scope })
                  }
                >
                  Clear search and filters
                </Button>
              </SCard>
            )
          ) : (
            <SCard>
              <EmptyState
                icon={FileIcon}
                title="No files yet"
                description={
                  access.canWrite
                    ? 'Upload a file to get started.'
                    : 'This folder has no files you can see.'
                }
              />
            </SCard>
          )
        ) : (
          <VaultFileView
            files={files}
            view={view}
            // Browsing can return files from other folders, so name the folder —
            // and this folder's versioning setting no longer speaks for every
            // row, so history is offered only where versions actually exist.
            showFolder={browsing}
            versioningEnabled={!browsing && folder.versioningEnabled}
            actions={{
              onPreview: (file) => setDialog({ kind: 'preview', file }),
              onDownload: handleDownload,
              onVersions: (file) => setDialog({ kind: 'versions', file }),
              onShare: (file) => setDialog({ kind: 'shareFile', file }),
              onLink: (file) => setDialog({ kind: 'linkFile', file }),
              onDelete: handleDeleteFile,
            }}
          />
        )}
      </div>

      {dialog?.kind === 'upload' && (
        <UploadQueueDialog
          folderId={folder.id}
          onClose={() => setDialog(null)}
          onUploaded={reload}
        />
      )}

      {dialog?.kind === 'newSubfolder' && (
        <NewFolderDialog
          isSuperAdmin={!!isSuperAdmin}
          parentFolderId={folder.id}
          onClose={() => setDialog(null)}
          onCreated={(created) => {
            setDialog(null);
            router.push(`/vault/folders/${created.id}`);
          }}
        />
      )}
      {dialog?.kind === 'rename' && (
        <RenameFolderDialog
          folder={folder}
          onClose={() => setDialog(null)}
          onRenamed={() => {
            setDialog(null);
            void loadFolder();
          }}
        />
      )}
      {dialog?.kind === 'shareFolder' && (
        <InternalShareDialog
          resourceType="FOLDER"
          resourceId={folder.id}
          resourceName={folder.name}
          onClose={() => setDialog(null)}
        />
      )}
      {dialog?.kind === 'linkFolder' && (
        <ExternalShareDialog
          resourceType="FOLDER"
          resourceId={folder.id}
          resourceName={folder.name}
          onClose={() => setDialog(null)}
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
          onChanged={loadFiles}
        />
      )}
    </SignalPage>
  );
}
