'use client';

import { useEffect, useState } from 'react';
import { Info } from 'lucide-react';
import { useAuth } from '../../lib/auth-context';
import { apiFetch, ApiError } from '../../lib/api';
import { Employee, SignatureFont, Vertical } from '../../lib/types';
import { SIGNATURE_FONTS } from '../../lib/signature';
import { PageContainer } from '../../components/ui/page-container';
import { PageHeader } from '../../components/ui/page-header';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from '../../components/ui/card';
import { Avatar } from '../../components/ui/avatar';
import { Badge } from '../../components/ui/badge';
import { Button } from '../../components/ui/button';
import { Skeleton } from '../../components/ui/skeleton';
import { SignatureEditorFields } from '../../components/ui/signature-setup-inline';
import { useToast } from '../../components/ui/toaster';
import { cn } from '../../lib/utils';
import { TeamSection } from '../_sections/team-section';
import { LeaveSection } from '../_sections/leave-section';
import { AttendanceSection } from '../_sections/attendance-section';
import { TeamLeaveApprovalsSection } from '../_sections/team-leave-approvals-section';
import { TeamAttendanceSection } from '../_sections/team-attendance-section';

type ProfileTab =
  | 'profile'
  | 'team'
  | 'team-approvals'
  | 'team-attendance'
  | 'leave'
  | 'attendance';

/** Small uppercase label above a value in the details grid. */
function DetailLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
      {children}
    </div>
  );
}

export default function ProfilePage() {
  const { user, loading: authLoading } = useAuth();
  const toast = useToast();
  const [employee, setEmployee] = useState<Employee | null>(null);
  const [verticalName, setVerticalName] = useState<string | null>(null);
  const [managerName, setManagerName] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const [sigText, setSigText] = useState('');
  const [sigFont, setSigFont] = useState<SignatureFont>(SIGNATURE_FONTS[0]);
  const [savingSig, setSavingSig] = useState(false);
  const [tab, setTab] = useState<ProfileTab>('profile');

  // Team self-service (roster + leave approvals) is manager/admin-only; the
  // team-attendance grid is MANAGER-only (its backend endpoint is), matching
  // the previous nav + page gating.
  const showTeam =
    user?.role === 'MANAGER' ||
    user?.role === 'ADMIN' ||
    user?.role === 'SUPER_ADMIN';
  const showTeamAttendance = user?.role === 'MANAGER';

  useEffect(() => {
    if (authLoading || !user) return;

    apiFetch<Employee>(`/employees/${user.sub}`)
      .then(async (me) => {
        setEmployee(me);
        setSigText(me.signatureText ?? '');
        setSigFont(me.signatureFont ?? SIGNATURE_FONTS[0]);

        if (me.verticalId) {
          // /verticals/me (own vertical) rather than the ADMIN-only
          // /verticals list — this page is reached by non-admins too.
          const vertical = await apiFetch<Vertical | null>('/verticals/me');
          setVerticalName(vertical?.name ?? null);
        }

        if (me.reportingManagerId) {
          const manager = await apiFetch<Employee>(
            `/employees/${me.reportingManagerId}`,
          );
          setManagerName(`${manager.firstName} ${manager.lastName}`);
        }
      })
      .finally(() => setLoading(false));
  }, [authLoading, user]);

  async function saveSignature() {
    if (!sigText.trim()) return;
    setSavingSig(true);
    try {
      const updated = await apiFetch<Employee>('/employees/me/signature', {
        method: 'PATCH',
        body: JSON.stringify({
          signatureText: sigText.trim(),
          signatureFont: sigFont,
        }),
      });
      setEmployee(updated);
      setSigText(updated.signatureText ?? '');
      setSigFont(updated.signatureFont ?? SIGNATURE_FONTS[0]);
      toast.success('Signature saved');
    } catch (err) {
      toast.error(
        err instanceof ApiError ? err.message : 'Failed to save signature',
      );
    } finally {
      setSavingSig(false);
    }
  }

  if (authLoading || loading || !employee) {
    return (
      <PageContainer>
        <Skeleton className="mb-6 h-9 w-48" />
        <Skeleton className="mb-4 h-40 w-full max-w-2xl" />
        <Skeleton className="h-56 w-full max-w-2xl" />
      </PageContainer>
    );
  }

  const fullName = `${employee.firstName} ${employee.lastName}`;

  const tabs: { key: ProfileTab; label: string }[] = [
    { key: 'profile', label: 'Profile' },
    ...(showTeam
      ? [
          { key: 'team' as const, label: 'My Team' },
          { key: 'team-approvals' as const, label: 'Leave Approvals' },
        ]
      : []),
    ...(showTeamAttendance
      ? [{ key: 'team-attendance' as const, label: 'Team Attendance' }]
      : []),
    { key: 'leave', label: 'My Leave' },
    { key: 'attendance', label: 'My Attendance' },
  ];

  return (
    <PageContainer>
      <PageHeader title="My Profile" />

      {/* Tab bar — Profile details plus the personal self-service sections. */}
      <div className="mb-6 flex gap-1 border-b">
        {tabs.map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() => setTab(t.key)}
            className={cn(
              '-mb-px border-b-2 px-4 py-2 text-sm font-medium transition-colors',
              tab === t.key
                ? 'border-primary text-primary'
                : 'border-transparent text-muted-foreground hover:text-foreground',
            )}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'team' && <TeamSection embedded />}
      {tab === 'team-approvals' && <TeamLeaveApprovalsSection embedded />}
      {tab === 'team-attendance' && <TeamAttendanceSection embedded />}
      {tab === 'leave' && <LeaveSection embedded />}
      {tab === 'attendance' && <AttendanceSection embedded />}

      {tab === 'profile' && (
        <>
      {/* Profile header card: identity up top, details row below a divider. */}
      <Card className="mb-4 max-w-2xl">
        <CardContent className="p-6">
          <div className="flex items-center gap-4">
            <Avatar name={fullName} className="size-14 text-lg" />
            <div className="min-w-0">
              <div className="truncate text-xl font-semibold tracking-tight">
                {fullName}
              </div>
              <div className="truncate text-sm text-muted-foreground">
                {employee.employeeId} · {employee.email}
              </div>
            </div>
          </div>

          <div className="my-5 border-t" />

          <div className="grid gap-6 sm:grid-cols-3">
            <div>
              <DetailLabel>Vertical</DetailLabel>
              <div className="mt-1.5">
                {verticalName ? (
                  <Badge variant="muted">{verticalName}</Badge>
                ) : (
                  <span className="text-sm text-muted-foreground">—</span>
                )}
              </div>
            </div>
            <div>
              <DetailLabel>Role</DetailLabel>
              <div className="mt-1.5">
                {employee.role ? (
                  <Badge variant="muted">{employee.role}</Badge>
                ) : (
                  <span className="text-sm text-muted-foreground">—</span>
                )}
              </div>
            </div>
            <div>
              <DetailLabel>Manager</DetailLabel>
              <div className="mt-1.5">
                {managerName ? (
                  <div className="flex items-center gap-2">
                    <Avatar name={managerName} className="size-6 text-[10px]" />
                    <span className="text-sm font-medium">{managerName}</span>
                  </div>
                ) : (
                  <span className="text-sm text-muted-foreground">—</span>
                )}
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Signature card. */}
      <Card className="max-w-2xl">
        <CardHeader>
          <CardTitle>Signature</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4 pt-0">
          <div className="flex gap-3 rounded-md border bg-muted/40 p-3 text-sm text-muted-foreground">
            <Info className="mt-0.5 size-4 shrink-0" />
            <p>
              Your internal e-signature is applied when you approve requests.
              This is a display convenience, not a legally-binding e-signature.
            </p>
          </div>

          <SignatureEditorFields
            text={sigText}
            font={sigFont}
            onTextChange={setSigText}
            onFontChange={setSigFont}
            disabled={savingSig}
          />

          <Button
            onClick={saveSignature}
            disabled={savingSig || !sigText.trim()}
          >
            {savingSig ? 'Saving…' : 'Save signature'}
          </Button>
        </CardContent>
      </Card>
        </>
      )}
    </PageContainer>
  );
}
