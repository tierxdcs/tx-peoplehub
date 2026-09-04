'use client';

import {
  FormEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { useSearchParams } from 'next/navigation';
import { ArrowUpDown, ClipboardCheck, Plus } from 'lucide-react';
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
import {
  candidateEmailToast,
  parseRecipientInput,
  type CandidateApplicationEmailSummary,
} from '../../../lib/candidate-application-email';
import { formatINR } from '../../../lib/sales';
import { useNumberFormat } from '../../../lib/number-format-context';
import { RegisterToolbar } from '../../../components/ui/register-toolbar';
import { RegisterPagination } from '../../../components/ui/register-pagination';
import { EmptyState } from '../../../components/ui/empty-state';
import { useRegisterList } from '../../../lib/use-register-list';
import {
  EMPTY_REQUISITION_FILTERS,
  REQUISITION_SORT_DEFAULT_DIRECTION,
  filterRequisitions,
  hasActiveRequisitionFilters,
  requisitionFilterOptions,
  requisitionSearchText,
  requisitionStage,
  sortRequisitions,
  type RequisitionSortKey,
  type SortDirection,
} from '../../../lib/candidate-requisition-register';
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
  // Every letter ever written against this position, newest first. A declined
  // offer stays on the record and the position reopens, so there can be more
  // than one.
  offerLetters: {
    id: string;
    referenceNumber: string;
    status: string;
    sentAt: string | null;
    acceptedAt: string | null;
    declinedAt: string | null;
  }[];
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

type ApplicationLink = {
  id: string;
  token: string;
  expiresAt: string;
  revokedAt: string | null;
  hasPassword: boolean;
};

type CandidateApplication = {
  id: string;
  name: string;
  contact: string;
  areaOfExpertise: string;
  totalExperienceYears: string;
  relevantExperienceYears: string;
  currentCtc: string | null;
  expectedCtc: string | null;
  aboutExperience: string;
  projects: string | null;
  resumeFileName: string;
  resumeFileSize: number;
  status:
    | 'SUBMITTED'
    | 'UNDER_REVIEW'
    | 'INTERVIEW_SCHEDULED'
    | 'SELECTED'
    | 'OFFER_DECLINED'
    | 'REJECTED';
  submittedAt: string;
};

/**
 * The only two stages HR sets by hand. The later two are consequences, not
 * choices: Offer Extended is set by sending the approved offer letter, and
 * Candidate Selected / Fulfilled by onboarding the candidate who accepted it.
 */
const STAGES: { value: HiringStage; label: string }[] = [
  { value: 'JOB_POSTED', label: 'Job Posted' },
  { value: 'INTERVIEWING', label: 'Interviewing' },
];

/** The latest letter on a position, as one line: our approval state plus the
 *  candidate's own answer, which are two independent things. */
function offerLetterSummary(offer: Requisition['offerLetters'][number]) {
  const answer = offer.acceptedAt
    ? 'accepted'
    : offer.declinedAt
      ? 'declined'
      : offer.sentAt
        ? 'awaiting reply'
        : 'not sent';
  return `${offer.referenceNumber} · ${offer.status.replaceAll('_', ' ')} · ${answer}`;
}

/** How one column sorts, and the click that changes it. */
type SortState = {
  key: RequisitionSortKey;
  direction: SortDirection;
  toggle: (key: RequisitionSortKey) => void;
};

export default function CandidateRequisitionsPage() {
  const { user } = useAuth();
  const { isHrStaff } = useIsHrStaff();
  // ?focus= opens one requisition's details straight away — how an approval
  // notification lands on the record it is about. A requisition has no route of
  // its own; its detail surface is the dialog on this page.
  const focusId = useSearchParams().get('focus');
  const toast = useToast();
  const { style: numberFormatStyle } = useNumberFormat();
  const [register, setRegister] = useState<Requisition[]>([]);
  const [queue, setQueue] = useState<Requisition[]>([]);
  const [viewing, setViewing] = useState<Requisition | null>(null);
  const [requestOpen, setRequestOpen] = useState(false);
  const [positionTitle, setPositionTitle] = useState('');
  const [employmentType, setEmploymentType] = useState<EmploymentType>(
    'FULL_TIME_PERMANENT',
  );
  const [justification, setJustification] = useState('');
  const [keyResponsibilities, setKeyResponsibilities] = useState('');
  const [keyPerformanceIndicators, setKeyPerformanceIndicators] = useState('');
  const [budgetAnnualCtc, setBudgetAnnualCtc] = useState('');
  const [numberOfPositions, setNumberOfPositions] = useState('1');
  const [targetJoiningDate, setTargetJoiningDate] = useState('');
  const [filters, setFilters] = useState(EMPTY_REQUISITION_FILTERS);
  // Newest first, matching the order the register arrives in — so the default
  // view is unchanged and sorting is something the user opts into.
  const [sortKey, setSortKey] =
    useState<RequisitionSortKey>('requisitionNumber');
  const [sortDirection, setSortDirection] = useState<SortDirection>('desc');
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

  // Opened once per focused id, never again: the ref is what lets the approver
  // close the dialog and stay on the list, instead of having it spring back open
  // on the next reload while ?focus= is still in the address bar.
  const openedFocus = useRef<string | null>(null);
  useEffect(() => {
    if (!focusId || openedFocus.current === focusId) return;
    // The queue as well as the register: an approver's own pending item is the
    // likeliest thing to be focused, and it is the queue that holds it.
    const target = [...queue, ...register].find((r) => r.id === focusId);
    if (!target) return;
    openedFocus.current = focusId;
    setViewing(target);
  }, [focusId, queue, register]);

  async function create(event: FormEvent) {
    event.preventDefault();
    const budget = Number(budgetAnnualCtc);
    if (!(budget > 0)) {
      toast.error('Enter an annual CTC budget greater than zero');
      return;
    }
    const count = Math.floor(Number(numberOfPositions)) || 1;
    if (count < 1 || count > 20) {
      toast.error('Number of positions must be between 1 and 20');
      return;
    }
    if (
      !window.confirm(
        count > 1
          ? `Submit ${count} identical requisitions for approval? Each position is approved, offered and onboarded separately, and each will be routed to the vertical owner (or the CEO if the vertical has no owner).`
          : 'Submit this requisition for approval? It will be routed to the vertical owner (or the CEO if the vertical has no owner).',
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
          ...(count > 1 ? { numberOfPositions: count } : {}),
        }),
      });
      setPositionTitle('');
      setJustification('');
      setKeyResponsibilities('');
      setKeyPerformanceIndicators('');
      setBudgetAnnualCtc('');
      setTargetJoiningDate('');
      setNumberOfPositions('1');
      toast.success(
        count > 1
          ? `${count} requisitions submitted for approval`
          : 'Requisition submitted for approval',
      );
      setRequestOpen(false);
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

  // Dropdowns are built from the register itself, so an option never returns an
  // empty list and a vertical nobody has hired for never appears.
  const options = useMemo(() => requisitionFilterOptions(register), [register]);
  const rows = useMemo(
    () =>
      sortRequisitions(
        filterRequisitions(register, filters),
        sortKey,
        sortDirection,
      ),
    [register, filters, sortKey, sortDirection],
  );
  // Search and paging on top of the filtered, sorted rows — the shared hook also
  // pulls the page back in range when a filter shrinks the list under it.
  const list = useRegisterList(rows, requisitionSearchText);
  const filtersActive = hasActiveRequisitionFilters(filters) || !!list.search;

  /** Clicking the sorted column flips it; any other column takes its own default. */
  function toggleSort(key: RequisitionSortKey) {
    if (key === sortKey) {
      setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc');
      return;
    }
    setSortKey(key);
    setSortDirection(REQUISITION_SORT_DEFAULT_DIRECTION[key]);
  }

  const clearFilters = () => {
    setFilters(EMPTY_REQUISITION_FILTERS);
    list.setSearch('');
  };

  return (
    <PageContainer>
      <PageHeader
        title="Candidate Requisitions"
        description="Authorize hiring sequentially, then follow HR’s recruiting progress through fulfilment."
        action={
          canCreate ? (
            <Button onClick={() => setRequestOpen(true)}>
              <Plus className="mr-2 size-4" />
              Submit requisition
            </Button>
          ) : undefined
        }
      />
      {canCreate && (
        <Dialog open={requestOpen} onOpenChange={setRequestOpen}>
          <DialogContent className="max-w-3xl">
            <DialogHeader>
              <DialogTitle>Request a position</DialogTitle>
            </DialogHeader>
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
              <label className="text-sm font-medium">
                Number of positions
                <Input
                  className="mt-1"
                  type="number"
                  min={1}
                  max={20}
                  step={1}
                  value={numberOfPositions}
                  onChange={(event) =>
                    setNumberOfPositions(event.target.value)
                  }
                  required
                />
                <span className="mt-1 block text-xs font-normal text-muted-foreground">
                  Raises that many identical requisitions — each is approved
                  and filled separately.
                </span>
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
              <DialogFooter className="sm:col-span-2">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setRequestOpen(false)}
                >
                  Cancel
                </Button>
                <Button type="submit">Submit requisition</Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
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
        search={list.search}
        onSearchChange={list.setSearch}
        searchPlaceholder="Search requisition, requester, position, candidate or stage"
        filters={
          <>
            <Select
              className="w-56"
              aria-label="Filter by hiring stage"
              value={filters.stage}
              onChange={(event) =>
                setFilters((current) => ({
                  ...current,
                  stage: event.target.value,
                }))
              }
            >
              <option value="">All stages</option>
              {/* The two groups first: "what is still to be filled" is the
                  question HR asks far more often than any single stage. */}
              <optgroup label="Groups">
                <option value="group:open">Open — not yet filled</option>
                <option value="group:closed">
                  Closed — filled, rejected or cancelled
                </option>
              </optgroup>
              <optgroup label="Stage">
                {options.stages.map((stage) => (
                  <option key={stage} value={stage}>
                    {stage}
                  </option>
                ))}
              </optgroup>
            </Select>
            <Select
              className="w-48"
              aria-label="Filter by vertical"
              value={filters.vertical}
              onChange={(event) =>
                setFilters((current) => ({
                  ...current,
                  vertical: event.target.value,
                }))
              }
            >
              <option value="">All verticals</option>
              {options.verticals.map((vertical) => (
                <option key={vertical} value={vertical}>
                  {vertical}
                </option>
              ))}
            </Select>
            <Select
              className="w-48"
              aria-label="Filter by requester"
              value={filters.requesterId}
              onChange={(event) =>
                setFilters((current) => ({
                  ...current,
                  requesterId: event.target.value,
                }))
              }
            >
              <option value="">All requesters</option>
              {options.requesters.map((requester) => (
                <option key={requester.id} value={requester.id}>
                  {requester.name}
                </option>
              ))}
            </Select>
            {filtersActive && (
              <Button variant="outline" onClick={clearFilters}>
                Clear
              </Button>
            )}
          </>
        }
      />
      <RequisitionTable
        title={
          filtersActive
            ? `Showing ${list.filteredItems.length} of ${register.length} requisitions`
            : 'All visible requisitions'
        }
        items={list.visibleItems}
        numberFormatStyle={numberFormatStyle}
        onView={setViewing}
        sort={{ key: sortKey, direction: sortDirection, toggle: toggleSort }}
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
        page={list.page}
        pageCount={list.pageCount}
        onPageChange={list.setPage}
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

/**
 * One column heading. Sortable only where the caller passes sort state — the
 * approval queue is a handful of rows in the order they must be decided, so
 * offering to reorder it would be noise.
 */
function SortHead({
  label,
  sortKey,
  sort,
  right,
}: {
  label: string;
  sortKey: RequisitionSortKey;
  sort?: SortState;
  right?: boolean;
}) {
  if (!sort) {
    return (
      <TableHead className={right ? 'text-right' : undefined}>
        {label}
      </TableHead>
    );
  }
  const active = sort.key === sortKey;
  return (
    <TableHead
      className={right ? 'text-right' : undefined}
      // aria-sort belongs to the column, not the button inside it.
      aria-sort={
        active
          ? sort.direction === 'asc'
            ? 'ascending'
            : 'descending'
          : 'none'
      }
    >
      <button
        type="button"
        onClick={() => sort.toggle(sortKey)}
        aria-label={`Sort by ${label.toLowerCase()}`}
        className={`inline-flex items-center gap-1 hover:text-foreground ${
          active ? 'text-foreground' : ''
        }`}
      >
        {label}
        <ArrowUpDown className="size-3" />
      </button>
    </TableHead>
  );
}

function RequisitionTable({
  title,
  items,
  numberFormatStyle,
  onView,
  actions,
  sort,
}: {
  title: string;
  items: Requisition[];
  numberFormatStyle: 'india' | 'international';
  onView: (requisition: Requisition) => void;
  actions?: (requisition: Requisition) => React.ReactNode;
  sort?: SortState;
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
              <SortHead
                label="Requisition"
                sortKey="requisitionNumber"
                sort={sort}
              />
              <SortHead label="Position" sortKey="positionTitle" sort={sort} />
              <SortHead label="Requester" sortKey="requester" sort={sort} />
              <SortHead
                label="Annual CTC budget"
                sortKey="budgetAnnualCtc"
                sort={sort}
                right
              />
              <SortHead label="Hiring status" sortKey="stage" sort={sort} />
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
                      requisitionStage(requisition) === 'FULFILLED'
                        ? 'success'
                        : 'secondary'
                    }
                  >
                    {requisitionStage(requisition)}
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
  const [saving, setSaving] = useState(false);
  const [applications, setApplications] = useState<CandidateApplication[]>([]);
  const [applicationLinks, setApplicationLinks] = useState<ApplicationLink[]>([]);
  const [applicationPassword, setApplicationPassword] = useState('');
  // Which link's "Email link" form is open; only one at a time, since the
  // addresses typed for one link would never be meant for another.
  const [emailLinkId, setEmailLinkId] = useState<string | null>(null);
  const [emailTo, setEmailTo] = useState('');
  const [emailNote, setEmailNote] = useState('');
  const [emailing, setEmailing] = useState(false);

  useEffect(() => {
    // Later stages aren't offered in the dropdown, so fall back to Interviewing
    // rather than leaving the Select showing a value it has no option for.
    setStage(
      requisition?.hiringStage === 'JOB_POSTED' ||
        requisition?.hiringStage === 'INTERVIEWING'
        ? requisition.hiringStage
        : requisition?.hiringStage
          ? 'INTERVIEWING'
          : 'JOB_POSTED',
    );
  }, [requisition]);

  useEffect(() => {
    setEmailLinkId(null);
    setEmailTo('');
    setEmailNote('');
    if (!requisition) {
      setApplications([]);
      setApplicationLinks([]);
      return;
    }
    Promise.all([
      apiFetch<CandidateApplication[]>(
        `/candidate-requisitions/${requisition.id}/applications`,
      ),
      apiFetch<ApplicationLink[]>(
        `/candidate-requisitions/${requisition.id}/application-links`,
      ),
    ])
      .then(([nextApplications, nextLinks]) => {
        setApplications(nextApplications);
        setApplicationLinks(nextLinks);
      })
      .catch(() => toast.error('Failed to load candidate applications'));
  }, [requisition, toast]);

  async function generateApplicationLink() {
    if (!requisition) return;
    try {
      const link = await apiFetch<ApplicationLink>(
        `/candidate-requisitions/${requisition.id}/application-links`,
        {
          method: 'POST',
          body: JSON.stringify({
            password: applicationPassword.trim() || undefined,
          }),
        },
      );
      setApplicationLinks((items) => [link, ...items]);
      setApplicationPassword('');
      await navigator.clipboard.writeText(
        `${window.location.origin}/public/job-applications/${link.token}`,
      );
      toast.success('Application link created and copied');
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : 'Link creation failed');
    }
  }

  async function revokeApplicationLink(linkId: string) {
    try {
      await apiFetch(`/candidate-requisitions/application-links/${linkId}/revoke`, {
        method: 'POST',
      });
      setApplicationLinks((items) =>
        items.map((item) =>
          item.id === linkId ? { ...item, revokedAt: new Date().toISOString() } : item,
        ),
      );
      toast.success('Application link revoked');
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : 'Revoke failed');
    }
  }

  async function emailApplicationLink(linkId: string) {
    const recipients = parseRecipientInput(emailTo);
    if (!recipients.length) {
      toast.error('Enter at least one candidate email address');
      return;
    }
    setEmailing(true);
    try {
      const summary = await apiFetch<CandidateApplicationEmailSummary>(
        `/candidate-requisitions/application-links/${linkId}/email`,
        {
          method: 'POST',
          body: JSON.stringify({
            to: recipients,
            note: emailNote.trim() || undefined,
          }),
        },
      );
      const message = candidateEmailToast(summary);
      toast.toast({
        title: message.title,
        description: message.description,
        variant:
          message.tone === 'success'
            ? 'success'
            : message.tone === 'error'
              ? 'destructive'
              : 'default',
      });
      // Only clear the form once something actually went out — otherwise HR
      // would have to retype the shortlist to retry.
      if (summary.sent > 0 && !summary.failed) {
        setEmailTo('');
        setEmailNote('');
        setEmailLinkId(null);
      }
    } catch (error) {
      toast.error(
        error instanceof ApiError ? error.message : 'Failed to email the application link',
      );
    } finally {
      setEmailing(false);
    }
  }

  async function updateApplicationStatus(
    application: CandidateApplication,
    status: CandidateApplication['status'],
  ) {
    try {
      await apiFetch(
        `/candidate-requisitions/applications/${application.id}/status`,
        { method: 'PATCH', body: JSON.stringify({ status }) },
      );
      setApplications((items) =>
        items.map((item) =>
          item.id === application.id ? { ...item, status } : item,
        ),
      );
      if (status === 'SELECTED') await onUpdated();
      // Selection authorizes an offer; it is not the hire. The requisition is
      // only fulfilled once this candidate accepts and is onboarded.
      toast.success(
        status === 'SELECTED'
          ? 'Candidate selected — draft their offer letter next (HR › Offer Letters)'
          : 'Application updated',
      );
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : 'Update failed');
    }
  }

  async function downloadResume(application: CandidateApplication) {
    try {
      const result = await apiFetch<{ downloadUrl: string }>(
        `/candidate-requisitions/applications/${application.id}/resume`,
      );
      window.open(result.downloadUrl, '_blank', 'noopener,noreferrer');
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : 'Resume download failed');
    }
  }

  async function saveLifecycle() {
    if (!requisition) return;
    setSaving(true);
    try {
      await apiFetch(
        `/candidate-requisitions/${requisition.id}/hiring-lifecycle`,
        {
          method: 'PATCH',
          body: JSON.stringify({ hiringStage: stage }),
        },
      );
      toast.success('Hiring progress updated');
      await onUpdated();
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : 'Update failed');
    } finally {
      setSaving(false);
    }
  }

  // Only the pre-offer stages are HR's to set. From Offer Extended onward the
  // stage is driven by the offer letter (sent / accepted) and by onboarding, so
  // the form would only offer a move the server refuses.
  const editable =
    canEditLifecycle &&
    requisition?.status === 'APPROVED' &&
    (requisition.hiringStage === null ||
      requisition.hiringStage === 'JOB_POSTED' ||
      requisition.hiringStage === 'INTERVIEWING');
  // A position stops taking applications the moment somebody accepts its offer —
  // not when a candidate is merely selected, since they may still decline. The
  // server enforces the same rule on create/email/submit.
  const linksOpen =
    !!requisition &&
    requisition.hiringStage !== 'CANDIDATE_SELECTED' &&
    !requisition.offerLetters.some((offer) => offer.acceptedAt);
  const publicOrigin = typeof window === 'undefined' ? '' : window.location.origin;

  return (
    <Dialog
      open={!!requisition}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent className="max-h-[90vh] max-w-4xl overflow-y-auto">
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
                  value={requisitionStage(requisition)}
                />
                {requisition.selectedCandidateName && (
                  <Detail
                    label="Selected candidate"
                    value={requisition.selectedCandidateName}
                  />
                )}
                {requisition.offerLetters.length > 0 && (
                  <Detail
                    label="Offer letter"
                    value={offerLetterSummary(requisition.offerLetters[0])}
                  />
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
                    <p className="text-xs text-muted-foreground">
                      Offer Extended and Fulfilled are not set here: sending the
                      approved offer letter extends the offer, and onboarding the
                      candidate who accepted it fulfils the requisition.
                    </p>
                    <Button onClick={saveLifecycle} disabled={saving}>
                      {saving ? 'Saving…' : 'Save progress'}
                    </Button>
                  </CardContent>
                </Card>
              )}
              {requisition.status === 'APPROVED' && (
                <Card>
                  <CardHeader>
                    <CardTitle>Public application link</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    {canEditLifecycle && linksOpen && (
                      <div className="flex flex-col gap-2 sm:flex-row">
                        <Input
                          type="password"
                          placeholder="Optional link password"
                          value={applicationPassword}
                          onChange={(event) => setApplicationPassword(event.target.value)}
                        />
                        <Button onClick={generateApplicationLink}>Generate link</Button>
                      </div>
                    )}
                    {applicationLinks.map((link) => {
                      const url = `${publicOrigin}/public/job-applications/${link.token}`;
                      const canEmail =
                        canEditLifecycle &&
                        !link.revokedAt &&
                        new Date(link.expiresAt) > new Date() &&
                        linksOpen;
                      return (
                        <div key={link.id} className="space-y-3 rounded-md border p-3">
                          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                            <div className="min-w-0">
                              <p className="truncate font-medium">{url}</p>
                              <p className="text-xs text-muted-foreground">
                                Expires {new Date(link.expiresAt).toLocaleDateString()}
                                {link.hasPassword ? ' · Password protected' : ' · No password'}
                                {link.revokedAt ? ' · Revoked' : ''}
                              </p>
                            </div>
                            <div className="flex gap-2">
                              {!link.revokedAt && <Button size="sm" variant="outline" onClick={() => navigator.clipboard.writeText(url)}>Copy</Button>}
                              {canEmail && (
                                <Button
                                  size="sm"
                                  variant="outline"
                                  onClick={() =>
                                    setEmailLinkId((current) => (current === link.id ? null : link.id))
                                  }
                                >
                                  {emailLinkId === link.id ? 'Cancel email' : 'Email link'}
                                </Button>
                              )}
                              {canEditLifecycle && !link.revokedAt && <Button size="sm" variant="destructive" onClick={() => revokeApplicationLink(link.id)}>Revoke</Button>}
                            </div>
                          </div>
                          {canEmail && emailLinkId === link.id && (
                            <div className="space-y-2 border-t pt-3">
                              <Input
                                type="text"
                                placeholder="Candidate emails, separated by commas"
                                value={emailTo}
                                onChange={(event) => setEmailTo(event.target.value)}
                              />
                              <Textarea
                                rows={2}
                                placeholder="Optional note to include in the email"
                                value={emailNote}
                                onChange={(event) => setEmailNote(event.target.value)}
                              />
                              <div className="flex items-center justify-between gap-2">
                                <p className="text-xs text-muted-foreground">
                                  Each candidate gets their own email — nobody sees who else was
                                  approached.
                                  {link.hasPassword
                                    ? ' The link password is never included; share it separately.'
                                    : ''}
                                </p>
                                <Button
                                  size="sm"
                                  onClick={() => emailApplicationLink(link.id)}
                                  disabled={emailing || !parseRecipientInput(emailTo).length}
                                >
                                  {emailing ? 'Sending…' : 'Send email'}
                                </Button>
                              </div>
                            </div>
                          )}
                        </div>
                      );
                    })}
                    {!applicationLinks.length && <p className="text-sm text-muted-foreground">No application link has been generated.</p>}
                  </CardContent>
                </Card>
              )}
              <Card>
                <CardHeader>
                  <CardTitle>Candidate applications ({applications.length})</CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  {applications.map((application) => (
                    <div key={application.id} className="rounded-md border p-4">
                      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                        <div>
                          <p className="font-semibold">{application.name}</p>
                          <p className="text-muted-foreground">{application.contact} · {application.areaOfExpertise}</p>
                          <p className="mt-1 text-xs text-muted-foreground">
                            {application.totalExperienceYears} years total · {application.relevantExperienceYears} years relevant · Submitted {new Date(application.submittedAt).toLocaleString()}
                          </p>
                        </div>
                        <div className="flex items-center gap-2">
                          <Button size="sm" variant="outline" onClick={() => downloadResume(application)}>Resume</Button>
                          {canEditLifecycle ? (
                            <Select value={application.status} onChange={(event) => updateApplicationStatus(application, event.target.value as CandidateApplication['status'])}>
                              <option value="SUBMITTED">Submitted</option>
                              <option value="UNDER_REVIEW">Under review</option>
                              <option value="INTERVIEW_SCHEDULED">Interview scheduled</option>
                              <option value="SELECTED">Selected</option>
                              <option value="REJECTED">Rejected</option>
                              {/* Set by recording the candidate's decline on the
                                  offer letter, never chosen here — present only
                                  so the Select can display it. */}
                              <option value="OFFER_DECLINED" disabled>
                                Offer declined
                              </option>
                            </Select>
                          ) : <Badge variant="secondary">{application.status.replaceAll('_', ' ')}</Badge>}
                        </div>
                      </div>
                      <p className="mt-3 whitespace-pre-wrap">{application.aboutExperience}</p>
                      {application.projects && <p className="mt-2 whitespace-pre-wrap text-muted-foreground"><strong>Projects:</strong> {application.projects}</p>}
                      <p className="mt-2 text-xs text-muted-foreground">
                        Current CTC: {application.currentCtc ? formatINR(application.currentCtc, numberFormatStyle) : '—'} · Expected CTC: {application.expectedCtc ? formatINR(application.expectedCtc, numberFormatStyle) : '—'}
                      </p>
                    </div>
                  ))}
                  {!applications.length && <p className="text-sm text-muted-foreground">No applications received yet.</p>}
                </CardContent>
              </Card>
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
