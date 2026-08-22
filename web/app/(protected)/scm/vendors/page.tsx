'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Factory, Trash2 } from 'lucide-react';
import { ApiError } from '../../../lib/api';
import { useAuth } from '../../../lib/auth-context';
import {
  confirmNdaTemplateUpload,
  createNdaTemplateUploadUrl,
  deleteVendor,
  listVendors,
  VENDOR_STATUS_LABEL,
  type Vendor,
  type VendorStatus,
  type VendorCoreCompetency,
  VENDOR_CORE_COMPETENCY_LABEL,
} from '../../../lib/scm';
import { uploadToPresignedUrl } from '../../../lib/vault-api';
import { PageContainer } from '../../../components/ui/page-container';
import { PageHeader } from '../../../components/ui/page-header';
import { Card, CardContent } from '../../../components/ui/card';
import { Button } from '../../../components/ui/button';
import { Select } from '../../../components/ui/select';
import { StatusBadge } from '../../../components/ui/status-badge';
import { OverrideTag } from '../../../components/ui/override-tag';
import { EmptyState } from '../../../components/ui/empty-state';
import { RegisterToolbar } from '../../../components/ui/register-toolbar';
import { RegisterPagination } from '../../../components/ui/register-pagination';
import { useRegisterList } from '../../../lib/use-register-list';
import { Skeleton } from '../../../components/ui/skeleton';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '../../../components/ui/table';
import { NewVendorDialog } from './_components/new-vendor-dialog';
import { useConfirm } from '../../../components/ui/confirm';
import { useToast } from '../../../components/ui/toaster';

const STATUSES: VendorStatus[] = [
  'PENDING_QUESTIONNAIRE',
  'QUESTIONNAIRE_SUBMITTED',
  'UNDER_AUDIT',
  'APPROVED_PREFERRED',
  'APPROVED',
  'CONDITIONALLY_APPROVED',
  'NOT_APPROVED',
];

/**
 * Vendor list (spec §3). Company-wide read; "New Vendor" is shown to
 * SCM-vertical Manager+/SuperAdmin (the button; the backend is the real gate).
 */
export default function VendorsPage() {
  const router = useRouter();
  const { user } = useAuth();
  const confirm = useConfirm();
  const toast = useToast();
  const [vendors, setVendors] = useState<Vendor[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<VendorStatus | ''>('');
  const [competencyFilter, setCompetencyFilter] = useState<VendorCoreCompetency | ''>('');
  const [creating, setCreating] = useState(false);
  const [ndaUploading, setNdaUploading] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  // UI hint only — the button shows for SUPER_ADMIN or a MANAGER (the backend
  // enforces SCM-vertical). We can't see vertical code here, so a non-SCM
  // manager may see the button and get a 403 on submit (surfaced as a toast).
  const canCreate =
    user?.role === 'SUPER_ADMIN' || user?.role === 'MANAGER';
  const canDelete = user?.role === 'SUPER_ADMIN';

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setVendors(await listVendors());
    } catch {
      setError('Failed to load vendors.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const filtered = useMemo(
    () => vendors.filter((vendor) =>
      (!statusFilter || vendor.status === statusFilter) &&
      (!competencyFilter || vendor.coreCompetency === competencyFilter),
    ),
    [vendors, statusFilter, competencyFilter],
  );
  const register = useRegisterList(filtered, (vendor) => `${vendor.companyName} ${vendor.status} ${vendor.contactPersonName ?? ''} ${vendor.contactEmail} ${vendor.coreCompetency ?? ''}`);

  async function removeVendor(vendor: Vendor) {
    const accepted = await confirm({
      title: 'Delete vendor permanently?',
      description: `${vendor.companyName} and its qualification records will be permanently deleted. Vendors already used in an operational record cannot be deleted.`,
      confirmLabel: 'Delete vendor',
      cancelLabel: 'Cancel',
      destructive: true,
    });
    if (!accepted) return;

    setDeletingId(vendor.id);
    try {
      await deleteVendor(vendor.id);
      setVendors((current) => current.filter((item) => item.id !== vendor.id));
      toast.success(`${vendor.companyName} deleted.`);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Failed to delete vendor.');
    } finally {
      setDeletingId(null);
    }
  }

  return (
    <PageContainer>
      <PageHeader
        title="Vendors"
        description="Vendor master and qualification status."
        action={
          canCreate ? (
            <Button onClick={() => setCreating(true)}>+ New Vendor</Button>
          ) : undefined
        }
      />

      <RegisterToolbar title="Vendor Register" search={register.search} onSearchChange={register.setSearch} searchPlaceholder="Search vendor, contact, competency or status" filters={<>
        <Select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value as VendorStatus | '')}
          className="h-9 w-56"
        >
          <option value="">All statuses</option>
          {STATUSES.map((s) => (
            <option key={s} value={s}>
              {VENDOR_STATUS_LABEL[s]}
            </option>
          ))}
        </Select>
        <Select
          value={competencyFilter}
          onChange={(e) => setCompetencyFilter(e.target.value as VendorCoreCompetency | '')}
          className="h-9 w-64"
        >
          <option value="">All core competencies</option>
          {Object.entries(VENDOR_CORE_COMPETENCY_LABEL).map(([value, label]) => (
            <option key={value} value={value}>{label}</option>
          ))}
        </Select>
        {user?.role === 'SUPER_ADMIN' && (
          <label
            className={`inline-flex h-9 items-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground ${
              ndaUploading ? 'cursor-not-allowed opacity-50' : 'cursor-pointer'
            }`}
          >
            {ndaUploading ? 'Uploading NDA…' : 'Replace NDA template'}
            <input
              type="file"
              className="hidden"
              disabled={ndaUploading}
              onChange={async (event) => {
                const file = event.target.files?.[0];
                event.currentTarget.value = '';
                if (!file) return;
                setNdaUploading(true);
                setError(null);
                try {
                  const upload = await createNdaTemplateUploadUrl(file);
                  await uploadToPresignedUrl(upload.uploadUrl, file);
                  await confirmNdaTemplateUpload(upload.fileId);
                } catch (err) {
                  setError(
                    err instanceof ApiError
                      ? err.message
                      : 'Failed to replace NDA template.',
                  );
                } finally {
                  setNdaUploading(false);
                }
              }}
            />
          </label>
        )}
      </>} />

      {error && <p className="mb-4 text-sm text-destructive">{error}</p>}

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Company</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Core competency</TableHead>
                <TableHead>Contact</TableHead>
                <TableHead>Created</TableHead>
                {canDelete && <TableHead className="text-right">Actions</TableHead>}
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                Array.from({ length: 4 }).map((_, i) => (
                  <TableRow key={i}>
                    {Array.from({ length: canDelete ? 6 : 5 }).map((__, j) => (
                      <TableCell key={j}>
                        <Skeleton className="h-4 w-28" />
                      </TableCell>
                    ))}
                  </TableRow>
                ))
              ) : register.visibleItems.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={canDelete ? 6 : 5} className="p-0">
                    <EmptyState
                      icon={Factory}
                      title="No vendors yet"
                      description={
                        canCreate
                          ? 'Add a vendor to start the qualification process.'
                          : 'Vendors will appear here once added by the SCM team.'
                      }
                    />
                  </TableCell>
                </TableRow>
              ) : (
                register.visibleItems.map((s) => (
                  <TableRow
                    key={s.id}
                    className="cursor-pointer"
                    onClick={() => router.push(`/scm/vendors/${s.id}`)}
                  >
                    <TableCell className="font-medium">{s.companyName}</TableCell>
                    <TableCell>
                      <div className="flex flex-wrap items-center gap-1.5">
                        <StatusBadge value={s.status} />
                        {s.statusOverridden && <OverrideTag />}
                      </div>
                    </TableCell>
                    <TableCell>
                      {s.coreCompetency
                        ? VENDOR_CORE_COMPETENCY_LABEL[s.coreCompetency]
                        : 'Not audited'}
                    </TableCell>
                    <TableCell>{s.contactPersonName ?? '—'}</TableCell>
                    <TableCell>
                      {new Date(s.createdAt).toLocaleDateString()}
                    </TableCell>
                    {canDelete && (
                      <TableCell className="text-right">
                        <Button
                          variant="outline"
                          size="sm"
                          className="text-destructive hover:text-destructive"
                          disabled={deletingId === s.id}
                          onClick={(event) => {
                            event.stopPropagation();
                            void removeVendor(s);
                          }}
                          aria-label={`Delete ${s.companyName}`}
                        >
                          <Trash2 className="size-4" />
                          {deletingId === s.id ? 'Deleting…' : 'Delete'}
                        </Button>
                      </TableCell>
                    )}
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
      <RegisterPagination page={register.page} pageCount={register.pageCount} onPageChange={register.setPage} disabled={loading} />

      {creating && (
        <NewVendorDialog
          onClose={() => setCreating(false)}
          onCreated={(id) => router.push(`/scm/vendors/${id}`)}
        />
      )}
    </PageContainer>
  );
}
