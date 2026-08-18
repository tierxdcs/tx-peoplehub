'use client';

import { FormEvent, useCallback, useEffect, useMemo, useState } from 'react';
import { ClipboardCheck } from 'lucide-react';
import { apiFetch, ApiError } from '../../../lib/api';
import { useAuth } from '../../../lib/auth-context';
import { useIsHrStaff } from '../../../lib/use-is-hr-staff';
import { useToast } from '../../../components/ui/toaster';
import { PageContainer } from '../../../components/ui/page-container';
import { PageHeader } from '../../../components/ui/page-header';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from '../../../components/ui/card';
import { Button } from '../../../components/ui/button';
import { Input } from '../../../components/ui/input';
import { Select } from '../../../components/ui/select';
import { Textarea } from '../../../components/ui/textarea';
import { Badge } from '../../../components/ui/badge';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '../../../components/ui/table';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../../../components/ui/dialog';
import { formatINR } from '../../../lib/sales';
import { useNumberFormat } from '../../../lib/number-format-context';
import { RegisterToolbar } from '../../../components/ui/register-toolbar';
import { RegisterPagination } from '../../../components/ui/register-pagination';
import { EmptyState } from '../../../components/ui/empty-state';
import type { EmploymentType } from '../../../lib/types';

type HiringStage =
  'JOB_POSTED' | 'INTERVIEWING' | 'OFFER_EXTENDED' | 'CANDIDATE_SELECTED';

type Requisition = {
  id: string;
  requisitionNumber: string;
  positionTitle: string;
  employmentType: string;
  justification: string;
  keyResponsibilities: string | null;
  keyPerformanceIndicators: string | null;
  budgetAnnualCtc: string | null;
  targetJoiningDate: string | null;
  status: string;
  hiringStage: HiringStage | null;
  selectedCandidateName: string | null;
  rejectionComment: string | null;
  consumedAt: string | null;
  offerLetter: { id: string; employeeId: string } | null;
  onboardedEmployee: {
    id: string;
    employeeId: string;
    firstName: string;
    lastName: string;
  } | null;
  createdAt: string;
  requestedBy: {
    id: string;
    employeeId: string;
    firstName: string;
    lastName: string;
  };
  vertical: { name: string; ownerId: string | null };
};

const STAGES: { value: HiringStage; label: string }[] = [
  { value: 'JOB_POSTED', label: 'Job Posted' },
  { value: 'INTERVIEWING', label: 'Interviewing' },
  { value: 'OFFER_EXTENDED', label: 'Offer Extended' },
  { value: 'CANDIDATE_SELECTED', label: 'Candidate Selected / Fulfilled' },
];

function lifecycleLabel(requisition: Requisition) {
  if (requisition.status !== 'APPROVED') {
    return requisition.status.replaceAll('_', ' ');
  }
  if (requisition.hiringStage === 'CANDIDATE_SELECTED') return 'FULFILLED';
  return requisition.hiringStage?.replaceAll('_', ' ') ?? 'APPROVED';
}

export default function CandidateRequisitionsPage() {
  const { user } = useAuth();
  const { isHrStaff } = useIsHrStaff();
  const toast = useToast();
  const { style: numberFormatStyle } = useNumberFormat();
  const [register, setRegister] = useState<Requisition[]>([]);
  const [queue, setQueue] = useState<Requisition[]>([]);
  const [viewing, setViewing] = useState<Requisition | null>(null);
  const [positionTitle, setPositionTitle] = useState('');
  const [employmentType, setEmploymentType] = useState<EmploymentType>(
    'FULL_TIME_PERMANENT',
  );
  const [justification, setJustification] = useState('');
  const [keyResponsibilities, setKeyResponsibilities] = useState('');
  const [keyPerformanceIndicators, setKeyPerformanceIndicators] = useState('');
  const [budgetAnnualCtc, setBudgetAnnualCtc] = useState('');
  const [targetJoiningDate, setTargetJoiningDate] = useState('');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const pageSize = 10;
  const canCreate =
    user &&
    ['MANAGER', 'ADMIN', 'SUPER_ADMIN'].includes(user.role) &&
    !!user.verticalId;
  const isSuperAdmin = user?.role === 'SUPER_ADMIN';

  const load = useCallback(async () => {
    if (!user) return;
    try {
      const pendingPath = isSuperAdmin
        ? '/candidate-requisitions/pending-superadmin'
        : '/candidate-requisitions/pending-vertical';
      const [pending, all] = await Promise.all([
        apiFetch<Requisition[]>(pendingPath),
        apiFetch<Requisition[]>('/candidate-requisitions/register'),
      ]);
      setQueue(pending);
      setRegister(all);
      setViewing((current) =>
        current ? (all.find((item) => item.id === current.id) ?? null) : null,
      );
    } catch {
      toast.error('Failed to load candidate requisitions');
    }
  }, [isSuperAdmin, toast, user]);

  useEffect(() => {
    void load();
  }, [load]);

  async function create(event: FormEvent) {
    event.preventDefault();
    const budget = Number(budgetAnnualCtc);
    if (!(budget > 0)) {
      toast.error('Enter an annual CTC budget greater than zero');
      return;
    }
    if (
      !window.confirm(
        'Submit this requisition for approval? It will be routed to the vertical owner (or the CEO if the vertical has no owner).',
      )
    )
      return;
    try {
      await apiFetch('/candidate-requisitions', {
        method: 'POST',
        body: JSON.stringify({
          positionTitle,
          employmentType,
          justification,
          keyResponsibilities,
          keyPerformanceIndicators,
          budgetAnnualCtc: budget,
          targetJoiningDate: targetJoiningDate || undefined,
        }),
      });
      setPositionTitle('');
      setJustification('');
      setKeyResponsibilities('');
      setKeyPerformanceIndicators('');
      setBudgetAnnualCtc('');
      setTargetJoiningDate('');
      toast.success('Requisition submitted for approval');
      await load();
    } catch (error) {
      toast.error(
        error instanceof ApiError ? error.message : 'Creation failed',
      );
    }
  }

  async function cancelReq(requisition: Requisition) {
    if (!window.confirm(`Cancel ${requisition.requisitionNumber}?`)) return;
    try {
      await apiFetch(`/candidate-requisitions/${requisition.id}/cancel`, {
        method: 'POST',
      });
      toast.success('Requisition cancelled');
      await load();
    } catch (error) {
      toast.error(
        error instanceof ApiError ? error.message : 'Cancellation failed',
      );
    }
  }

  async function decide(requisition: Requisition, approve: boolean) {
    const stage = isSuperAdmin ? 'superadmin' : 'vertical';
    let body: string | undefined;
    if (approve) {
      if (!window.confirm(`Approve ${requisition.requisitionNumber}?`)) return;
    } else {
      const comment = window.prompt('Rejection reason (required)')?.trim();
      if (!comment) return;
      body = JSON.stringify({ comment });
    }
    try {
      await apiFetch(
        `/candidate-requisitions/${requisition.id}/${stage}-${approve ? 'approve' : 'reject'}`,
        { method: 'POST', ...(body ? { body } : {}) },
      );
      toast.success(approve ? 'Requisition approved' : 'Requisition rejected');
      await load();
    } catch (error) {
      toast.error(
        error instanceof ApiError ? error.message : 'Decision failed',
      );
    }
  }

  const filtered = useMemo(() => {
    const needle = search.trim().toLowerCase();
    if (!needle) return register;
    return register.filter((requisition) =>
      `${requisition.requisitionNumber} ${requisition.positionTitle} ${lifecycleLabel(requisition)} ${requisition.requestedBy.firstName} ${requisition.requestedBy.lastName} ${requisition.vertical.name} ${requisition.selectedCandidateName ?? ''}`
        .toLowerCase()
        .includes(needle),
    );
  }, [register, search]);
  const pageCount = Math.max(1, Math.ceil(filtered.length / pageSize));
  const pageItems = filtered.slice((page - 1) * pageSize, page * pageSize);

  return (
    <PageContainer>
      <PageHeader
        title="Candidate Requisitions"
        description="Authorize hiring sequentially, then follow HR’s recruiting progress through fulfilment."
      />
      {canCreate && (
        <Card>
          <CardHeader>
            <CardTitle>Request a position</CardTitle>
          </CardHeader>
          <CardContent>
            <form onSubmit={create} className="grid gap-4 sm:grid-cols-2">
              <label className="text-sm font-medium">
                Position title
                <Input
                  className="mt-1"
                  value={positionTitle}
                  onChange={(event) => setPositionTitle(event.target.value)}
                  required
                />
              </label>
              <label className="text-sm font-medium">
                Employment type
                <Select
                  className="mt-1"
                  value={employmentType}
                  onChange={(event) =>
                    setEmploymentType(event.target.value as EmploymentType)
                  }
                >
                  <option value="FULL_TIME_PERMANENT">
                    Full-time permanent
                  </option>
                  <option value="PART_TIME">Part-time</option>
                  <option value="CONTRACT">Contract</option>
                  <option value="INTERN">Intern</option>
                </Select>
              </label>
              <label className="text-sm font-medium">
                Target joining date
                <Input
                  className="mt-1"
                  type="date"
                  value={targetJoiningDate}
                  onChange={(event) => setTargetJoiningDate(event.target.value)}
                />
              </label>
              <label className="text-sm font-medium">
                Annual CTC budget (₹)
                <Input
                  className="mt-1"
                  type="number"
                  min={1}
                  step="0.01"
                  value={budgetAnnualCtc}
                  onChange={(event) => setBudgetAnnualCtc(event.target.value)}
                  required
                />
              </label>
              <label className="text-sm font-medium sm:col-span-2">
                Business justification
                <Textarea
                  className="mt-1"
                  value={justification}
                  onChange={(event) => setJustification(event.target.value)}
                  rows={4}
                  required
                />
              </label>
              <label className="text-sm font-medium sm:col-span-2">
                Key responsibilities
                <Textarea
                  className="mt-1"
                  value={keyResponsibilities}
                  onChange={(event) =>
                    setKeyResponsibilities(event.target.value)
                  }
                  rows={4}
                  required
                />
              </label>
              <label className="text-sm font-medium sm:col-span-2">
                Key performance indicators (KPIs)
                <Textarea
                  className="mt-1"
                  value={keyPerformanceIndicators}
                  onChange={(event) =>
                    setKeyPerformanceIndicators(event.target.value)
                  }
                  rows={4}
                  required
                />
              </label>
              <div className="sm:col-span-2">
                <Button type="submit">Submit requisition</Button>
              </div>
            </form>
          </CardContent>
        </Card>
      )}

      {queue.length > 0 && (
        <RequisitionTable
          title={
            isSuperAdmin
              ? 'Awaiting final CEO approval'
              : 'Awaiting your vertical-owner approval'
          }
          items={queue}
          numberFormatStyle={numberFormatStyle}
          onView={setViewing}
          actions={(requisition) => (
            <>
              <Button size="sm" onClick={() => decide(requisition, true)}>
                Approve
              </Button>
              <Button
                size="sm"
                variant="destructive"
                onClick={() => decide(requisition, false)}
              >
                Reject
              </Button>
            </>
          )}
        />
      )}

      <RegisterToolbar
        title="Requisition Register"
        search={search}
        onSearchChange={(value) => {
          setSearch(value);
          setPage(1);
        }}
        searchPlaceholder="Search requester, position, candidate or stage"
      />
      <RequisitionTable
        title="All visible requisitions"
        items={pageItems}
        numberFormatStyle={numberFormatStyle}
        onView={setViewing}
        actions={(requisition) =>
          requisition.requestedBy.id === user?.sub &&
          ['PENDING_VERTICAL_APPROVAL', 'PENDING_SUPERADMIN_APPROVAL'].includes(
            requisition.status,
          ) ? (
            <Button
              size="sm"
              variant="destructive"
              onClick={() => cancelReq(requisition)}
            >
              Cancel
            </Button>
          ) : null
        }
      />
      <RegisterPagination
        page={page}
        pageCount={pageCount}
        onPageChange={setPage}
      />
      <RequisitionDetailsDialog
        requisition={viewing}
        onClose={() => setViewing(null)}
        onUpdated={load}
        canEditLifecycle={isHrStaff}
        numberFormatStyle={numberFormatStyle}
      />
    </PageContainer>
  );
}

function RequisitionTable({
  title,
  items,
  numberFormatStyle,
  onView,
  actions,
}: {
  title: string;
  items: Requisition[];
  numberFormatStyle: 'india' | 'international';
  onView: (requisition: Requisition) => void;
  actions?: (requisition: Requisition) => React.ReactNode;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
      </CardHeader>
      <CardContent className="p-0">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Requisition</TableHead>
              <TableHead>Position</TableHead>
              <TableHead>Requester</TableHead>
              <TableHead className="text-right">Annual CTC budget</TableHead>
              <TableHead>Hiring status</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {items.map((requisition) => (
              <TableRow key={requisition.id}>
                <TableCell className="font-medium">
                  {requisition.requisitionNumber}
                  <span className="block text-xs text-muted-foreground">
                    {requisition.vertical.name}
                  </span>
                </TableCell>
                <TableCell>
                  {requisition.positionTitle}
                  <span className="block text-xs text-muted-foreground">
                    {requisition.employmentType.replaceAll('_', ' ')}
                  </span>
                </TableCell>
                <TableCell>
                  {requisition.requestedBy.firstName}{' '}
                  {requisition.requestedBy.lastName}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {formatINR(requisition.budgetAnnualCtc, numberFormatStyle)}
                </TableCell>
                <TableCell>
                  <Badge
                    variant={
                      lifecycleLabel(requisition) === 'FULFILLED'
                        ? 'success'
                        : 'secondary'
                    }
                  >
                    {lifecycleLabel(requisition)}
                  </Badge>
                  {requisition.selectedCandidateName && (
                    <p className="mt-1 text-xs text-muted-foreground">
                      {requisition.selectedCandidateName}
                    </p>
                  )}
                </TableCell>
                <TableCell className="space-x-2 text-right">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => onView(requisition)}
                  >
                    View
                  </Button>
                  {actions?.(requisition)}
                </TableCell>
              </TableRow>
            ))}
            {!items.length && (
              <TableRow>
                <TableCell colSpan={6} className="p-0">
                  <EmptyState
                    icon={ClipboardCheck}
                    title="No requisitions found"
                    tone="positive"
                  />
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}

function RequisitionDetailsDialog({
  requisition,
  onClose,
  onUpdated,
  canEditLifecycle,
  numberFormatStyle,
}: {
  requisition: Requisition | null;
  onClose: () => void;
  onUpdated: () => Promise<void>;
  canEditLifecycle: boolean;
  numberFormatStyle: 'india' | 'international';
}) {
  const toast = useToast();
  const [stage, setStage] = useState<HiringStage>('JOB_POSTED');
  const [candidateName, setCandidateName] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setStage(requisition?.hiringStage ?? 'JOB_POSTED');
    setCandidateName(requisition?.selectedCandidateName ?? '');
  }, [requisition]);

  async function saveLifecycle() {
    if (!requisition) return;
    if (stage === 'CANDIDATE_SELECTED' && !candidateName.trim()) {
      toast.error(
        'Enter the selected candidate name to fulfil the requisition',
      );
      return;
    }
    setSaving(true);
    try {
      await apiFetch(
        `/candidate-requisitions/${requisition.id}/hiring-lifecycle`,
        {
          method: 'PATCH',
          body: JSON.stringify({
            hiringStage: stage,
            selectedCandidateName: candidateName.trim() || undefined,
          }),
        },
      );
      toast.success(
        stage === 'CANDIDATE_SELECTED'
          ? 'Requisition marked Fulfilled'
          : 'Hiring progress updated',
      );
      await onUpdated();
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : 'Update failed');
    } finally {
      setSaving(false);
    }
  }

  const editable =
    canEditLifecycle &&
    requisition?.status === 'APPROVED' &&
    requisition.hiringStage !== 'CANDIDATE_SELECTED';

  return (
    <Dialog
      open={!!requisition}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent className="max-w-2xl">
        {requisition && (
          <>
            <DialogHeader>
              <DialogTitle>
                {requisition.requisitionNumber} · {requisition.positionTitle}
              </DialogTitle>
            </DialogHeader>
            <div className="space-y-4 text-sm">
              <div className="grid grid-cols-2 gap-3">
                <Detail label="Vertical" value={requisition.vertical.name} />
                <Detail
                  label="Requester"
                  value={`${requisition.requestedBy.firstName} ${requisition.requestedBy.lastName}`}
                />
                <Detail
                  label="Employment type"
                  value={requisition.employmentType.replaceAll('_', ' ')}
                />
                <Detail
                  label="Target joining date"
                  value={
                    requisition.targetJoiningDate
                      ? new Date(
                          requisition.targetJoiningDate,
                        ).toLocaleDateString()
                      : '—'
                  }
                />
                <Detail
                  label="Annual CTC budget"
                  value={formatINR(
                    requisition.budgetAnnualCtc,
                    numberFormatStyle,
                  )}
                />
                <Detail
                  label="Current status"
                  value={lifecycleLabel(requisition)}
                />
                {requisition.selectedCandidateName && (
                  <Detail
                    label="Selected candidate"
                    value={requisition.selectedCandidateName}
                  />
                )}
                {requisition.offerLetter && (
                  <Detail label="Offer letter" value="Created" />
                )}
                {requisition.onboardedEmployee && (
                  <Detail
                    label="Onboarded employee"
                    value={`${requisition.onboardedEmployee.employeeId} · ${requisition.onboardedEmployee.firstName} ${requisition.onboardedEmployee.lastName}`}
                  />
                )}
              </div>
              <LongDetail
                label="Business justification"
                value={requisition.justification}
              />
              <LongDetail
                label="Key responsibilities"
                value={requisition.keyResponsibilities}
              />
              <LongDetail
                label="Key performance indicators (KPIs)"
                value={requisition.keyPerformanceIndicators}
              />
              {requisition.rejectionComment && (
                <LongDetail
                  label="Rejection comment"
                  value={requisition.rejectionComment}
                />
              )}
              {editable && (
                <Card>
                  <CardHeader>
                    <CardTitle>Update hiring progress</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    <label className="block text-sm font-medium">
                      Hiring stage
                      <Select
                        className="mt-1"
                        value={stage}
                        onChange={(event) =>
                          setStage(event.target.value as HiringStage)
                        }
                      >
                        {STAGES.map((option) => (
                          <option key={option.value} value={option.value}>
                            {option.label}
                          </option>
                        ))}
                      </Select>
                    </label>
                    {stage === 'CANDIDATE_SELECTED' && (
                      <label className="block text-sm font-medium">
                        Selected candidate name
                        <Input
                          className="mt-1"
                          value={candidateName}
                          onChange={(event) =>
                            setCandidateName(event.target.value)
                          }
                          required
                        />
                      </label>
                    )}
                    <Button onClick={saveLifecycle} disabled={saving}>
                      {saving ? 'Saving…' : 'Save progress'}
                    </Button>
                  </CardContent>
                </Card>
              )}
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={onClose}>
                Close
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-xs uppercase tracking-wide text-muted-foreground">
        {label}
      </p>
      <p className="mt-0.5 font-medium">{value}</p>
    </div>
  );
}

function LongDetail({ label, value }: { label: string; value: string | null }) {
  return (
    <div>
      <p className="text-xs uppercase tracking-wide text-muted-foreground">
        {label}
      </p>
      <p className="mt-0.5 whitespace-pre-wrap">{value || '—'}</p>
    </div>
  );
}
