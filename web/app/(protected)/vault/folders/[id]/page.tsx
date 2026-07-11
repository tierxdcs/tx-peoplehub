'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import {
  ArrowLeft,
  Building2,
  Download,
  Eye,
  File as FileIcon,
  Folder,
  FolderLock,
  History,
  Link2,
  MoreVertical,
  Share2,
  Trash2,
  Upload,
  Users,
} from 'lucide-react';
import { apiFetch, ApiError } from '../../../../lib/api';
import type {
  VaultDownloadUrlResponse,
  VaultFile,
  VaultFolder,
  VaultUploadUrlResponse,
} from '../../../../lib/types';
import { useAuth } from '../../../../lib/auth-context';
import { uploadToPresignedUrl } from '../../../../lib/vault-api';
import { PageContainer } from '../../../../components/ui/page-container';
import { PageHeader } from '../../../../components/ui/page-header';
import { Card, CardContent } from '../../../../components/ui/card';
import { Badge } from '../../../../components/ui/badge';
import { Button } from '../../../../components/ui/button';
import { Progress } from '../../../../components/ui/progress';
import { Skeleton } from '../../../../components/ui/skeleton';
import { EmptyState } from '../../../../components/ui/empty-state';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '../../../../components/ui/table';
import { useToast } from '../../../../components/ui/toaster';
import { useConfirm } from '../../../../components/ui/confirm';
import { NewFolderDialog } from '../../_components/new-folder-dialog';
import { InternalShareDialog } from '../../_components/internal-share-dialog';
import { ExternalShareDialog } from '../../_components/external-share-dialog';
import { PreviewModal } from '../../_components/preview-modal';
import { VersionPanel } from '../../_components/version-panel';
import {
  folderScopeLabel,
  folderScopeVariant,
  formatBytes,
  formatDate,
} from '../../_lib/vault-format';

type Dialog =
  | { kind: 'newSubfolder' }
  | { kind: 'shareFolder' }
  | { kind: 'linkFolder' }
  | { kind: 'preview'; file: VaultFile }
  | { kind: 'shareFile'; file: VaultFile }
  | { kind: 'linkFile'; file: VaultFile }
  | { kind: 'versions'; file: VaultFile }
  | null;

function subfolderIcon(folder: VaultFolder) {
  if (folder.type === 'PERSONAL') return FolderLock;
  if (folder.visibilityScope === 'COMPANY_WIDE') return Building2;
  if (folder.visibilityScope === 'TEAM') return Users;
  return Folder;
}

export default function FolderDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { user } = useAuth();
  const toast = useToast();
  const confirm = useConfirm();

  const [folder, setFolder] = useState<VaultFolder | null>(null);
  const [files, setFiles] = useState<VaultFile[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [dialog, setDialog] = useState<Dialog>(null);
  const [uploadProgress, setUploadProgress] = useState<number | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const isSuperAdmin = user?.role === 'SUPER_ADMIN';

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [f, list] = await Promise.all([
        apiFetch<VaultFolder>(`/vault/folders/${id}`),
        apiFetch<VaultFile[]>(`/vault/folders/${id}/files`),
      ]);
      setFolder(f);
      setFiles(list);
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

  useEffect(() => {
    load();
  }, [load]);

  async function handleUploadFile(picked: File) {
    if (!folder) return;
    setUploadProgress(0);
    try {
      // Presign a PUT for a brand-new file, stream bytes to R2, then confirm.
      const presign = await apiFetch<VaultUploadUrlResponse>(
        '/vault/files/upload-url',
        {
          method: 'POST',
          body: JSON.stringify({
            folderId: folder.id,
            name: picked.name,
            mimeType: picked.type || 'application/octet-stream',
            sizeBytes: picked.size,
          }),
        },
      );
      await uploadToPresignedUrl(presign.uploadUrl, picked, setUploadProgress);
      await apiFetch(`/vault/files/${presign.file.id}/confirm-upload`, {
        method: 'POST',
      });
      toast.success(`Uploaded “${picked.name}”.`);
      await load();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Failed to upload file');
    } finally {
      setUploadProgress(null);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
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
      <PageContainer>
        <Skeleton className="mb-4 h-5 w-24" />
        <Skeleton className="mb-6 h-9 w-64" />
        <Skeleton className="h-48 w-full" />
      </PageContainer>
    );
  }

  if (error || !folder) {
    return (
      <PageContainer>
        <Link
          href="/vault"
          className="mb-4 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="size-4" /> Vault
        </Link>
        <p className="text-destructive">{error ?? 'Folder not found.'}</p>
      </PageContainer>
    );
  }

  const { access } = folder;
  const uploading = uploadProgress !== null;
  const subfolders = folder.children ?? [];
  // External links aren't allowed on PERSONAL folders (backend rule), so hide
  // the action there rather than surface a guaranteed error.
  const canLinkFolder = access.canWrite && folder.type !== 'PERSONAL';
  // Folder delete is SUPER_ADMIN-only and DEFAULT-only (backend enforces both);
  // gate the action to match so it only shows where it can succeed.
  const canDeleteFolder =
    user?.role === 'SUPER_ADMIN' && folder.type === 'DEFAULT';

  return (
    <PageContainer>
      <Link
        href={
          folder.parentFolderId
            ? `/vault/folders/${folder.parentFolderId}`
            : '/vault'
        }
        className="mb-4 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-4" /> {folder.parentFolderId ? 'Back' : 'Vault'}
      </Link>

      <PageHeader
        title={folder.name}
        description={
          <span className="flex items-center gap-2">
            <Badge variant={folderScopeVariant(folder)}>
              {folderScopeLabel(folder)}
            </Badge>
            {folder.versioningEnabled && <Badge variant="muted">Versioned</Badge>}
          </span>
        }
        action={
          <div className="flex flex-wrap items-center gap-2">
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
              <Button
                onClick={() => fileInputRef.current?.click()}
                disabled={uploading}
              >
                <Upload /> Upload
              </Button>
            )}
            {canDeleteFolder && (
              <Button variant="destructive" onClick={handleDeleteFolder}>
                <Trash2 /> Delete Folder
              </Button>
            )}
          </div>
        }
      />

      <input
        ref={fileInputRef}
        type="file"
        hidden
        onChange={(e) => {
          const picked = e.target.files?.[0];
          if (picked) handleUploadFile(picked);
        }}
      />

      {uploading && (
        <div className="mb-4 space-y-1">
          <Progress value={(uploadProgress ?? 0) * 100} />
          <p className="text-xs text-muted-foreground">
            Uploading… {Math.round((uploadProgress ?? 0) * 100)}%
          </p>
        </div>
      )}

      {subfolders.length > 0 && (
        <div className="mb-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {subfolders.map((child) => {
            const Icon = subfolderIcon(child);
            return (
              <button
                key={child.id}
                onClick={() => router.push(`/vault/folders/${child.id}`)}
                className="text-left"
              >
                <Card className="transition-colors hover:border-primary/50 hover:bg-accent/40">
                  <CardContent className="flex items-center gap-3 p-4">
                    <Icon className="size-7 shrink-0 text-muted-foreground" />
                    <p className="min-w-0 flex-1 truncate font-medium">
                      {child.name}
                    </p>
                  </CardContent>
                </Card>
              </button>
            );
          })}
        </div>
      )}

      {files.length === 0 ? (
        <EmptyState
          icon={FileIcon}
          title="No files yet"
          description={
            access.canWrite
              ? 'Upload a file to get started.'
              : 'This folder has no files you can see.'
          }
        />
      ) : (
        <Card>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Size</TableHead>
                <TableHead>Uploaded by</TableHead>
                <TableHead>Modified</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {files.map((file) => (
                <TableRow key={file.id}>
                  <TableCell>
                    <button
                      onClick={() => setDialog({ kind: 'preview', file })}
                      className="flex items-center gap-2 text-left hover:underline"
                    >
                      <FileIcon className="size-4 shrink-0 text-muted-foreground" />
                      <span className="min-w-0 truncate font-medium">
                        {file.name}
                      </span>
                    </button>
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {formatBytes(file.sizeBytes)}
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {file.uploadedByName ?? '—'}
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {formatDate(file.updatedAt)}
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center justify-end gap-1">
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => setDialog({ kind: 'preview', file })}
                        aria-label="Preview"
                      >
                        <Eye />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => handleDownload(file)}
                        aria-label="Download"
                      >
                        <Download />
                      </Button>
                      {folder.versioningEnabled && (
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => setDialog({ kind: 'versions', file })}
                          aria-label="Version history"
                        >
                          <History />
                        </Button>
                      )}
                      {file.access.canWrite && (
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => setDialog({ kind: 'shareFile', file })}
                          aria-label="Share"
                        >
                          <Share2 />
                        </Button>
                      )}
                      {file.access.canWrite && (
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => setDialog({ kind: 'linkFile', file })}
                          aria-label="Public link"
                        >
                          <Link2 />
                        </Button>
                      )}
                      {file.access.canDelete && (
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => handleDeleteFile(file)}
                          aria-label="Delete"
                        >
                          <Trash2 className="text-destructive" />
                        </Button>
                      )}
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
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
          onChanged={load}
        />
      )}
    </PageContainer>
  );
}
