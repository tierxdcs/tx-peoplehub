'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import {
  ArrowLeft,
  Eye,
  Paperclip,
  Trash2,
  Upload,
} from 'lucide-react';
import { ApiError } from '../../../../lib/api';
import { useAuth } from '../../../../lib/auth-context';
import { Lead, LeadAttachment } from '../../../../lib/types';
import {
  getLead,
  listLeadAttachments,
  deleteLeadAttachment,
  uploadLeadAttachment,
} from '../../../../lib/leads';
import { prettyEnum } from '../../../../lib/sales';
import { PageContainer } from '../../../../components/ui/page-container';
import { PageHeader } from '../../../../components/ui/page-header';
import { Card, CardContent } from '../../../../components/ui/card';
import { Button } from '../../../../components/ui/button';
import { Badge } from '../../../../components/ui/badge';
import { StatusBadge } from '../../../../components/ui/status-badge';
import { Skeleton } from '../../../../components/ui/skeleton';
import { EmptyState } from '../../../../components/ui/empty-state';
import { BusinessUnitLabel } from '../../../../components/ui/business-unit-label';
import { useToast } from '../../../../components/ui/toaster';
import { useConfirm } from '../../../../components/ui/confirm';
import { PreviewModal } from '../../../vault/_components/preview-modal';

const MAX_BYTES = 25 * 1024 * 1024;

function formatSize(bytes: string | null): string {
  if (!bytes) return '';
  const n = Number(bytes);
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

export default function LeadDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const toast = useToast();
  const confirm = useConfirm();
  const { user } = useAuth();
  const fileRef = useRef<HTMLInputElement>(null);

  const [lead, setLead] = useState<Lead | null>(null);
  const [attachments, setAttachments] = useState<LeadAttachment[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [preview, setPreview] = useState<{ fileId: string; name: string } | null>(
    null,
  );

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [leadRes, attRes] = await Promise.all([
        getLead(id),
        listLeadAttachments(id).catch(() => [] as LeadAttachment[]),
      ]);
      setLead(leadRes);
      setAttachments(attRes);
    } catch {
      setError('Failed to load lead');
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  // Only the owner (or a manager/admin) can attach — matches the backend's
  // owner-scoped write. Read/preview is open to any sales staff.
  const canEdit =
    !!lead &&
    !!user &&
    (lead.ownerId === user.sub ||
      user.role === 'MANAGER' ||
      user.role === 'ADMIN' ||
      user.role === 'SUPER_ADMIN');

  async function refreshAttachments() {
    try {
      setAttachments(await listLeadAttachments(id));
    } catch {
      /* non-critical */
    }
  }

  async function onFilePicked(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    if (file.size > MAX_BYTES) {
      toast.error('File is too large (max 25 MB).');
      return;
    }
    setUploading(true);
    setProgress(0);
    try {
      await uploadLeadAttachment(id, file, setProgress);
      toast.success('File attached.');
      await refreshAttachments();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Failed to attach file.');
    } finally {
      setUploading(false);
      setProgress(0);
    }
  }

  async function onDelete(att: LeadAttachment) {
    const ok = await confirm({
      title: 'Remove attachment?',
      description: `"${att.fileName}" will be unlinked from this lead.`,
      destructive: true,
    });
    if (!ok) return;
    try {
      await deleteLeadAttachment(id, att.id);
      await refreshAttachments();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Failed to remove.');
    }
  }

  if (loading) {
    return (
      <PageContainer className="max-w-3xl">
        <Skeleton className="mb-4 h-6 w-24" />
        <Skeleton className="mb-6 h-9 w-64" />
        <Skeleton className="h-40 w-full" />
      </PageContainer>
    );
  }
  if (error || !lead) {
    return (
      <PageContainer className="max-w-3xl">
        <button
          onClick={() => router.push('/sales/leads')}
          className="mb-4 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="size-4" /> Leads
        </button>
        <p className="text-destructive">{error ?? 'Lead not found.'}</p>
      </PageContainer>
    );
  }

  return (
    <PageContainer className="max-w-3xl">
      <button
        onClick={() => router.push('/sales/leads')}
        className="mb-4 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-4" /> Leads
      </button>

      <PageHeader
        title={lead.companyName}
        description={
          <span className="flex flex-wrap items-center gap-2">
            <span>{lead.leadNumber}</span>
            <span>· {lead.contactName}</span>
            <StatusBadge value={lead.status} />
          </span>
        }
      />

      {/* Lead summary */}
      <Card className="mb-6">
        <CardContent className="grid gap-4 p-6 sm:grid-cols-2">
          <Detail label="Requirement" value={lead.requirement} full />
          <Detail label="Business unit" node={<BusinessUnitLabel name={lead.businessUnitName} colorHex={lead.businessUnitColorHex} />} />
          <Detail label="Owner" value={lead.ownerName} />
          <Detail label="Priority" value={prettyEnum(lead.priority)} />
          <Detail label="Source" value={prettyEnum(lead.source)} />
          {lead.email && <Detail label="Email" value={lead.email} />}
          {lead.phone && <Detail label="Phone" value={lead.phone} />}
        </CardContent>
      </Card>

      {/* Attachments */}
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-lg font-semibold">Attachments</h2>
        {canEdit && (
          <Button
            variant="outline"
            size="sm"
            disabled={uploading}
            onClick={() => fileRef.current?.click()}
          >
            <Upload className="size-4" />
            {uploading ? `Uploading… ${Math.round(progress * 100)}%` : 'Attach file'}
          </Button>
        )}
        <input ref={fileRef} type="file" className="hidden" onChange={onFilePicked} />
      </div>

      <Card>
        <CardContent className="p-0">
          {attachments.length === 0 ? (
            <EmptyState
              icon={Paperclip}
              title="No attachments"
              description={
                canEdit
                  ? 'Attach quotes, specs, or reference docs. Supported files preview in-app.'
                  : 'No files have been attached to this lead.'
              }
            />
          ) : (
            <ul className="divide-y">
              {attachments.map((att) => (
                <li key={att.id} className="flex items-center gap-3 px-4 py-3">
                  <Paperclip className="size-4 shrink-0 text-muted-foreground" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium" title={att.fileName}>
                      {att.fileName}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {formatSize(att.sizeBytes)}
                      {att.uploadedByName ? ` · ${att.uploadedByName}` : ''}
                      {att.previewStatus === 'PENDING' && ' · preview generating…'}
                    </p>
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() =>
                      setPreview({ fileId: att.vaultFileId, name: att.fileName })
                    }
                  >
                    <Eye className="size-4" /> View
                  </Button>
                  {canEdit && (
                    <button
                      type="button"
                      onClick={() => void onDelete(att)}
                      className="rounded p-1 text-muted-foreground hover:text-destructive"
                      aria-label={`Remove ${att.fileName}`}
                    >
                      <Trash2 className="size-4" />
                    </button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      {preview && (
        <PreviewModal
          fileId={preview.fileId}
          fileName={preview.name}
          onClose={() => setPreview(null)}
        />
      )}
    </PageContainer>
  );
}

function Detail({
  label,
  value,
  node,
  full,
}: {
  label: string;
  value?: string;
  node?: React.ReactNode;
  full?: boolean;
}) {
  return (
    <div className={full ? 'sm:col-span-2' : undefined}>
      <div className="text-xs uppercase tracking-wide text-muted-foreground">
        {label}
      </div>
      <div className="mt-1 text-sm font-medium">{node ?? value}</div>
    </div>
  );
}
