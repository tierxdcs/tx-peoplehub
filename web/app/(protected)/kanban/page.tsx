'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ClipboardList, LayoutGrid, Users } from 'lucide-react';
import { listBoards, type KanbanBoard } from '../../lib/kanban';
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
 * as tiles. SUPER_ADMIN sees every board (server override). Any employee can
 * create a board.
 */
export default function KanbanBoardsPage() {
  const router = useRouter();
  const { user } = useAuth();

  const [boards, setBoards] = useState<KanbanBoard[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [boardFilter, setBoardFilter] = useState<'all' | 'customer' | 'personal'>('all');

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

  const filteredBoards = boards.filter((board) =>
    boardFilter === 'all' || board.isCustomerBoard === (boardFilter === 'customer'),
  );

  return (
    <PageContainer>
      <PageHeader
        title="Boards"
        description="Kanban boards you’re a member of."
        action={<Button onClick={() => setCreating(true)}>+ New Board</Button>}
      />

      {error && <p className="mb-4 text-sm text-destructive">{error}</p>}

      <div className="mb-6 flex flex-wrap gap-2 border-b pb-4">
        {(['all', 'customer', 'personal'] as const).map((filter) => (
          <Button
            key={filter}
            size="sm"
            variant={boardFilter === filter ? 'secondary' : 'ghost'}
            onClick={() => setBoardFilter(filter)}
          >
            {filter === 'all' ? 'All boards' : filter === 'customer' ? 'Customer boards' : 'Personal boards'}
            <span className="text-xs text-muted-foreground">
              {filter === 'all' ? boards.length : boards.filter((board) => board.isCustomerBoard === (filter === 'customer')).length}
            </span>
          </Button>
        ))}
      </div>

      {loading ? (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-24 w-full" />
          ))}
        </div>
      ) : filteredBoards.length === 0 ? (
        <Card>
          <CardContent className="p-0">
            <EmptyState
              icon={LayoutGrid}
              title={boards.length === 0 ? 'No boards yet' : 'No boards in this view'}
              description={boards.length === 0 ? 'Create your first board to start organising work.' : 'Try another board filter.'}
            />
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {filteredBoards.map((b) => (
            <button
              key={b.id}
              type="button"
              onClick={() => router.push(`/kanban/boards/${b.id}`)}
              className="text-left"
            >
              <Card className={`h-full transition-colors hover:border-primary hover:bg-accent/40 ${b.taskCounts.overdue > 0 ? 'border-destructive/60' : ''}`}>
                <CardContent className="flex h-full flex-col gap-3 p-4">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <span className="block font-semibold leading-tight">{b.name}</span>
                      <span className="mt-1 block text-xs text-muted-foreground">
                        {b.isCustomerBoard ? 'Customer board' : 'Personal board'}
                      </span>
                    </div>
                    {b.createdById === user?.sub && (
                      <Badge variant="muted">Creator</Badge>
                    )}
                  </div>
                  <div className="grid grid-cols-3 gap-2 border-y py-2 text-xs">
                    <span><strong className="block text-sm">{b.taskCounts.todo}</strong>To do</span>
                    <span><strong className="block text-sm">{b.taskCounts.inProgress}</strong>In progress</span>
                    <span><strong className="block text-sm">{b.taskCounts.complete}</strong>Complete</span>
                  </div>
                  {b.taskCounts.overdue > 0 && (
                    <span className="flex items-center gap-1.5 text-xs font-medium text-destructive">
                      <ClipboardList className="h-3.5 w-3.5" />
                      {b.taskCounts.overdue} overdue {b.taskCounts.overdue === 1 ? 'task' : 'tasks'}
                    </span>
                  )}
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
