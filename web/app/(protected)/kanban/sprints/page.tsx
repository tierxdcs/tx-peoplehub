'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { CalendarRange, Rocket } from 'lucide-react';
import {
  listAllSprints,
  listBoards,
  SPRINT_DURATION_LABEL,
  type KanbanBoard,
  type KanbanSprint,
  type SprintStatus,
} from '../../../lib/kanban';
import { PageContainer } from '../../../components/ui/page-container';
import { PageHeader } from '../../../components/ui/page-header';
import { Card, CardContent } from '../../../components/ui/card';
import { Badge, type BadgeVariant } from '../../../components/ui/badge';
import { EmptyState } from '../../../components/ui/empty-state';
import { Skeleton } from '../../../components/ui/skeleton';

const SECTIONS: { status: SprintStatus; title: string; variant: BadgeVariant }[] = [
  { status: 'ACTIVE', title: 'Active', variant: 'success' },
  { status: 'UPCOMING', title: 'Upcoming', variant: 'info' },
  { status: 'COMPLETED', title: 'Completed', variant: 'muted' },
];

function dateRange(start: string, end: string): string {
  const fmt = (iso: string) =>
    new Date(iso).toLocaleDateString(undefined, {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });
  return `${fmt(start)} – ${fmt(end)}`;
}

/**
 * Sprint page (spec §5): sprints across every board the employee belongs to,
 * grouped by computed status. Clicking a sprint opens its board with the
 * sprint filter pre-applied.
 */
export default function SprintsPage() {
  const router = useRouter();
  const [grouped, setGrouped] = useState<Record<SprintStatus, KanbanSprint[]> | null>(
    null,
  );
  const [boardNames, setBoardNames] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [sprints, boards] = await Promise.all([listAllSprints(), listBoards()]);
      setGrouped(sprints);
      setBoardNames(
        boards.reduce<Record<string, string>>((acc, b: KanbanBoard) => {
          acc[b.id] = b.name;
          return acc;
        }, {}),
      );
    } catch {
      setError('Failed to load sprints.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const total = grouped
    ? grouped.ACTIVE.length + grouped.UPCOMING.length + grouped.COMPLETED.length
    : 0;

  return (
    <PageContainer>
      <PageHeader
        title="Sprints"
        description="Sprints across every board you’re a member of."
      />

      {error && <p className="mb-4 text-sm text-destructive">{error}</p>}

      {loading ? (
        <div className="space-y-4">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-24 w-full" />
          ))}
        </div>
      ) : total === 0 ? (
        <Card>
          <CardContent className="p-0">
            <EmptyState
              icon={Rocket}
              title="No sprints yet"
              description="Sprints you can see will appear here, grouped by status."
            />
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-6">
          {SECTIONS.map((section) => {
            const items = grouped?.[section.status] ?? [];
            if (items.length === 0) return null;
            return (
              <section key={section.status}>
                <div className="mb-2 flex items-center gap-2">
                  <h2 className="text-sm font-semibold">{section.title}</h2>
                  <Badge variant={section.variant}>{items.length}</Badge>
                </div>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  {items.map((s) => (
                    <button
                      key={s.id}
                      type="button"
                      onClick={() =>
                        router.push(`/kanban/boards/${s.boardId}?sprint=${s.id}`)
                      }
                      className="text-left"
                    >
                      <Card className="h-full transition-colors hover:border-primary hover:bg-accent/40">
                        <CardContent className="space-y-2 p-4">
                          <div className="flex items-start justify-between gap-2">
                            <span className="font-medium leading-tight">{s.name}</span>
                            <Badge variant="outline">
                              {SPRINT_DURATION_LABEL[s.durationWeeks]}
                            </Badge>
                          </div>
                          <p className="text-xs text-muted-foreground">
                            {boardNames[s.boardId] ?? 'Board'}
                          </p>
                          <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                            <CalendarRange className="h-3.5 w-3.5" />
                            {dateRange(s.startDate, s.endDate)}
                          </p>
                          <p className="text-xs text-muted-foreground">
                            {s.cardCount} {s.cardCount === 1 ? 'card' : 'cards'}
                          </p>
                        </CardContent>
                      </Card>
                    </button>
                  ))}
                </div>
              </section>
            );
          })}
        </div>
      )}
    </PageContainer>
  );
}
