'use client';

import { useParams } from 'next/navigation';
import { useAuth } from '../../../lib/auth-context';
import {
  MiniOrgChart,
  useEmployeeOrgChart,
} from '../../../components/org-chart/mini-org-chart';
import { Avatar } from '../../../components/ui/avatar';
import {
  SCard,
  SCardTitle,
  SIGNAL_MUTED,
  SignalChip,
  SignalHeader,
  SignalPage,
} from '../../../components/ui/signal';
import { Skeleton } from '../../../components/ui/skeleton';
import { cn } from '../../../lib/utils';

/**
 * A colleague's directory profile — where an org-chart node leads. It shows only
 * what the (company-wide) org-chart endpoint returns: name, job title, vertical,
 * employee id, work email and the reporting structure around them. Anything
 * sensitive stays behind the existing HR/Admin screens; this page adds no new
 * read of employee data beyond the one org-chart request that also draws the
 * mini chart below.
 */
export default function PersonPage() {
  const params = useParams<{ id: string }>();
  const employeeId = params?.id;
  const { user } = useAuth();
  const { data, loading, error } = useEmployeeOrgChart(employeeId);
  const person = data?.employee;

  return (
    <SignalPage>
      <SignalHeader
        backHref="/profile?tab=org-chart"
        backLabel="Org chart"
        title={person ? person.fullName : 'Profile'}
        chip={
          person?.designation ? (
            <SignalChip>{person.designation}</SignalChip>
          ) : undefined
        }
      />

      <div className="space-y-4 px-5 pb-7 pt-[18px] lg:px-7">
        {loading && (
          <SCard className="p-4">
            <Skeleton className="h-14 w-64" />
          </SCard>
        )}

        {!loading && (error || !person) && (
          <SCard className="p-4">
            <p className={cn('text-[13px]', SIGNAL_MUTED)}>
              This employee could not be found.
            </p>
          </SCard>
        )}

        {person && (
          <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_420px]">
            <SCard className="p-4">
              <div className="flex items-center gap-3.5">
                <Avatar
                  name={person.fullName}
                  imageUrl={person.photoUrl}
                  className="size-14 text-lg"
                />
                <div className="min-w-0">
                  <div className="truncate text-[17px] font-bold tracking-[-.4px]">
                    {person.fullName}
                  </div>
                  <div className={cn('truncate text-[12.5px]', SIGNAL_MUTED)}>
                    {person.designation ?? 'No job title recorded'}
                  </div>
                </div>
              </div>

              <dl className="mt-4 grid gap-3 sm:grid-cols-2">
                <Detail label="Employee ID" value={person.employeeId} />
                <Detail label="Vertical" value={person.verticalName} />
                <Detail
                  label="Work email"
                  value={
                    <a
                      href={`mailto:${person.email}`}
                      className="text-primary hover:underline"
                    >
                      {person.email}
                    </a>
                  }
                />
                <Detail
                  label="Reports to"
                  value={data?.manager ? data.manager.fullName : '—'}
                />
                <Detail
                  label="Direct reports"
                  value={
                    person.directReportCount > 0
                      ? String(person.directReportCount)
                      : 'None'
                  }
                />
              </dl>
            </SCard>

            <SCard className="p-4">
              <SCardTitle
                title="Reporting structure"
                subtitle="Click anyone to open their profile"
              />
              <MiniOrgChart
                data={data}
                currentUserId={user?.sub}
                className="mt-4"
              />
            </SCard>
          </div>
        )}
      </div>
    </SignalPage>
  );
}

function Detail({
  label,
  value,
}: {
  label: string;
  value: React.ReactNode | null;
}) {
  return (
    <div>
      <dt
        className={cn(
          'text-[10px] font-medium uppercase tracking-wide',
          SIGNAL_MUTED,
        )}
      >
        {label}
      </dt>
      <dd className="mt-0.5 truncate text-[13px]">{value || '—'}</dd>
    </div>
  );
}
