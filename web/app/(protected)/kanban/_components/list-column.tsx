'use client';

import { useState } from 'react';
import { useDroppable } from '@dnd-kit/core';
import {
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { CheckCircle2, GripVertical, Plus } from 'lucide-react';
import type { KanbanCard, KanbanList } from '../../../lib/kanban';
import { Badge } from '../../../components/ui/badge';
import { Button } from '../../../components/ui/button';
import { Textarea } from '../../../components/ui/textarea';
import { cn } from '../../../lib/utils';
import { CardTile } from './card-tile';

/**
 * One list column: draggable header (reorder — Scrum Master/SuperAdmin only),
 * a done-list marker + active card count, its cards as a sortable list, and an
 * "add a card" inline composer (any member). When `dndDisabled` (filtered
 * view), cards render statically.
 */
export function ListColumn({
  list,
  cards,
  canManage,
  canEditCard,
  dndDisabled,
  sprintNames,
  onOpenCard,
  onAddCard,
}: {
  list: KanbanList;
  cards: KanbanCard[];
  canManage: boolean;
  canEditCard: (card: KanbanCard) => boolean;
  dndDisabled: boolean;
  /** Map of sprintId → sprint name, for the card-face sprint chip. */
  sprintNames: Record<string, string>;
  onOpenCard: (card: KanbanCard) => void;
  onAddCard: (listId: string, title: string) => Promise<void>;
}) {
  const {
    attributes,
    listeners,
    setNodeRef: setSortableRef,
    transform,
    transition,
    isDragging,
  } = useSortable({
    id: list.id,
    data: { type: 'list' },
    disabled: !canManage || dndDisabled,
  });

  // Cards drop into this list's droppable area (id === list id).
  const { setNodeRef: setDropRef } = useDroppable({
    id: list.id,
    data: { type: 'list', listId: list.id },
  });

  const [adding, setAdding] = useState(false);
  const [title, setTitle] = useState('');
  const [saving, setSaving] = useState(false);

  async function submit() {
    const t = title.trim();
    if (!t) return;
    setSaving(true);
    try {
      await onAddCard(list.id, t);
      setTitle('');
      setAdding(false);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div
      ref={setSortableRef}
      style={{ transform: CSS.Translate.toString(transform), transition }}
      className={cn(
        'flex w-72 shrink-0 flex-col rounded-lg bg-muted/50',
        isDragging && 'opacity-60',
      )}
    >
      <div className="flex items-center gap-1.5 px-3 py-2">
        {canManage && !dndDisabled && (
          <button
            type="button"
            aria-label="Reorder list"
            className="cursor-grab touch-none text-muted-foreground hover:text-foreground"
            {...attributes}
            {...listeners}
          >
            <GripVertical className="h-4 w-4" />
          </button>
        )}
        <span className="truncate text-sm font-semibold">{list.name}</span>
        {list.isDoneList && (
          <Badge variant="success" className="gap-1 px-1.5 py-0 text-[10px]">
            <CheckCircle2 className="h-3 w-3" aria-hidden="true" /> Done
          </Badge>
        )}
        <Badge variant="muted" className="ml-auto">
          {cards.length}
        </Badge>
      </div>

      <div
        ref={setDropRef}
        className="flex min-h-2 flex-1 flex-col gap-2 px-2 pb-2"
      >
        <SortableContext
          items={cards.map((c) => c.id)}
          strategy={verticalListSortingStrategy}
        >
          {cards.map((card) => (
            <CardTile
              key={card.id}
              card={card}
              sprintName={
                card.sprintId ? sprintNames[card.sprintId] : undefined
              }
              onOpen={onOpenCard}
              dndDisabled={dndDisabled || !canEditCard(card)}
            />
          ))}
        </SortableContext>

        {cards.length === 0 && !adding && (
          <p className="px-1 py-3 text-center text-xs text-muted-foreground">
            No cards yet.
          </p>
        )}

        {adding ? (
          <div className="space-y-2 rounded-md border bg-card p-2">
            <Textarea
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Card title…"
              rows={2}
              autoFocus
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  void submit();
                }
                if (e.key === 'Escape') {
                  setAdding(false);
                  setTitle('');
                }
              }}
            />
            <div className="flex gap-2">
              <Button
                size="sm"
                onClick={submit}
                disabled={saving || !title.trim()}
              >
                {saving ? 'Adding…' : 'Add card'}
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => {
                  setAdding(false);
                  setTitle('');
                }}
              >
                Cancel
              </Button>
            </div>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setAdding(true)}
            className="flex items-center gap-1.5 rounded-md px-2 py-1.5 text-left text-sm text-muted-foreground hover:bg-accent hover:text-foreground"
          >
            <Plus className="h-4 w-4" /> Add a card
          </button>
        )}
      </div>
    </div>
  );
}
