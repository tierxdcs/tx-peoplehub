'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Rocket } from 'lucide-react';
import { ApiError } from '../../lib/api';
import { useAuth } from '../../lib/auth-context';
import { useIsProjectManager } from '../../lib/use-is-project-manager';
import {
  createKickoff,
  listEligibleOrders,
  listKickoffs,
  MEETING_MODE_LABEL,
  type EligibleOrder,
  type KickoffMeetingMode,
  type ProjectKickoff,
} from '../../lib/project-kickoff';
import { PageContainer } from '../../components/ui/page-container';
import { PageHeader } from '../../components/ui/page-header';
import { Card, CardContent } from '../../components/ui/card';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { Select } from '../../components/ui/select';
import { Field } from '../../components/ui/field';
import { StatusBadge } from '../../components/ui/status-badge';
import { EmptyState } from '../../components/ui/empty-state';
import { Skeleton } from '../../components/ui/skeleton';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../../components/ui/dialog';
import { useToast } from '../../components/ui/toaster';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '../../components/ui/table';

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

/**
 * Project Kickoff landing: kickoffs the employee can access. Also the create
 * entry point for Project Managers who lack Sales access (they can't reach the
 * Order detail page) — "New Kickoff" picks from eligible orders here.
 */
export default function ProjectKickoffLandingPage() {
  const router = useRouter();
  const { user } = useAuth();
  const { isProjectManager } = useIsProjectManager();
  const canCreate = user?.role === 'SUPER_ADMIN' || isProjectManager;

  const [kickoffs, setKickoffs] = useState<ProjectKickoff[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setKickoffs(await listKickoffs());
    } catch {
      setError('Failed to load project kickoffs.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <PageContainer>
      <PageHeader
        title="Project Kickoff"
        description="Kickoff records you have access to."
        action={
          canCreate ? (
            <Button onClick={() => setCreating(true)}>
              <Rocket className="size-4" /> New Kickoff
            </Button>
          ) : undefined
        }
      />

      {error && <p className="mb-4 text-sm text-destructive">{error}</p>}

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Project</TableHead>
                <TableHead>Meeting</TableHead>
                <TableHead>Mode</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                Array.from({ length: 4 }).map((_, i) => (
                  <TableRow key={i}>
                    {Array.from({ length: 4 }).map((__, j) => (
                      <TableCell key={j}>
                        <Skeleton className="h-4 w-28" />
                      </TableCell>
                    ))}
                  </TableRow>
                ))
              ) : kickoffs.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={4} className="p-0">
                    <EmptyState
                      icon={Rocket}
                      title="No project kickoffs yet"
                      description={
                        canCreate
                          ? 'Start one from an order whose Confirmation Sheet is executed.'
                          : 'A kickoff is created from an order once its Confirmation Sheet is executed.'
                      }
                    />
                  </TableCell>
                </TableRow>
              ) : (
                kickoffs.map((k) => (
                  <TableRow
                    key={k.id}
                    className="cursor-pointer"
                    onClick={() => router.push(`/project-kickoff/${k.id}`)}
                  >
                    <TableCell className="font-medium">{k.projectName}</TableCell>
                    <TableCell>{formatDate(k.meetingDate)}</TableCell>
                    <TableCell>{MEETING_MODE_LABEL[k.meetingMode]}</TableCell>
                    <TableCell>
                      <StatusBadge value={k.status} />
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {creating && (
        <NewKickoffDialog
          onClose={() => setCreating(false)}
          onCreated={(id) => router.push(`/project-kickoff/${id}`)}
        />
      )}
    </PageContainer>
  );
}

function NewKickoffDialog({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: (kickoffId: string) => void;
}) {
  const toast = useToast();
  const [orders, setOrders] = useState<EligibleOrder[]>([]);
  const [loadingOrders, setLoadingOrders] = useState(true);

  const [orderId, setOrderId] = useState('');
  const [projectName, setProjectName] = useState('');
  const [meetingDate, setMeetingDate] = useState('');
  const [meetingMode, setMeetingMode] = useState<KickoffMeetingMode>('VIRTUAL');
  const [meetingLocation, setMeetingLocation] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    listEligibleOrders()
      .then(setOrders)
      .catch(() => setError('Failed to load eligible orders.'))
      .finally(() => setLoadingOrders(false));
  }, []);

  // Default the project name from the picked order, until the user edits it.
  const [nameEdited, setNameEdited] = useState(false);
  function pickOrder(id: string) {
    setOrderId(id);
    if (!nameEdited) {
      const o = orders.find((x) => x.id === id);
      setProjectName(o ? `${o.customerName} — ${o.orderNumber}` : '');
    }
  }

  async function submit() {
    if (!orderId) {
      setError('Select an order.');
      return;
    }
    if (!meetingDate) {
      setError('Meeting date is required.');
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const created = await createKickoff({
        orderId,
        projectName: projectName.trim() || undefined,
        meetingDate: new Date(meetingDate).toISOString(),
        meetingMode,
        meetingLocation: meetingLocation.trim() || undefined,
      });
      toast.success('Project kickoff created.');
      onCreated(created.id);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to create kickoff.');
      setSubmitting(false);
    }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New Project Kickoff</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <Field label="Order" required htmlFor="pk-order">
            {loadingOrders ? (
              <Skeleton className="h-9 w-full" />
            ) : orders.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No eligible orders. An order needs an executed Confirmation
                Sheet and no existing kickoff.
              </p>
            ) : (
              <Select
                id="pk-order"
                value={orderId}
                onChange={(e) => pickOrder(e.target.value)}
              >
                <option value="">Select an order…</option>
                {orders.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.orderNumber} — {o.customerName}
                  </option>
                ))}
              </Select>
            )}
          </Field>

          <Field label="Project name" htmlFor="pk-name">
            <Input
              id="pk-name"
              value={projectName}
              onChange={(e) => {
                setNameEdited(true);
                setProjectName(e.target.value);
              }}
              placeholder="Defaults to Customer — Order #"
            />
          </Field>

          <Field label="Meeting date & time" required htmlFor="pk-date">
            <Input
              id="pk-date"
              type="datetime-local"
              value={meetingDate}
              onChange={(e) => setMeetingDate(e.target.value)}
            />
          </Field>

          <Field label="Mode" htmlFor="pk-mode">
            <Select
              id="pk-mode"
              value={meetingMode}
              onChange={(e) => setMeetingMode(e.target.value as KickoffMeetingMode)}
            >
              <option value="IN_PERSON">In person</option>
              <option value="VIRTUAL">Virtual</option>
              <option value="HYBRID">Hybrid</option>
            </Select>
          </Field>

          <Field label="Location / link" htmlFor="pk-loc">
            <Input
              id="pk-loc"
              value={meetingLocation}
              onChange={(e) => setMeetingLocation(e.target.value)}
              placeholder="Physical address or virtual meeting link"
            />
          </Field>

          {error && <p className="text-sm text-destructive">{error}</p>}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={submitting}>
            Cancel
          </Button>
          <Button
            onClick={submit}
            disabled={submitting || !orderId || !meetingDate}
          >
            {submitting ? 'Creating…' : 'Create'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
