'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { ExternalLink, ListChecks } from 'lucide-react';
import {
  filterMyCards,
  myCards,
  type MyCard,
  type TaskFilter,
} from '../../lib/dashboard';
import { useRegisterList } from '../../lib/use-register-list';
import { PageContainer } from '../../components/ui/page-container';
import { PageHeader } from '../../components/ui/page-header';
import { RegisterToolbar } from '../../components/ui/register-toolbar';
import { RegisterPagination } from '../../components/ui/register-pagination';
import { Card, CardContent } from '../../components/ui/card';
import { Select } from '../../components/ui/select';
import { buttonVariants } from '../../components/ui/button';
import { EmptyState } from '../../components/ui/empty-state';
import { StatusBadge } from '../../components/ui/status-badge';
import { Spinner } from '../../components/ui/spinner';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '../../components/ui/table';

const FILTERS: { value: TaskFilter; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'assigned', label: 'Assigned' },
  { value: 'completed', label: 'Completed' },
  { value: 'due-soon', label: 'Due Soon' },
  { value: 'overdue', label: 'Overdue' },
];
const VALID_FILTERS = new Set<TaskFilter>(FILTERS.map(({ value }) => value));

function searchableTask(card: MyCard): string {
  return `${card.title} ${card.boardName ?? ''}`;
}

function displayStatus(card: MyCard, now: Date): string {
  if (card.isDone) return 'COMPLETED';
  if (card.isOverdue) return 'OVERDUE';
  if (filterMyCards([card], 'due-soon', now).length > 0) return 'DUE_SOON';
  return 'ASSIGNED';
}

export default function MyTasksPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const requestedFilter = searchParams.get('status') as TaskFilter | null;
  const filter =
    requestedFilter && VALID_FILTERS.has(requestedFilter)
      ? requestedFilter
      : 'all';
  const now = useMemo(() => new Date(), []);
  const [cards, setCards] = useState<MyCard[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setCards(await myCards());
      window.sessionStorage.removeItem('kanban-dashboard-dirty');
    } catch {
      setError('Failed to load your tasks');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    const refreshIfDirty = () => {
      if (window.sessionStorage.getItem('kanban-dashboard-dirty') === '1') {
        void load();
      }
    };
    window.addEventListener('focus', refreshIfDirty);
    window.addEventListener('pageshow', refreshIfDirty);
    return () => {
      window.removeEventListener('focus', refreshIfDirty);
      window.removeEventListener('pageshow', refreshIfDirty);
    };
  }, [load]);

  const categoryCards = useMemo(
    () =>
      [...filterMyCards(cards, filter, now)].sort((a, b) => {
        if (!a.dueDate && !b.dueDate) return a.title.localeCompare(b.title);
        if (!a.dueDate) return 1;
        if (!b.dueDate) return -1;
        return new Date(a.dueDate).getTime() - new Date(b.dueDate).getTime();
      }),
    [cards, filter, now],
  );
  const register = useRegisterList(categoryCards, searchableTask, 20);

  function changeFilter(next: TaskFilter) {
    router.replace(next === 'all' ? '/my-tasks' : `/my-tasks?status=${next}`);
  }

  return (
    <PageContainer>
      <PageHeader
        title="My Tasks"
        description="Every Kanban task assigned to you across all boards."
      />

      <RegisterToolbar
        title="Task Register"
        search={register.search}
        onSearchChange={register.setSearch}
        searchPlaceholder="Search task or board"
        filters={
          <Select
            value={filter}
            onChange={(event) => changeFilter(event.target.value as TaskFilter)}
            aria-label="Task status"
            className="w-full sm:w-44"
          >
            {FILTERS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </Select>
        }
      />

      {error && <p className="mb-3 text-sm text-destructive">{error}</p>}
      {loading ? (
        <div className="flex min-h-48 items-center justify-center">
          <Spinner />
        </div>
      ) : (
        <>
          <Card>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Task</TableHead>
                    <TableHead>Board</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Due date</TableHead>
                    <TableHead className="w-24">Action</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {register.visibleItems.map((card) => (
                    <TableRow key={card.id}>
                      <TableCell className="font-medium">
                        <Link
                          href={`/kanban/cards/${card.id}`}
                          className="text-primary hover:underline"
                        >
                          {card.title}
                        </Link>
                      </TableCell>
                      <TableCell>{card.boardName ?? '—'}</TableCell>
                      <TableCell>
                        <StatusBadge value={displayStatus(card, now)} />
                      </TableCell>
                      <TableCell>
                        {card.dueDate
                          ? new Intl.DateTimeFormat('en-IN', {
                              dateStyle: 'medium',
                            }).format(new Date(card.dueDate))
                          : '—'}
                      </TableCell>
                      <TableCell>
                        <Link
                          href={`/kanban/cards/${card.id}`}
                          className={buttonVariants({
                            variant: 'outline',
                            size: 'sm',
                          })}
                        >
                          Open <ExternalLink className="size-3.5" />
                        </Link>
                      </TableCell>
                    </TableRow>
                  ))}
                  {register.visibleItems.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={5} className="p-0">
                        <EmptyState
                          icon={ListChecks}
                          title="No tasks match this view"
                          description="Try another status or clear the search."
                        />
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
          <RegisterPagination
            page={register.page}
            pageCount={register.pageCount}
            onPageChange={register.setPage}
          />
        </>
      )}
    </PageContainer>
  );
}
