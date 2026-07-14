'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { LayoutGrid, Users } from 'lucide-react';
import { listBoards, type KanbanBoard } from '../../lib/kanban';
import { useIsScrumMaster } from '../../lib/use-is-scrum-master';
import { useAuth } from '../../lib/auth-context';
import { PageContainer } from '../../components/ui/page-container';
import { PageHeader } from '../../components/ui/page-header';
import { Button } from '../../components/ui/button';
import { Card, CardContent } from '../../components/ui/card';
import { Badge } from '../../components/ui/badge';
import { EmptyState } from '../../components/ui/empty-state';
import { Skeleton } from '../../components/ui/skeleton';
import { CreateBoardDialog } from './_components/create-board-dialog';

/**
 * Kanban landing (spec §1): the boards the current employee is a member of,
 * as tiles. SUPER_ADMIN sees every board (server override). "New Board" is
 * shown only to Scrum Master / SUPER_ADMIN.
 */
export default function KanbanBoardsPage() {
  const router = useRouter();
  const { user } = useAuth();
  const { isScrumMaster } = useIsScrumMaster();
  const isSuperAdmin = user?.role === 'SUPER_ADMIN';
  const canCreate = isSuperAdmin || isScrumMaster;

  const [boards, setBoards] = useState<KanbanBoard[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setBoards(await listBoards());
    } catch {
      setError('Failed to load boards.');
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
        title="Boards"
        description="Kanban boards you’re a member of."
        action={
          canCreate ? (
            <Button onClick={() => setCreating(true)}>+ New Board</Button>
          ) : undefined
        }
      />

      {error && <p className="mb-4 text-sm text-destructive">{error}</p>}

      {loading ? (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-24 w-full" />
          ))}
        </div>
      ) : boards.length === 0 ? (
        <Card>
          <CardContent className="p-0">
            <EmptyState
              icon={LayoutGrid}
              title="No boards yet"
              description={
                canCreate
                  ? 'Create your first board to start organising work.'
                  : 'You’re not a member of any board yet. A Scrum Master can add you to one.'
              }
            />
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {boards.map((b) => (
            <button
              key={b.id}
              type="button"
              onClick={() => router.push(`/kanban/boards/${b.id}`)}
              className="text-left"
            >
              <Card className="h-full transition-colors hover:border-primary hover:bg-accent/40">
                <CardContent className="flex h-full flex-col gap-3 p-4">
                  <div className="flex items-start justify-between gap-2">
                    <span className="font-semibold leading-tight">{b.name}</span>
                    {b.createdById === user?.sub && (
                      <Badge variant="muted">Creator</Badge>
                    )}
                  </div>
                  <span className="mt-auto flex items-center gap-1.5 text-xs text-muted-foreground">
                    <Users className="h-3.5 w-3.5" />
                    {b.memberCount} {b.memberCount === 1 ? 'member' : 'members'}
                  </span>
                </CardContent>
              </Card>
            </button>
          ))}
        </div>
      )}

      {creating && (
        <CreateBoardDialog
          onClose={() => setCreating(false)}
          onCreated={(id) => {
            setCreating(false);
            router.push(`/kanban/boards/${id}`);
          }}
        />
      )}
    </PageContainer>
  );
}
