'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Rocket } from 'lucide-react';
import { ApiError } from '../../../../../lib/api';
import { useAuth } from '../../../../../lib/auth-context';
import { useIsProjectManager } from '../../../../../lib/use-is-project-manager';
import {
  createKickoff,
  listKickoffs,
  type KickoffMeetingMode,
  type ProjectKickoff,
} from '../../../../../lib/project-kickoff';
import type { Customer } from '../../../../../lib/types';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from '../../../../../components/ui/card';
import { Button } from '../../../../../components/ui/button';
import { Input } from '../../../../../components/ui/input';
import { Select } from '../../../../../components/ui/select';
import { Field } from '../../../../../components/ui/field';
import { Skeleton } from '../../../../../components/ui/skeleton';
import { StatusBadge } from '../../../../../components/ui/status-badge';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../../../../../components/ui/dialog';
import { useToast } from '../../../../../components/ui/toaster';

/**
 * Project Kickoff section on the Order detail page — the primary creation entry
 * point. Three states (spec §2):
 *  - Confirmation Sheet not executed → informational note (show why, don't hide)
 *  - Executed, no kickoff → "Create Project Kickoff" (PM / SUPER_ADMIN only)
 *  - Kickoff exists → link + status badge
 */
export function ProjectKickoffSection({
  orderId,
  orderNumber,
  latestExecuted,
  customerName,
}: {
  orderId: string;
  orderNumber: string;
  latestExecuted: boolean;
  customerName: string | null;
}) {
  const router = useRouter();
  const toast = useToast();
  const { user } = useAuth();
  const { isProjectManager } = useIsProjectManager();
  const canCreate = user?.role === 'SUPER_ADMIN' || isProjectManager;

  const [kickoff, setKickoff] = useState<ProjectKickoff | null>(null);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      // No get-by-order endpoint; the accessible list is small — find ours.
      const all = await listKickoffs();
      setKickoff(all.find((k) => k.orderId === orderId) ?? null);
    } catch {
      setKickoff(null);
    } finally {
      setLoading(false);
    }
  }, [orderId]);

  useEffect(() => {
    void load();
  }, [load]);

  const defaultName = customerName
    ? `${customerName} — ${orderNumber}`
    : orderNumber;

  return (
    <Card className="mt-4">
      <CardHeader>
        <CardTitle>Project Kickoff</CardTitle>
      </CardHeader>
      <CardContent className="pt-0">
        {loading ? (
          <Skeleton className="h-9 w-56" />
        ) : kickoff ? (
          // ── Exists → link + status ──
          <div className="flex flex-wrap items-center gap-3">
            <Button
              variant="outline"
              onClick={() => router.push(`/project-kickoff/${kickoff.id}`)}
            >
              <Rocket className="size-4" /> View kickoff — {kickoff.projectName}
            </Button>
            <StatusBadge value={kickoff.status} />
          </div>
        ) : !latestExecuted ? (
          // ── Not eligible yet → explain why ──
          <p className="text-sm text-muted-foreground">
            Project Kickoff becomes available once the Order Confirmation Sheet
            is executed.
          </p>
        ) : canCreate ? (
          // ── Eligible, no kickoff → create ──
          <Button onClick={() => setCreating(true)}>
            <Rocket className="size-4" /> Create Project Kickoff
          </Button>
        ) : (
          <p className="text-sm text-muted-foreground">
            No project kickoff yet. A Project Manager can create one.
          </p>
        )}
      </CardContent>

      {creating && (
        <CreateKickoffDialog
          orderId={orderId}
          defaultName={defaultName}
          onClose={() => setCreating(false)}
          onCreated={(id) => {
            toast.success('Project kickoff created.');
            router.push(`/project-kickoff/${id}`);
          }}
        />
      )}
    </Card>
  );
}

function CreateKickoffDialog({
  orderId,
  defaultName,
  onClose,
  onCreated,
}: {
  orderId: string;
  defaultName: string;
  onClose: () => void;
  onCreated: (kickoffId: string) => void;
}) {
  const toast = useToast();
  const [projectName, setProjectName] = useState(defaultName);
  const [meetingDate, setMeetingDate] = useState('');
  const [meetingMode, setMeetingMode] = useState<KickoffMeetingMode>('VIRTUAL');
  const [meetingLocation, setMeetingLocation] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
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
        // Datetime-local value → ISO for the backend.
        meetingDate: new Date(meetingDate).toISOString(),
        meetingMode,
        meetingLocation: meetingLocation.trim() || undefined,
      });
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
          <DialogTitle>Create Project Kickoff</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <Field label="Project name" htmlFor="pk-name">
            <Input
              id="pk-name"
              value={projectName}
              onChange={(e) => setProjectName(e.target.value)}
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
              onChange={(e) =>
                setMeetingMode(e.target.value as KickoffMeetingMode)
              }
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
          <Button onClick={submit} disabled={submitting || !meetingDate}>
            {submitting ? 'Creating…' : 'Create'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
