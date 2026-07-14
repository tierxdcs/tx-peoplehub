'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Users } from 'lucide-react';
import { useAuth, roleHome } from '../../lib/auth-context';
import { apiFetch } from '../../lib/api';
import { Employee } from '../../lib/types';
import { PageContainer } from '../../components/ui/page-container';
import { PageHeader } from '../../components/ui/page-header';
import { Card, CardContent } from '../../components/ui/card';
import { Badge } from '../../components/ui/badge';
import { Avatar } from '../../components/ui/avatar';
import { EmptyState } from '../../components/ui/empty-state';
import { Skeleton } from '../../components/ui/skeleton';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '../../components/ui/table';

/**
 * My Team content. Rendered both as its own page (/team) and as a tab inside
 * the profile page. When `embedded`, it drops the PageContainer/PageHeader
 * chrome (the host provides those) and never redirects on access — the host
 * decides whether to show this tab at all.
 */
export function TeamSection({ embedded = false }: { embedded?: boolean }) {
  const { user, loading: authLoading } = useAuth();
  const router = useRouter();
  const [team, setTeam] = useState<Employee[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const allowed =
    user?.role === 'MANAGER' ||
    user?.role === 'ADMIN' ||
    user?.role === 'SUPER_ADMIN';

  useEffect(() => {
    if (authLoading || !user) return;
    // Standalone route guards by redirecting; embedded never redirects (the
    // profile page only mounts this tab for allowed roles).
    if (!allowed) {
      if (!embedded) router.replace(roleHome(user.role));
      return;
    }
    apiFetch<Employee[]>(`/employees/${user.sub}/team`)
      .then(setTeam)
      .catch(() => setError('Failed to load your team'))
      .finally(() => setLoading(false));
  }, [authLoading, user, allowed, router, embedded]);

  if (authLoading || !user || !allowed) return null;

  const body = (
    <>
      {error && <p className="mb-4 text-sm text-destructive">{error}</p>}

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Role</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                Array.from({ length: 4 }).map((_, i) => (
                  <TableRow key={i}>
                    <TableCell>
                      <Skeleton className="h-8 w-48" />
                    </TableCell>
                    <TableCell>
                      <Skeleton className="h-4 w-20" />
                    </TableCell>
                  </TableRow>
                ))
              ) : team.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={2} className="p-0">
                    <EmptyState
                      icon={Users}
                      title="No reports"
                      description="You don't have any direct or indirect reports yet."
                    />
                  </TableCell>
                </TableRow>
              ) : (
                team.map((e) => (
                  <TableRow key={e.id}>
                    <TableCell>
                      <div className="flex items-center gap-3">
                        <Avatar name={`${e.firstName} ${e.lastName}`} />
                        <div>
                          <div className="font-medium">
                            {e.firstName} {e.lastName}
                          </div>
                          <div className="text-xs text-muted-foreground">
                            {e.employeeId}
                          </div>
                        </div>
                      </div>
                    </TableCell>
                    <TableCell>
                      <Badge variant="muted">{e.role ?? '—'}</Badge>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </>
  );

  if (embedded) return body;
  return (
    <PageContainer>
      <PageHeader
        title="My Team"
        description="Direct and indirect reports — flat list."
      />
      {body}
    </PageContainer>
  );
}
