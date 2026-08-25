'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import {
  AlertTriangle,
  ArrowLeft,
  LayoutGrid,
  Plus,
  Rocket,
  Trash2,
  X,
} from 'lucide-react';
import { ApiError } from '../../../lib/api';
import { useAuth } from '../../../lib/auth-context';
import { useIsProjectManager } from '../../../lib/use-is-project-manager';
import {
  addActionItem,
  addAttendee,
  addMilestone,
  addRisk,
  DELIVERY_TYPE_LABEL,
  getKickoff,
  listKickoffMilestoneTemplates,
  MEETING_MODE_LABEL,
  removeActionItem,
  removeAttendee,
  removeMilestone,
  removeRisk,
  updateDeliveryItem,
  updateKickoff,
  updateMilestone,
  updateRisk,
  type DeliverySplitInput,
  type DeliveryType,
  type KickoffDeliveryItem,
  type KickoffDeliverySplit,
  type KickoffMeetingMode,
  type KickoffMilestoneTemplate,
  type MilestoneStatus,
  type ProjectKickoff,
  type RiskLevel,
  type RiskStatus,
} from '../../../lib/project-kickoff';
import { listMembers, type KanbanBoardMember } from '../../../lib/kanban';
import {
  listVendors,
  VENDOR_STATUS_LABEL,
  type VendorStatus,
} from '../../../lib/scm';
import type { EmployeeSearchResult } from '../../../lib/types';
import { PageContainer } from '../../../components/ui/page-container';
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
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../../../components/ui/dialog';
import { Skeleton } from '../../../components/ui/skeleton';
import { StatusBadge } from '../../../components/ui/status-badge';
import { ProcessFlow } from '../../../components/ui/process-flow';
import { kickoffFlow } from '../../../lib/record-flows';
import { EmptyState } from '../../../components/ui/empty-state';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '../../../components/ui/table';
import { useToast } from '../../../components/ui/toaster';
import { useConfirm } from '../../../components/ui/confirm';
import { EmployeePicker } from '../../vault/_components/employee-picker';
import { KickoffPrintDocument } from '../_components/kickoff-print-document';
import { StockAvailabilitySection } from '../_components/stock-availability-section';
import { SignedConfirmationSheetCard } from '../_components/signed-confirmation-sheet-card';

function fmtDate(iso: string | null): string {
  return iso ? new Date(iso).toLocaleDateString() : '—';
}

export default function KickoffDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const toast = useToast();
  const confirm = useConfirm();
  const { user } = useAuth();
  const { isProjectManager } = useIsProjectManager();

  const [kickoff, setKickoff] = useState<ProjectKickoff | null>(null);
  const [members, setMembers] = useState<KanbanBoardMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [forbidden, setForbidden] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Overdue-draft nudge: dismissible for this page visit only (no persistence
  // precedent elsewhere in the app) — reappears on next visit/reload if the
  // kickoff is still Draft, since the underlying condition hasn't changed.
  const [nudgeDismissed, setNudgeDismissed] = useState(false);

  /**
   * Fetch the kickoff (+ board members). `showSkeleton` controls whether the
   * whole-page loading skeleton is shown: true only on the INITIAL mount. After
   * a mutation, sections call refresh() (showSkeleton=false) so the page updates
   * in place WITHOUT the skeleton early-return remounting the tree — which would
   * otherwise reset the scroll position to the top on every edit.
   */
  const fetchKickoff = useCallback(
    async (showSkeleton: boolean) => {
      if (showSkeleton) setLoading(true);
      setError(null);
      try {
        const k = await getKickoff(id);
        setKickoff(k);
        // Board members drive the action-item owner picker (owner must be a
        // board member). Best-effort — a failure just yields an empty picker.
        try {
          setMembers(await listMembers(k.kanbanBoardId));
        } catch {
          setMembers([]);
        }
      } catch (err) {
        if (
          err instanceof ApiError &&
          (err.statusCode === 403 || err.statusCode === 404)
        ) {
          setForbidden(true);
        } else {
          setError('Failed to load kickoff.');
        }
      } finally {
        if (showSkeleton) setLoading(false);
      }
    },
    [id],
  );

  // Initial load shows the skeleton; post-mutation refreshes are silent.
  const load = useCallback(() => fetchKickoff(true), [fetchKickoff]);
  const refresh = useCallback(() => fetchKickoff(false), [fetchKickoff]);

  useEffect(() => {
    void load();
  }, [load]);

  function printKickoff() {
    const previous = document.title;
    document.title = 'System generated by PhazeOne';
    const restore = () => {
      document.title = previous;
      window.removeEventListener('afterprint', restore);
    };
    window.addEventListener('afterprint', restore);
    window.print();
    setTimeout(restore, 1000);
  }

  if (loading) {
    return (
      <PageContainer>
        <Skeleton className="mb-4 h-6 w-24" />
        <Skeleton className="mb-6 h-9 w-72" />
        <Skeleton className="h-48 w-full" />
      </PageContainer>
    );
  }

  if (forbidden) {
    return (
      <PageContainer>
        <EmptyState
          icon={Rocket}
          title="You don’t have access to this kickoff"
          description="Only the creator, internal attendees, or the CEO can view this record."
        />
        <div className="mt-4 flex justify-center">
          <Button
            variant="outline"
            onClick={() => router.push('/project-kickoff')}
          >
            Back to kickoffs
          </Button>
        </div>
      </PageContainer>
    );
  }

  if (error || !kickoff) {
    return (
      <PageContainer>
        <p className="text-destructive">{error ?? 'Kickoff not found'}</p>
      </PageContainer>
    );
  }

  const canManageStatus =
    user?.role === 'SUPER_ADMIN' || kickoff.createdById === user?.sub;
  // Write access to every kickoff section (overview, attendees, milestones,
  // action items, risks, delivery classification, minutes) — mirrors the
  // backend's assertCanManage: Project Manager or SUPER_ADMIN only. Everyone
  // else who can view the kickoff (e.g. an internal attendee) is read-only.
  const canManage = user?.role === 'SUPER_ADMIN' || isProjectManager;

  async function toggleCompleted() {
    if (!kickoff) return;
    const completing = kickoff.status !== 'COMPLETED';
    const next = completing ? 'COMPLETED' : 'DRAFT';
    const ok = await confirm(
      completing
        ? {
            title: 'Mark this kickoff as completed?',
            confirmLabel: 'Mark Completed',
          }
        : {
            title: 'Revert to Draft?',
            description:
              'This kickoff is marked Completed. Revert it to Draft?',
            confirmLabel: 'Revert to Draft',
            destructive: true,
          },
    );
    if (!ok) return;
    try {
      const updated = await updateKickoff(kickoff.id, { status: next });
      setKickoff((prev) => (prev ? { ...prev, status: updated.status } : prev));
    } catch (err) {
      toast.error(
        err instanceof ApiError ? err.message : 'Failed to update status.',
      );
    }
  }

  // Overdue-draft nudge condition — mirrors the "don't trust dates alone"
  // principle used for project health: a past meetingDate is only meaningful
  // combined with the record's own status (still DRAFT). This NEVER writes
  // back to kickoff.status — it's a pure, ephemeral read-time signal, exactly
  // like the overdue-milestone/action/risk flags in project-progress.ts.
  const isOverdueDraft =
    kickoff.status === 'DRAFT' &&
    new Date(kickoff.meetingDate).getTime() < Date.now();

  return (
    <>
      <KickoffPrintDocument kickoff={kickoff} />

      <PageContainer>
        <Link
          href="/project-kickoff"
          className="mb-4 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="size-4" /> Project Kickoff
        </Link>

        {/* ── Header ── */}
        <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="flex flex-wrap items-center gap-3">
              <h1 className="text-2xl font-semibold tracking-tight">
                {kickoff.projectName}
              </h1>
              <StatusBadge value={kickoff.status} />
            </div>
            <p className="mt-1 text-sm text-muted-foreground">
              <Link
                href={`/sales/orders/${kickoff.orderId}`}
                className="text-primary underline-offset-4 hover:underline"
              >
                View order
              </Link>{' '}
              · {fmtDate(kickoff.meetingDate)} ·{' '}
              {MEETING_MODE_LABEL[kickoff.meetingMode]}
              {kickoff.meetingLocation ? ` · ${kickoff.meetingLocation}` : ''}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {canManageStatus && (
              <Button variant="outline" onClick={toggleCompleted}>
                {kickoff.status === 'COMPLETED'
                  ? 'Mark as Draft'
                  : 'Mark Completed'}
              </Button>
            )}
            <Button
              variant="outline"
              onClick={() =>
                router.push(`/kanban/boards/${kickoff.kanbanBoardId}`)
              }
            >
              <LayoutGrid className="size-4" /> View Project Board
            </Button>
            <Button variant="outline" onClick={printKickoff}>
              Download PDF
            </Button>
          </div>
        </div>

        {/* Overdue-draft nudge — a visible reminder, never an automatic status
            change. Dismissible for this visit; reappears next time if still
            unaddressed, since the condition itself hasn't changed. */}
        {isOverdueDraft && !nudgeDismissed && (
          <div className="mb-4 flex items-start gap-2 rounded-md border border-warning/40 bg-warning/10 p-3 text-sm">
            <AlertTriangle className="mt-0.5 size-4 shrink-0 text-warning" />
            <div className="flex-1">
              <p className="font-medium">
                This kickoff&apos;s meeting date has passed — mark it as
                completed?
              </p>
            </div>
            {canManageStatus && (
              <Button size="sm" variant="outline" onClick={toggleCompleted}>
                Mark Completed
              </Button>
            )}
            <button
              type="button"
              aria-label="Dismiss"
              onClick={() => setNudgeDismissed(true)}
              className="shrink-0 text-muted-foreground hover:text-foreground"
            >
              <X className="size-4" />
            </button>
          </div>
        )}

        {/* Live flow indicator — stage derived from status + attendee/action counts. */}
        <ProcessFlow
          title="Kickoff progress"
          className="mb-4"
          {...kickoffFlow({
            status: kickoff.status,
            attendeeCount: kickoff.attendees?.length ?? 0,
            actionItemCount: kickoff.actionItems?.length ?? 0,
          })}
        />

        <SignedConfirmationSheetCard kickoffId={kickoff.id} />
        {!!kickoff.priorBidStrategyMeetings?.length && (
          <Card>
            <CardHeader>
              <CardTitle>Pre-bid Strategy Context</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 pt-0">
              <p className="text-sm text-muted-foreground">
                Read-only context from discussions held before this order was won.
                It does not affect the Project Kickoff workflow.
              </p>
              {kickoff.priorBidStrategyMeetings.map((meeting) => (
                <div key={meeting.id} className="flex flex-wrap items-center justify-between gap-3 rounded-md border p-3 text-sm">
                  <div>
                    <strong>{new Date(meeting.meetingDate).toLocaleString()}</strong>
                    <p className="line-clamp-2 text-muted-foreground">{meeting.notes}</p>
                  </div>
                  <Button variant="outline" onClick={() => router.push(`/sales/bids/${meeting.bidId}#strategy-meetings`)}>
                    View {meeting.bidNumber}
                  </Button>
                </div>
              ))}
            </CardContent>
          </Card>
        )}
        <OverviewSection
          kickoff={kickoff}
          canManage={canManage}
          onSaved={(k) => setKickoff(k)}
        />
        <VendorCadenceSection
          kickoff={kickoff}
          canManage={canManage}
          onSaved={setKickoff}
        />
        <DeliveryClassificationSection
          kickoff={kickoff}
          canManage={canManage}
          onChanged={refresh}
        />
        <AttendeesSection
          kickoff={kickoff}
          canManage={canManage}
          onChanged={refresh}
        />
        <MilestonesSection
          kickoff={kickoff}
          canManage={canManage}
          onChanged={refresh}
        />
        <ActionItemsSection
          kickoff={kickoff}
          members={members}
          canManage={canManage}
          onChanged={refresh}
        />
        <RisksSection
          kickoff={kickoff}
          canManage={canManage}
          onChanged={refresh}
        />
        <StockAvailabilitySection
          kickoffId={kickoff.id}
          supplyInScope={kickoff.supplyInScope}
          canManage={canManage}
          onSupplyInScopeChanged={(updated) => setKickoff(updated)}
        />
        <MinutesSection
          kickoff={kickoff}
          canManage={canManage}
          onSaved={(k) => setKickoff(k)}
        />
      </PageContainer>
    </>
  );
}

function VendorCadenceSection({
  kickoff,
  canManage,
  onSaved,
}: {
  kickoff: ProjectKickoff;
  canManage: boolean;
  onSaved: (kickoff: ProjectKickoff) => void;
}) {
  const toast = useToast();
  const [days, setDays] = useState(kickoff.vendorUpdateCadenceDays);
  const [saving, setSaving] = useState(false);

  async function save() {
    setSaving(true);
    try {
      const updated = await updateKickoff(kickoff.id, {
        vendorUpdateCadenceDays: Math.max(1, days),
      });
      onSaved(updated);
      toast.success('Vendor update cadence saved.');
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : 'Save failed.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card className="mb-4">
      <CardHeader>
        <CardTitle>Vendor update cadence</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="flex max-w-md items-end gap-3">
          <label className="flex-1 text-sm font-medium">
            Expected update every
            <div className="mt-2 flex items-center gap-2">
              <Input
                type="number"
                min={1}
                disabled={!canManage}
                value={days}
                onChange={(event) =>
                  setDays(Math.max(1, Number(event.target.value) || 1))
                }
              />
              <span className="text-muted-foreground">day(s)</span>
            </div>
          </label>
          {canManage && (
            <Button
              onClick={save}
              disabled={saving || days === kickoff.vendorUpdateCadenceDays}
            >
              {saving ? 'Saving…' : 'Save'}
            </Button>
          )}
        </div>
        <p className="mt-2 text-xs text-muted-foreground">
          Applies to every Vendor-flow tracker. Full updates and quick comments
          both reset the clock.
        </p>
      </CardContent>
    </Card>
  );
}

// ── Overview & scope ─────────────────────────────────────────────────
function OverviewSection({
  kickoff,
  canManage,
  onSaved,
}: {
  kickoff: ProjectKickoff;
  canManage: boolean;
  onSaved: (k: ProjectKickoff) => void;
}) {
  const toast = useToast();
  const [text, setText] = useState(kickoff.overviewAndScope ?? '');
  const [saving, setSaving] = useState(false);
  const dirty = text !== (kickoff.overviewAndScope ?? '');

  async function save() {
    setSaving(true);
    try {
      const updated = await updateKickoff(kickoff.id, {
        overviewAndScope: text || null,
      });
      onSaved(updated);
      toast.success('Overview saved.');
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Save failed.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card className="mb-4">
      <CardHeader>
        <CardTitle>Overview &amp; Scope</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 pt-0">
        <Textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={4}
          placeholder="Project overview and scope…"
          disabled={!canManage}
        />
        {dirty && canManage && (
          <Button size="sm" onClick={save} disabled={saving}>
            {saving ? 'Saving…' : 'Save'}
          </Button>
        )}
      </CardContent>
    </Card>
  );
}

// ── Attendees ────────────────────────────────────────────────────────
function AttendeesSection({
  kickoff,
  canManage,
  onChanged,
}: {
  kickoff: ProjectKickoff;
  canManage: boolean;
  onChanged: () => void;
}) {
  const toast = useToast();
  const confirm = useConfirm();
  const [mode, setMode] = useState<'none' | 'internal' | 'external'>('none');
  const [ext, setExt] = useState({
    externalName: '',
    externalOrganization: '',
    designation: '',
  });
  const [busy, setBusy] = useState(false);
  const attendees = kickoff.attendees ?? [];

  async function addInternal(e: EmployeeSearchResult) {
    setBusy(true);
    try {
      await addAttendee(kickoff.id, {
        employeeId: e.id,
        designation: undefined,
      });
      setMode('none');
      onChanged();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Failed to add.');
    } finally {
      setBusy(false);
    }
  }

  async function addExternal() {
    if (!ext.externalName.trim()) return;
    setBusy(true);
    try {
      await addAttendee(kickoff.id, {
        externalName: ext.externalName.trim(),
        externalOrganization: ext.externalOrganization.trim() || undefined,
        designation: ext.designation.trim() || undefined,
      });
      setExt({ externalName: '', externalOrganization: '', designation: '' });
      setMode('none');
      onChanged();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Failed to add.');
    } finally {
      setBusy(false);
    }
  }

  async function remove(attendeeId: string, name: string | null) {
    if (
      !(await confirm({
        title: 'Remove attendee?',
        description: `${name ?? 'This attendee'} will be removed from the record.`,
        confirmLabel: 'Remove',
        destructive: true,
      }))
    )
      return;
    try {
      await removeAttendee(kickoff.id, attendeeId);
      onChanged();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Failed to remove.');
    }
  }

  return (
    <Card className="mb-4">
      <CardHeader className="flex-row items-center justify-between space-y-0">
        <CardTitle>Attendees</CardTitle>
        {canManage && (
          <div className="flex gap-2">
            <Button
              size="sm"
              variant="outline"
              onClick={() => setMode('internal')}
            >
              <Plus className="size-4" /> Internal
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => setMode('external')}
            >
              <Plus className="size-4" /> External
            </Button>
          </div>
        )}
      </CardHeader>
      <CardContent className="pt-0">
        {canManage && mode === 'internal' && (
          <div className="mb-3 rounded-md border p-3">
            <p className="mb-2 text-xs text-muted-foreground">
              Internal attendees are also added to the project board.
            </p>
            <EmployeePicker
              onSelect={addInternal}
              excludeIds={attendees
                .filter((a) => a.employeeId)
                .map((a) => a.employeeId as string)}
            />
          </div>
        )}
        {canManage && mode === 'external' && (
          <div className="mb-3 grid gap-2 rounded-md border p-3 sm:grid-cols-3">
            <Input
              placeholder="Name"
              value={ext.externalName}
              onChange={(e) => setExt({ ...ext, externalName: e.target.value })}
            />
            <Input
              placeholder="Organization"
              value={ext.externalOrganization}
              onChange={(e) =>
                setExt({ ...ext, externalOrganization: e.target.value })
              }
            />
            <Input
              placeholder="Designation"
              value={ext.designation}
              onChange={(e) => setExt({ ...ext, designation: e.target.value })}
            />
            <div className="sm:col-span-3">
              <Button
                size="sm"
                onClick={addExternal}
                disabled={busy || !ext.externalName.trim()}
              >
                Add attendee
              </Button>
            </div>
          </div>
        )}

        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Organization</TableHead>
              <TableHead>Designation</TableHead>
              <TableHead>Department</TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {attendees.length === 0 ? (
              <TableRow>
                <TableCell
                  colSpan={5}
                  className="text-center text-muted-foreground"
                >
                  No attendees yet.
                </TableCell>
              </TableRow>
            ) : (
              attendees.map((a) => (
                <TableRow key={a.id}>
                  <TableCell className="font-medium">
                    {a.name ?? '—'}
                    {a.isInternal && (
                      <span className="ml-2 text-xs text-muted-foreground">
                        (internal)
                      </span>
                    )}
                  </TableCell>
                  <TableCell>{a.externalOrganization ?? '—'}</TableCell>
                  <TableCell>{a.designation ?? '—'}</TableCell>
                  <TableCell>{a.department ?? '—'}</TableCell>
                  <TableCell className="text-right">
                    {canManage && (
                      <Button
                        variant="ghost"
                        size="icon"
                        aria-label="Remove attendee"
                        onClick={() => remove(a.id, a.name)}
                      >
                        <Trash2 className="size-4" />
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}

// ── Milestones ───────────────────────────────────────────────────────
const MILESTONE_STATUSES: MilestoneStatus[] = [
  'PENDING',
  'IN_PROGRESS',
  'COMPLETED',
  'DELAYED',
];

// Sentinel for the "Other (custom)" dropdown option — reveals a free-text input.
const MILESTONE_OTHER = '__other__';

function MilestonesSection({
  kickoff,
  canManage,
  onChanged,
}: {
  kickoff: ProjectKickoff;
  canManage: boolean;
  onChanged: () => void;
}) {
  const toast = useToast();
  const confirm = useConfirm();
  const [adding, setAdding] = useState(false);
  // `choice` holds the selected template name, MILESTONE_OTHER, or '' (none).
  // `customName` is the free-text value used only when choice === MILESTONE_OTHER.
  const [form, setForm] = useState({
    choice: '',
    customName: '',
    targetDate: '',
  });
  const [owner, setOwner] = useState<{ id: string; name: string } | null>(
    null,
  );
  const [editingOwnerFor, setEditingOwnerFor] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [templates, setTemplates] = useState<KickoffMilestoneTemplate[]>([]);
  const milestones = kickoff.milestones ?? [];

  // Standard-milestone suggestions for this kickoff (union of active templates
  // across the order lines' delivery types). Fetched once; the dropdown falls
  // back to free-text-only when there are none (e.g. no classified lines yet).
  useEffect(() => {
    if (!canManage) return;
    let cancelled = false;
    listKickoffMilestoneTemplates(kickoff.id)
      .then((t) => {
        if (!cancelled) setTemplates(t);
      })
      .catch(() => {
        /* non-fatal — the free-text path still works */
      });
    return () => {
      cancelled = true;
    };
  }, [kickoff.id, canManage]);

  const effectiveName =
    form.choice === MILESTONE_OTHER ? form.customName.trim() : form.choice;

  async function add() {
    if (!effectiveName || !form.targetDate) return;
    setBusy(true);
    try {
      await addMilestone(kickoff.id, {
        name: effectiveName,
        targetDate: form.targetDate,
        ...(owner ? { ownerId: owner.id } : {}),
      });
      setForm({ choice: '', customName: '', targetDate: '' });
      setOwner(null);
      setAdding(false);
      onChanged();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Failed to add.');
    } finally {
      setBusy(false);
    }
  }

  async function setStatus(milestoneId: string, status: MilestoneStatus) {
    try {
      await updateMilestone(kickoff.id, milestoneId, { status });
      onChanged();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Update failed.');
    }
  }

  async function setMilestoneOwner(
    milestoneId: string,
    ownerId: string | null,
  ) {
    try {
      await updateMilestone(kickoff.id, milestoneId, { ownerId });
      setEditingOwnerFor(null);
      onChanged();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Update failed.');
    }
  }

  async function remove(milestoneId: string) {
    if (
      !(await confirm({
        title: 'Delete milestone?',
        confirmLabel: 'Delete',
        destructive: true,
      }))
    )
      return;
    try {
      await removeMilestone(kickoff.id, milestoneId);
      onChanged();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Delete failed.');
    }
  }

  return (
    <Card className="mb-4">
      <CardHeader className="flex-row items-center justify-between space-y-0">
        <CardTitle>Milestones</CardTitle>
        {canManage && (
          <Button
            size="sm"
            variant="outline"
            onClick={() => setAdding((v) => !v)}
          >
            <Plus className="size-4" /> Add
          </Button>
        )}
      </CardHeader>
      <CardContent className="pt-0">
        {canManage && adding && (
          <div className="mb-3 flex flex-wrap items-end gap-2 rounded-md border p-3">
            {templates.length > 0 ? (
              <Select
                aria-label="Milestone"
                value={form.choice}
                onChange={(e) =>
                  setForm({ ...form, choice: e.target.value, customName: '' })
                }
                className="w-64"
              >
                <option value="">Select a milestone…</option>
                {templates.map((t) => (
                  <option key={t.name} value={t.name}>
                    {t.name}
                  </option>
                ))}
                <option value={MILESTONE_OTHER}>Other (custom)…</option>
              </Select>
            ) : (
              // No templates apply (e.g. no classified lines) — free text only.
              <Input
                placeholder="Milestone name"
                value={form.customName}
                onChange={(e) =>
                  setForm({
                    ...form,
                    choice: MILESTONE_OTHER,
                    customName: e.target.value,
                  })
                }
                className="max-w-xs"
              />
            )}
            {templates.length > 0 && form.choice === MILESTONE_OTHER && (
              <Input
                placeholder="Custom milestone name"
                value={form.customName}
                onChange={(e) =>
                  setForm({ ...form, customName: e.target.value })
                }
                className="max-w-xs"
                autoFocus
              />
            )}
            <Input
              type="date"
              value={form.targetDate}
              onChange={(e) => setForm({ ...form, targetDate: e.target.value })}
              className="w-44"
            />
            {owner ? (
              <span className="inline-flex h-9 items-center gap-2 rounded-md border px-2.5 text-sm">
                {owner.name}
                <button
                  type="button"
                  aria-label="Clear owner"
                  className="text-muted-foreground hover:text-foreground"
                  onClick={() => setOwner(null)}
                >
                  ✕
                </button>
              </span>
            ) : (
              <div className="w-56">
                <EmployeePicker
                  onSelect={(e) => setOwner({ id: e.id, name: e.fullName })}
                />
              </div>
            )}
            <Button
              size="sm"
              onClick={add}
              disabled={busy || !effectiveName || !form.targetDate}
            >
              Add
            </Button>
          </div>
        )}
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Milestone</TableHead>
              <TableHead>Target date</TableHead>
              <TableHead>Owner</TableHead>
              <TableHead>Status</TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {milestones.length === 0 ? (
              <TableRow>
                <TableCell
                  colSpan={5}
                  className="text-center text-muted-foreground"
                >
                  No milestones yet.
                </TableCell>
              </TableRow>
            ) : (
              milestones.map((m) => (
                <TableRow key={m.id}>
                  <TableCell className="font-medium">{m.name}</TableCell>
                  <TableCell>{fmtDate(m.targetDate)}</TableCell>
                  <TableCell>
                    {editingOwnerFor === m.id ? (
                      <div className="flex items-center gap-1.5">
                        <div className="w-56">
                          <EmployeePicker
                            onSelect={(e) =>
                              void setMilestoneOwner(m.id, e.id)
                            }
                          />
                        </div>
                        <button
                          type="button"
                          aria-label="Cancel owner change"
                          className="text-muted-foreground hover:text-foreground"
                          onClick={() => setEditingOwnerFor(null)}
                        >
                          ✕
                        </button>
                      </div>
                    ) : (
                      <div className="flex items-center gap-1.5">
                        <span>{m.ownerName ?? '—'}</span>
                        {canManage && (
                          <>
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-7 px-2 text-xs text-muted-foreground"
                              onClick={() => setEditingOwnerFor(m.id)}
                            >
                              {m.ownerName ? 'Change' : 'Assign'}
                            </Button>
                            {m.ownerName && (
                              <button
                                type="button"
                                aria-label="Unassign owner"
                                className="text-xs text-muted-foreground hover:text-foreground"
                                onClick={() => void setMilestoneOwner(m.id, null)}
                              >
                                ✕
                              </button>
                            )}
                          </>
                        )}
                      </div>
                    )}
                  </TableCell>
                  <TableCell>
                    <Select
                      value={m.status}
                      onChange={(e) =>
                        setStatus(m.id, e.target.value as MilestoneStatus)
                      }
                      className="h-8 w-40"
                      disabled={!canManage}
                    >
                      {MILESTONE_STATUSES.map((s) => (
                        <option key={s} value={s}>
                          {s.replace('_', ' ')}
                        </option>
                      ))}
                    </Select>
                  </TableCell>
                  <TableCell className="text-right">
                    {canManage && (
                      <Button
                        variant="ghost"
                        size="icon"
                        aria-label="Delete milestone"
                        onClick={() => remove(m.id)}
                      >
                        <Trash2 className="size-4" />
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}

// ── Action items ─────────────────────────────────────────────────────
function ActionItemsSection({
  kickoff,
  members,
  canManage,
  onChanged,
}: {
  kickoff: ProjectKickoff;
  members: KanbanBoardMember[];
  canManage: boolean;
  onChanged: () => void;
}) {
  const router = useRouter();
  const toast = useToast();
  const confirm = useConfirm();
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState({
    description: '',
    ownerId: '',
    dueDate: '',
  });
  const [busy, setBusy] = useState(false);
  const items = kickoff.actionItems ?? [];

  async function add() {
    if (!form.description.trim() || !form.ownerId) return;
    setBusy(true);
    try {
      await addActionItem(kickoff.id, {
        description: form.description.trim(),
        ownerId: form.ownerId,
        dueDate: form.dueDate || undefined,
      });
      setForm({ description: '', ownerId: '', dueDate: '' });
      setAdding(false);
      onChanged();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Failed to add.');
    } finally {
      setBusy(false);
    }
  }

  async function remove(actionItemId: string) {
    if (
      !(await confirm({
        title: 'Delete action item?',
        description: 'The linked board card will be archived.',
        confirmLabel: 'Delete',
        destructive: true,
      }))
    )
      return;
    try {
      await removeActionItem(kickoff.id, actionItemId);
      onChanged();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Delete failed.');
    }
  }

  return (
    <Card className="mb-4">
      <CardHeader className="flex-row items-center justify-between space-y-0">
        <CardTitle>Action Items</CardTitle>
        {canManage && (
          <Button
            size="sm"
            variant="outline"
            onClick={() => setAdding((v) => !v)}
          >
            <Plus className="size-4" /> Add
          </Button>
        )}
      </CardHeader>
      <CardContent className="pt-0">
        {canManage && adding && (
          <div className="mb-3 flex flex-wrap items-end gap-2 rounded-md border p-3">
            <Input
              placeholder="Description"
              value={form.description}
              onChange={(e) =>
                setForm({ ...form, description: e.target.value })
              }
              className="min-w-[240px] flex-1"
            />
            <Select
              value={form.ownerId}
              onChange={(e) => setForm({ ...form, ownerId: e.target.value })}
              className="h-9 w-52"
            >
              <option value="">Owner (board member)…</option>
              {members.map((m) => (
                <option key={m.employeeId} value={m.employeeId}>
                  {m.employeeName ?? m.employeeEmail}
                </option>
              ))}
            </Select>
            <Input
              type="date"
              value={form.dueDate}
              onChange={(e) => setForm({ ...form, dueDate: e.target.value })}
              className="w-44"
            />
            <Button
              size="sm"
              onClick={add}
              disabled={busy || !form.description.trim() || !form.ownerId}
            >
              Add
            </Button>
          </div>
        )}
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Description</TableHead>
              <TableHead>Owner</TableHead>
              <TableHead>Due date</TableHead>
              <TableHead>Status</TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {items.length === 0 ? (
              <TableRow>
                <TableCell
                  colSpan={5}
                  className="text-center text-muted-foreground"
                >
                  No action items yet.
                </TableCell>
              </TableRow>
            ) : (
              items.map((i) => (
                <TableRow key={i.id}>
                  <TableCell className="font-medium">
                    {i.kanbanCardId ? (
                      <button
                        type="button"
                        onClick={() =>
                          router.push(`/kanban/cards/${i.kanbanCardId}`)
                        }
                        className="text-left text-primary underline-offset-4 hover:underline"
                      >
                        {i.description}
                      </button>
                    ) : (
                      i.description
                    )}
                  </TableCell>
                  <TableCell>{i.ownerName ?? '—'}</TableCell>
                  <TableCell>{fmtDate(i.dueDate)}</TableCell>
                  <TableCell>
                    <StatusBadge value={i.status} />
                  </TableCell>
                  <TableCell className="text-right">
                    {canManage && (
                      <Button
                        variant="ghost"
                        size="icon"
                        aria-label="Delete action item"
                        onClick={() => remove(i.id)}
                      >
                        <Trash2 className="size-4" />
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}

// ── Risks ────────────────────────────────────────────────────────────
const RISK_LEVELS: RiskLevel[] = ['LOW', 'MEDIUM', 'HIGH'];
const RISK_STATUSES: RiskStatus[] = ['OPEN', 'MITIGATED', 'CLOSED'];

function RisksSection({
  kickoff,
  canManage,
  onChanged,
}: {
  kickoff: ProjectKickoff;
  canManage: boolean;
  onChanged: () => void;
}) {
  const toast = useToast();
  const confirm = useConfirm();
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState({
    description: '',
    likelihood: 'MEDIUM' as RiskLevel,
    impact: 'MEDIUM' as RiskLevel,
    mitigationPlan: '',
  });
  const [busy, setBusy] = useState(false);
  const risks = kickoff.risks ?? [];

  async function add() {
    if (!form.description.trim()) return;
    setBusy(true);
    try {
      await addRisk(kickoff.id, {
        description: form.description.trim(),
        likelihood: form.likelihood,
        impact: form.impact,
        mitigationPlan: form.mitigationPlan.trim() || undefined,
      });
      setForm({
        description: '',
        likelihood: 'MEDIUM',
        impact: 'MEDIUM',
        mitigationPlan: '',
      });
      setAdding(false);
      onChanged();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Failed to add.');
    } finally {
      setBusy(false);
    }
  }

  async function setStatus(riskId: string, status: RiskStatus) {
    try {
      await updateRisk(kickoff.id, riskId, { status });
      onChanged();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Update failed.');
    }
  }

  async function remove(riskId: string) {
    if (
      !(await confirm({
        title: 'Delete risk?',
        confirmLabel: 'Delete',
        destructive: true,
      }))
    )
      return;
    try {
      await removeRisk(kickoff.id, riskId);
      onChanged();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Delete failed.');
    }
  }

  return (
    <Card className="mb-4">
      <CardHeader className="flex-row items-center justify-between space-y-0">
        <CardTitle>Risk Register</CardTitle>
        {canManage && (
          <Button
            size="sm"
            variant="outline"
            onClick={() => setAdding((v) => !v)}
          >
            <Plus className="size-4" /> Add
          </Button>
        )}
      </CardHeader>
      <CardContent className="pt-0">
        {canManage && adding && (
          <div className="mb-3 grid gap-2 rounded-md border p-3 sm:grid-cols-2">
            <Input
              placeholder="Risk description"
              value={form.description}
              onChange={(e) =>
                setForm({ ...form, description: e.target.value })
              }
              className="sm:col-span-2"
            />
            <label className="flex items-center gap-2 text-sm">
              Likelihood
              <Select
                value={form.likelihood}
                onChange={(e) =>
                  setForm({ ...form, likelihood: e.target.value as RiskLevel })
                }
                className="h-8"
              >
                {RISK_LEVELS.map((l) => (
                  <option key={l} value={l}>
                    {l}
                  </option>
                ))}
              </Select>
            </label>
            <label className="flex items-center gap-2 text-sm">
              Impact
              <Select
                value={form.impact}
                onChange={(e) =>
                  setForm({ ...form, impact: e.target.value as RiskLevel })
                }
                className="h-8"
              >
                {RISK_LEVELS.map((l) => (
                  <option key={l} value={l}>
                    {l}
                  </option>
                ))}
              </Select>
            </label>
            <Input
              placeholder="Mitigation plan"
              value={form.mitigationPlan}
              onChange={(e) =>
                setForm({ ...form, mitigationPlan: e.target.value })
              }
              className="sm:col-span-2"
            />
            <div className="sm:col-span-2">
              <Button
                size="sm"
                onClick={add}
                disabled={busy || !form.description.trim()}
              >
                Add risk
              </Button>
            </div>
          </div>
        )}
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Description</TableHead>
              <TableHead>Likelihood</TableHead>
              <TableHead>Impact</TableHead>
              <TableHead>Mitigation</TableHead>
              <TableHead>Owner</TableHead>
              <TableHead>Status</TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {risks.length === 0 ? (
              <TableRow>
                <TableCell
                  colSpan={7}
                  className="text-center text-muted-foreground"
                >
                  No risks recorded.
                </TableCell>
              </TableRow>
            ) : (
              risks.map((r) => (
                <TableRow key={r.id}>
                  <TableCell className="font-medium">{r.description}</TableCell>
                  <TableCell>
                    <StatusBadge value={r.likelihood} />
                  </TableCell>
                  <TableCell>
                    <StatusBadge value={r.impact} />
                  </TableCell>
                  <TableCell>{r.mitigationPlan ?? '—'}</TableCell>
                  <TableCell>{r.ownerName ?? '—'}</TableCell>
                  <TableCell>
                    <Select
                      value={r.status}
                      onChange={(e) =>
                        setStatus(r.id, e.target.value as RiskStatus)
                      }
                      className="h-8 w-32"
                      disabled={!canManage}
                    >
                      {RISK_STATUSES.map((s) => (
                        <option key={s} value={s}>
                          {s}
                        </option>
                      ))}
                    </Select>
                  </TableCell>
                  <TableCell className="text-right">
                    {canManage && (
                      <Button
                        variant="ghost"
                        size="icon"
                        aria-label="Delete risk"
                        onClick={() => remove(r.id)}
                      >
                        <Trash2 className="size-4" />
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}

// ── Delivery classification (per order line item) ───────────────────
const DELIVERY_TYPES: DeliveryType[] = ['NPD', 'IN_HOUSE', 'VENDOR'];

/** Minimal Vendor Master shape for the delivery-split vendor picker. */
type VendorOption = {
  id: string;
  companyName: string;
  status?: VendorStatus;
};

function DeliveryClassificationSection({
  kickoff,
  canManage,
  onChanged,
}: {
  kickoff: ProjectKickoff;
  canManage: boolean;
  onChanged: () => void;
}) {
  const items = kickoff.deliveryItems ?? [];
  // All Vendor Master records are selectable, regardless of qualification
  // status. The status remains visible in the option label so the PM can make
  // an informed sourcing choice. Fetched once and shared across every row.
  const [vendors, setVendors] = useState<VendorOption[]>([]);
  useEffect(() => {
    let alive = true;
    void listVendors()
      .then((vendors) => {
        if (!alive) return;
        setVendors(
          vendors.map((v) => ({
            id: v.id,
            companyName: v.companyName,
            status: v.status,
          })),
        );
      })
      .catch(() => {
        /* non-fatal — the picker degrades to an empty list with guidance */
      });
    return () => {
      alive = false;
    };
  }, []);
  return (
    <Card className="mb-4">
      <CardHeader>
        <CardTitle>Delivery Classification</CardTitle>
      </CardHeader>
      <CardContent className="pt-0">
        {items.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No line items on the linked order.
          </p>
        ) : (
          <div className="space-y-4">
            <p className="text-xs text-muted-foreground">
              A line’s quantity can be sourced from more than one vendor — use
              “Split quantity” to divide it. Each split is tracked independently
              through PLM once the kickoff completes.
            </p>
            {items.map((li) => (
              <DeliveryRow
                key={li.id}
                kickoffId={kickoff.id}
                item={li}
                canManage={canManage}
                vendors={vendors}
                onChanged={onChanged}
              />
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

type SplitDraft = {
  /** Stable local key: the persisted split id, or a temp id for a new row. */
  key: string;
  /** Present ⇒ update an existing split; absent ⇒ create a new one. */
  id?: string;
  quantity: string;
  deliveryType: DeliveryType | '';
  vendorId: string | null;
  vendorName: string;
  vendorContactInfo: string;
  vendorExpectedLeadTime: string;
  hasPlmTracker: boolean;
};

function splitsToDrafts(
  splits: KickoffDeliverySplit[],
  lineQuantity: string,
): SplitDraft[] {
  // A never-classified line has no splits yet — seed one holding the whole
  // quantity so the user can classify it in place.
  if (splits.length === 0) {
    return [
      {
        key: 'seed',
        quantity: lineQuantity,
        deliveryType: '',
        vendorId: null,
        vendorName: '',
        vendorContactInfo: '',
        vendorExpectedLeadTime: '',
        hasPlmTracker: false,
      },
    ];
  }
  return splits.map((s) => ({
    key: s.id,
    id: s.id,
    quantity: s.quantity,
    deliveryType: s.deliveryType ?? '',
    vendorId: s.vendorId,
    vendorName: s.vendorName ?? '',
    vendorContactInfo: s.vendorContactInfo ?? '',
    vendorExpectedLeadTime: s.vendorExpectedLeadTime ?? '',
    hasPlmTracker: s.hasPlmTracker,
  }));
}

/**
 * Whole-cent value of a quantity string, or null if not a finite number. We
 * compare allocations in integer cents so decimal quantities match exactly —
 * mirroring the server's `Prisma.Decimal.equals`, never a raw float compare.
 */
function toCents(value: string): number | null {
  const n = Number(value);
  return Number.isFinite(n) ? Math.round(n * 100) : null;
}

function DeliveryRow({
  kickoffId,
  item,
  canManage,
  vendors,
  onChanged,
}: {
  kickoffId: string;
  item: KickoffDeliveryItem;
  canManage: boolean;
  vendors: VendorOption[];
  onChanged: () => void;
}) {
  const toast = useToast();
  const tempId = useRef(0);
  const [drafts, setDrafts] = useState<SplitDraft[]>(() =>
    splitsToDrafts(item.splits, item.quantity),
  );
  const [dirty, setDirty] = useState(false);
  const [nudge, setNudge] = useState<KickoffDeliveryItem | null>(null);
  const [busy, setBusy] = useState(false);

  // Re-seed the draft buffers when the persisted splits actually change (e.g.
  // a save auto-fills the in-house vendor name, or provisions a tracker).
  // Keyed on the values — not the array identity — so an unrelated parent
  // refetch (another row saving) doesn't clobber in-progress edits here.
  const serverKey = useMemo(
    () =>
      JSON.stringify(
        item.splits.map((s) => [
          s.id,
          s.quantity,
          s.deliveryType,
          s.vendorId,
          s.vendorName,
          s.vendorContactInfo,
          s.vendorExpectedLeadTime,
          s.hasPlmTracker,
        ]),
      ),
    [item.splits],
  );
  useEffect(() => {
    setDrafts(splitsToDrafts(item.splits, item.quantity));
    setDirty(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [serverKey]);

  const lineCents = toCents(item.quantity);
  const allocatedCents = drafts.reduce<number | null>((acc, d) => {
    if (acc === null) return null;
    const c = toCents(d.quantity);
    return c === null ? null : acc + c;
  }, 0);
  const allPositive = drafts.every((d) => {
    const c = toCents(d.quantity);
    return c !== null && c > 0;
  });
  const sumMatches =
    allPositive && allocatedCents !== null && allocatedCents === lineCents;

  function patch(key: string, next: Partial<SplitDraft>) {
    setDrafts((ds) => ds.map((d) => (d.key === key ? { ...d, ...next } : d)));
    setDirty(true);
  }
  function addSplit() {
    tempId.current += 1;
    setDrafts((ds) => [
      ...ds,
      {
        key: `new-${tempId.current}`,
        quantity: '',
        deliveryType: '',
        vendorId: null,
        vendorName: '',
        vendorContactInfo: '',
        vendorExpectedLeadTime: '',
        hasPlmTracker: false,
      },
    ]);
    setDirty(true);
  }
  function removeSplit(key: string) {
    setDrafts((ds) => ds.filter((d) => d.key !== key));
    setDirty(true);
  }

  function toPayload(d: SplitDraft): DeliverySplitInput {
    const p: DeliverySplitInput = {
      quantity: Number(d.quantity),
      deliveryType: d.deliveryType || null,
    };
    if (d.id) p.id = d.id;
    if (d.deliveryType === 'VENDOR' || d.deliveryType === 'IN_HOUSE') {
      p.vendorId = d.vendorId;
      const name = d.vendorName.trim();
      // IN_HOUSE with a blank name → omit it so the server fills the fixed
      // manufacturing partner (mirrors the former single-vendor auto-fill).
      if (name) p.vendorName = name;
      else if (d.deliveryType === 'VENDOR') p.vendorName = null;
      p.vendorContactInfo = d.vendorContactInfo.trim() || null;
      p.vendorExpectedLeadTime = d.vendorExpectedLeadTime.trim() || null;
    } else {
      // NPD / unclassified: no vendor.
      p.vendorId = null;
      p.vendorName = null;
      p.vendorContactInfo = null;
      p.vendorExpectedLeadTime = null;
    }
    return p;
  }

  async function save() {
    if (!sumMatches) return;
    setBusy(true);
    // Nudge only when the line gains its first vendor split, not on every save.
    const gainsVendor =
      drafts.some((d) => d.deliveryType === 'VENDOR') &&
      !item.splits.some((s) => s.deliveryType === 'VENDOR');
    try {
      await updateDeliveryItem(kickoffId, item.id, {
        splits: drafts.map(toPayload),
      });
      onChanged();
      if (gainsVendor) setNudge(item);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Update failed.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rounded-md border p-3">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="font-medium">{item.productName}</div>
          <div className="text-xs text-muted-foreground">
            SKU: {item.productSku} · Qty {item.quantity}
          </div>
        </div>
        {canManage && (
          <Button
            variant="outline"
            size="sm"
            onClick={addSplit}
            disabled={busy}
          >
            <Plus className="mr-1 size-4" />
            Split quantity
          </Button>
        )}
      </div>

      <div className="mt-3 space-y-2">
        {drafts.map((d) => {
          const showVendor =
            d.deliveryType === 'VENDOR' || d.deliveryType === 'IN_HOUSE';
          const isInHouse = d.deliveryType === 'IN_HOUSE';
          // A VENDOR split points at a Vendor Master record (its vendorId is
          // what the PLM tracker links). Preserve a legacy/current selection
          // defensively if that master no longer appears in the fetched list.
          const vendorOptions: VendorOption[] =
            d.vendorId && !vendors.some((v) => v.id === d.vendorId)
              ? [
                  {
                    id: d.vendorId,
                    companyName: d.vendorName || '(current vendor)',
                  },
                  ...vendors,
                ]
              : vendors;
          // A legacy/free-text vendor name with no Vendor Master link — the
          // tracker cannot attach it until a Vendor Master record is picked.
          const unlinkedVendorName =
            d.deliveryType === 'VENDOR' &&
            !d.vendorId &&
            d.vendorName.trim().length > 0;
          return (
            <div
              key={d.key}
              className="grid grid-cols-1 gap-2 rounded border bg-muted/30 p-2 sm:grid-cols-[6rem_9rem_1fr_auto]"
            >
              <div>
                <label className="text-xs text-muted-foreground">Qty</label>
                <Input
                  type="number"
                  min="0.01"
                  step="0.01"
                  value={d.quantity}
                  onChange={(e) => patch(d.key, { quantity: e.target.value })}
                  className="h-8"
                  disabled={!canManage}
                />
              </div>
              <div>
                <label className="text-xs text-muted-foreground">
                  Delivery type
                </label>
                <Select
                  value={d.deliveryType}
                  onChange={(e) =>
                    // Changing the type clears any carried-over vendor (mirrors
                    // the server's type-driven reset) so a VENDOR-picked link
                    // never lingers on an IN_HOUSE/NPD split.
                    patch(d.key, {
                      deliveryType: e.target.value as DeliveryType,
                      vendorId: null,
                      vendorName: '',
                      vendorContactInfo: '',
                      vendorExpectedLeadTime: '',
                    })
                  }
                  // A split with a live PLM tracker cannot change type.
                  disabled={!canManage || d.hasPlmTracker}
                  className="h-8"
                >
                  <option value="" disabled>
                    Unclassified
                  </option>
                  {DELIVERY_TYPES.map((t) => (
                    <option key={t} value={t}>
                      {DELIVERY_TYPE_LABEL[t]}
                    </option>
                  ))}
                </Select>
              </div>
              <div className="min-w-0">
                {showVendor ? (
                  <div className="space-y-1.5">
                    {isInHouse ? (
                      <Input
                        value={d.vendorName}
                        onChange={(e) =>
                          patch(d.key, { vendorName: e.target.value })
                        }
                        placeholder="In-house partner (auto-filled on save)"
                        className="h-8"
                        disabled={!canManage}
                      />
                    ) : vendorOptions.length === 0 ? (
                      <p className="rounded border border-warning/40 bg-warning/10 px-2 py-1.5 text-xs text-muted-foreground">
                        No vendors in Vendor Master. Add one under SCM › Vendors,
                        then select it here so the PLM tracker can link it.
                      </p>
                    ) : (
                      <>
                        <Select
                          value={d.vendorId ?? ''}
                          onChange={(e) => {
                            const picked = vendors.find(
                              (v) => v.id === e.target.value,
                            );
                            // Selecting sets the FK the tracker links from and
                            // mirrors the company name; clearing drops both.
                            patch(d.key, {
                              vendorId: picked ? picked.id : null,
                              vendorName: picked ? picked.companyName : '',
                            });
                          }}
                          className="h-8"
                          disabled={!canManage}
                        >
                          <option value="">Select a vendor…</option>
                          {vendorOptions.map((v) => (
                            <option key={v.id} value={v.id}>
                              {v.companyName}
                              {v.status ? ` — ${VENDOR_STATUS_LABEL[v.status]}` : ''}
                            </option>
                          ))}
                        </Select>
                        {unlinkedVendorName && (
                          <p className="text-xs text-warning">
                            “{d.vendorName}” isn’t a Vendor Master record — pick
                            a vendor above to link it to the PLM tracker.
                          </p>
                        )}
                      </>
                    )}
                    <Input
                      value={d.vendorContactInfo}
                      onChange={(e) =>
                        patch(d.key, { vendorContactInfo: e.target.value })
                      }
                      placeholder="Contact (name / phone / email)"
                      className="h-8"
                      disabled={!canManage}
                    />
                    <Input
                      value={d.vendorExpectedLeadTime}
                      onChange={(e) =>
                        patch(d.key, {
                          vendorExpectedLeadTime: e.target.value,
                        })
                      }
                      placeholder="Expected lead time (e.g. 6–8 weeks)"
                      className="h-8"
                      disabled={!canManage}
                    />
                  </div>
                ) : (
                  <span className="text-sm text-muted-foreground">
                    No vendor for this delivery type.
                  </span>
                )}
              </div>
              <div className="flex items-start justify-end">
                {canManage && (
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label="Remove split"
                    onClick={() => removeSplit(d.key)}
                    // Removing a tracked split would cascade-destroy its PLM
                    // tracker; the last remaining split can't be removed either.
                    disabled={busy || d.hasPlmTracker || drafts.length === 1}
                    title={
                      d.hasPlmTracker
                        ? 'PLM tracking in progress — cannot remove'
                        : undefined
                    }
                  >
                    <Trash2 className="size-4" />
                  </Button>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {canManage && (
        <div className="mt-2 flex items-center justify-between gap-3">
          <p
            className={
              sumMatches
                ? 'text-xs text-muted-foreground'
                : 'text-xs text-destructive'
            }
          >
            Allocated{' '}
            {allocatedCents === null ? '—' : allocatedCents / 100} of{' '}
            {item.quantity}
            {!sumMatches &&
              ' — split quantities must add up to exactly the line quantity.'}
          </p>
          {dirty && (
            <Button size="sm" onClick={save} disabled={busy || !sumMatches}>
              {busy ? 'Saving…' : 'Save'}
            </Button>
          )}
        </div>
      )}

      {nudge && (
        <VendorRiskNudge
          kickoffId={kickoffId}
          productName={nudge.productName}
          onClose={() => setNudge(null)}
          onAdded={() => {
            setNudge(null);
            onChanged();
          }}
        />
      )}
    </div>
  );
}

/**
 * Soft nudge shown when a line item is marked Vendor: offers a pre-filled draft
 * risk (vendor-sourced items commonly carry more schedule/quality risk), which
 * the user can add or dismiss. The Risk Register already exists, so this is a
 * cheap prompt rather than relying on someone remembering.
 */
function VendorRiskNudge({
  kickoffId,
  productName,
  onClose,
  onAdded,
}: {
  kickoffId: string;
  productName: string;
  onClose: () => void;
  onAdded: () => void;
}) {
  const toast = useToast();
  const [description, setDescription] = useState(
    `Vendor-sourced delivery risk for ${productName}`,
  );
  const [busy, setBusy] = useState(false);

  async function add() {
    setBusy(true);
    try {
      await addRisk(kickoffId, {
        description:
          description.trim() ||
          `Vendor-sourced delivery risk for ${productName}`,
        likelihood: 'MEDIUM',
        impact: 'MEDIUM',
      });
      toast.success('Risk added to the register.');
      onAdded();
    } catch (err) {
      toast.error(
        err instanceof ApiError ? err.message : 'Failed to add risk.',
      );
      setBusy(false);
    }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add a vendor delivery risk?</DialogTitle>
        </DialogHeader>
        <p className="text-sm text-muted-foreground">
          Vendor-sourced items often carry more schedule and quality risk than
          in-house production. Add a risk to the register now, or dismiss.
        </p>
        <Input
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          className="mt-2"
        />
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={busy}>
            Dismiss
          </Button>
          <Button onClick={add} disabled={busy}>
            {busy ? 'Adding…' : 'Add risk'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Minutes / notes ──────────────────────────────────────────────────
function MinutesSection({
  kickoff,
  canManage,
  onSaved,
}: {
  kickoff: ProjectKickoff;
  canManage: boolean;
  onSaved: (k: ProjectKickoff) => void;
}) {
  const toast = useToast();
  const [text, setText] = useState(kickoff.minutesNotes ?? '');
  const [saving, setSaving] = useState(false);
  const dirty = text !== (kickoff.minutesNotes ?? '');

  async function save() {
    setSaving(true);
    try {
      const updated = await updateKickoff(kickoff.id, {
        minutesNotes: text || null,
      });
      onSaved(updated);
      toast.success('Notes saved.');
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Save failed.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card className="mb-4">
      <CardHeader>
        <CardTitle>Minutes &amp; Notes</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 pt-0">
        <Textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={4}
          placeholder="Anything not captured in the structured sections above…"
          disabled={!canManage}
        />
        {dirty && canManage && (
          <Button size="sm" onClick={save} disabled={saving}>
            {saving ? 'Saving…' : 'Save'}
          </Button>
        )}
      </CardContent>
    </Card>
  );
}
