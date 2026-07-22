'use client';

import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { CalendarClock, Rocket } from 'lucide-react';
import type { KanbanCard } from '../../../lib/kanban';
import { Avatar } from '../../../components/ui/avatar';
import { cn } from '../../../lib/utils';

/** Priority → a small colored dot. */
const PRIORITY_DOT: Record<KanbanCard['priority'], string> = {
  HIGH: 'bg-destructive',
  MEDIUM: 'bg-warning',
  LOW: 'bg-muted-foreground',
};

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
  });
}

/**
 * A draggable card tile in a list column. Shows label chips, title, priority
 * dot, assignee avatar, and a due-date pill (red when isOverdue). Clicking
 * (without dragging) opens the detail modal.
 */
export function CardTile({
  card,
  sprintName,
  onOpen,
  dndDisabled = false,
}: {
  card: KanbanCard;
  sprintName?: string;
  onOpen: (card: KanbanCard) => void;
  dndDisabled?: boolean;
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({
    id: card.id,
    data: { type: 'card', card },
    disabled: dndDisabled,
  });

  const style = {
    transform: CSS.Translate.toString(transform),
    transition,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...(!dndDisabled ? attributes : {})}
      {...(!dndDisabled ? listeners : {})}
      onClick={() => onOpen(card)}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onOpen(card);
        }
      }}
      className={cn(
        'min-h-11 cursor-pointer rounded-md border bg-card p-3 text-left shadow-sm transition-colors hover:border-primary md:p-2.5',
        isDragging && 'opacity-50',
      )}
    >
      {card.labels && card.labels.length > 0 && (
        <div className="mb-1.5 flex flex-wrap gap-1">
          {card.labels.map((l) => (
            <span
              key={l.id}
              title={l.name}
              className="h-2 w-8 rounded-full"
              style={{ backgroundColor: l.color }}
            />
          ))}
        </div>
      )}

      <p className="text-sm leading-snug">{card.title}</p>

      {sprintName && (
        <span
          className="mt-1.5 inline-flex max-w-full items-center gap-1 rounded bg-primary/10 px-1.5 py-0.5 text-[11px] text-primary"
          title={`Sprint: ${sprintName}`}
        >
          <Rocket className="h-3 w-3 shrink-0" />
          <span className="truncate">{sprintName}</span>
        </span>
      )}

      <div className="mt-2 flex items-center gap-2">
        <span
          className={cn(
            'h-2 w-2 shrink-0 rounded-full',
            PRIORITY_DOT[card.priority],
          )}
          title={`${card.priority} priority`}
        />
        {card.dueDate && (
          <span
            className={cn(
              'inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px]',
              card.isOverdue
                ? 'bg-destructive/10 text-destructive'
                : 'bg-muted text-muted-foreground',
            )}
          >
            <CalendarClock className="h-3 w-3" />
            {formatDate(card.dueDate)}
          </span>
        )}
        {card.assigneeName && (
          <span className="ml-auto" title={card.assigneeName}>
            <Avatar name={card.assigneeName} className="h-6 w-6 text-[10px]" />
          </span>
        )}
      </div>
    </div>
  );
}
