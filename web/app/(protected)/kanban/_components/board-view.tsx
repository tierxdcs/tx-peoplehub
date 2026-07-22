'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  closestCorners,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragOverEvent,
  type DragStartEvent,
} from '@dnd-kit/core';
import {
  SortableContext,
  arrayMove,
  horizontalListSortingStrategy,
} from '@dnd-kit/sortable';
import { LayoutGrid, Plus, Settings, Users } from 'lucide-react';
import {
  createCard,
  createList,
  filterBoardCards,
  getBoard,
  listCards,
  listLabels,
  listLists,
  listMembers,
  listBoardSprints,
  moveCard,
  positionForIndex,
  reorderList,
  type CardFilter,
  type KanbanBoard,
  type KanbanBoardMember,
  type KanbanCard,
  type KanbanLabel,
  type KanbanList,
  type KanbanSprint,
} from '../../../lib/kanban';
import { ApiError } from '../../../lib/api';
import { useAuth } from '../../../lib/auth-context';
import { useIsScrumMaster } from '../../../lib/use-is-scrum-master';
import { useIsMobile } from '../../../lib/use-is-mobile';
import { cn } from '../../../lib/utils';
import { useToast } from '../../../components/ui/toaster';
import { PageContainer } from '../../../components/ui/page-container';
import { Button } from '../../../components/ui/button';
import { Avatar } from '../../../components/ui/avatar';
import { Skeleton } from '../../../components/ui/skeleton';
import { EmptyState } from '../../../components/ui/empty-state';
import { CardTile } from './card-tile';
import { ListColumn } from './list-column';
import { FilterBar } from './filter-bar';
import { CardModal } from './card-modal';
import { ManageBoardDialog } from './manage-board-dialog';
import { CreateListDialog } from './create-list-dialog';

type CardsByList = Record<string, KanbanCard[]>;

function groupByList(lists: KanbanList[], cards: KanbanCard[]): CardsByList {
  const map: CardsByList = {};
  for (const l of lists) map[l.id] = [];
  for (const c of cards) {
    (map[c.listId] ??= []).push(c);
  }
  for (const id of Object.keys(map)) {
    map[id].sort((a, b) => a.position - b.position);
  }
  return map;
}

/**
 * The board (spec §3): header (members + manage + new list), filter bar, and
 * lists-as-columns with drag-and-drop. A card can be deep-linked open via
 * `initialOpenCardId`. Applying any filter re-queries the server-side filtered
 * endpoint and disables DnD (a filtered subset isn't a reorderable board).
 */
export function BoardView({
  boardId,
  initialOpenCardId,
  initialSprintId,
}: {
  boardId: string;
  initialOpenCardId?: string;
  initialSprintId?: string;
}) {
  const router = useRouter();
  const { user } = useAuth();
  const toast = useToast();
  const { isScrumMaster } = useIsScrumMaster();
  const isSuperAdmin = user?.role === 'SUPER_ADMIN';
  const isMobile = useIsMobile();

  const [board, setBoard] = useState<KanbanBoard | null>(null);
  const [lists, setLists] = useState<KanbanList[]>([]);
  const [cardsByList, setCardsByList] = useState<CardsByList>({});
  const [members, setMembers] = useState<KanbanBoardMember[]>([]);
  const [sprints, setSprints] = useState<KanbanSprint[]>([]);
  const [labels, setLabels] = useState<KanbanLabel[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [forbidden, setForbidden] = useState(false);

  const [filter, setFilter] = useState<CardFilter>(
    initialSprintId ? { sprintId: initialSprintId } : {},
  );
  const filterActive = Object.keys(filter).length > 0;

  const [openCard, setOpenCard] = useState<KanbanCard | null>(null);
  const [manageOpen, setManageOpen] = useState(false);
  const [showMembers, setShowMembers] = useState(false);
  const [addingList, setAddingList] = useState(false);
  const [activeCard, setActiveCard] = useState<KanbanCard | null>(null);
  const [mobileListIndex, setMobileListIndex] = useState(0);
  const mobileBoardRef = useRef<HTMLDivElement>(null);

  // Board-wide management (sprints/members/labels) is SUPER_ADMIN, or a Scrum
  // Master who is a member — no creator exception. The board fetch already
  // proved membership (403 otherwise), so the flag is enough.
  const canManageBoard = Boolean(isSuperAdmin || isScrumMaster);
  // List management additionally carves out the board's own creator, mirroring
  // KanbanAccessService.assertCanManageLists.
  const canManageLists = canManageBoard || board?.createdById === user?.sub;

  // sprintId → name, for the sprint chip on each card face.
  const sprintNames = useMemo(
    () => Object.fromEntries(sprints.map((s) => [s.id, s.name])),
    [sprints],
  );

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
  );

  // ── loading ────────────────────────────────────────────────────────
  const loadShell = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [b, ls, ms, ss, lbs] = await Promise.all([
        getBoard(boardId),
        listLists(boardId),
        listMembers(boardId),
        listBoardSprints(boardId),
        listLabels(boardId),
      ]);
      setBoard(b);
      setLists(ls);
      setMembers(ms);
      setSprints(ss);
      setLabels(lbs);
    } catch (err) {
      if (err instanceof ApiError && err.statusCode === 403) setForbidden(true);
      else setError('Failed to load board.');
    } finally {
      setLoading(false);
    }
  }, [boardId]);

  // Cards: per-list when unfiltered (preserves list grouping + order), or the
  // server-side filtered set when a filter is active.
  const loadCards = useCallback(
    async (currentLists: KanbanList[], currentFilter: CardFilter) => {
      try {
        if (Object.keys(currentFilter).length > 0) {
          const cards = await filterBoardCards(boardId, currentFilter);
          setCardsByList(groupByList(currentLists, cards));
        } else {
          const perList = await Promise.all(
            currentLists.map((l) => listCards(l.id)),
          );
          const map: CardsByList = {};
          currentLists.forEach((l, i) => {
            map[l.id] = perList[i];
          });
          setCardsByList(map);
        }
      } catch {
        setError('Failed to load cards.');
      }
    },
    [boardId],
  );

  useEffect(() => {
    void loadShell();
  }, [loadShell]);

  useEffect(() => {
    if (!loading && !forbidden && lists.length >= 0 && board) {
      void loadCards(lists, filter);
    }
    // Re-run when the list set or filter changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lists, filter, loading, forbidden, board]);

  // Deep-link: once the board is loaded, open the requested card.
  const openedDeepLink = useRef(false);
  useEffect(() => {
    if (openedDeepLink.current || !initialOpenCardId || loading) return;
    const all = Object.values(cardsByList).flat();
    const found = all.find((c) => c.id === initialOpenCardId);
    if (found) {
      openedDeepLink.current = true;
      setOpenCard(found);
    }
  }, [initialOpenCardId, cardsByList, loading]);

  // ── helpers ──────────────────────────────────────────────────────────
  const listOf = useCallback(
    (cardId: string): string | undefined => {
      for (const [listId, cards] of Object.entries(cardsByList)) {
        if (cards.some((c) => c.id === cardId)) return listId;
      }
      return undefined;
    },
    [cardsByList],
  );

  async function addCard(listId: string, title: string) {
    try {
      const created = await createCard(listId, { title });
      setCardsByList((prev) => ({
        ...prev,
        [listId]: [...(prev[listId] ?? []), created],
      }));
    } catch (err) {
      toast.error(
        err instanceof ApiError ? err.message : 'Failed to add card.',
      );
    }
  }

  function appendPositionForList(listId: string): number {
    const positions = (cardsByList[listId] ?? [])
      .filter((card) => card.id !== openCard?.id)
      .map((card) => card.position)
      .sort((a, b) => a - b);
    return positionForIndex(positions, positions.length);
  }

  function reconcileModalMove(moved: KanbanCard) {
    setCardsByList((prev) => {
      const next: CardsByList = {};
      for (const [listId, cards] of Object.entries(prev)) {
        next[listId] = cards.filter((card) => card.id !== moved.id);
      }
      next[moved.listId] = [...(next[moved.listId] ?? []), moved].sort(
        (a, b) => a.position - b.position,
      );
      return next;
    });
    setOpenCard(moved);
  }

  // ── drag and drop ────────────────────────────────────────────────────
  function onDragStart(e: DragStartEvent) {
    const data = e.active.data.current;
    if (data?.type === 'card') setActiveCard(data.card as KanbanCard);
  }

  // Move a card between containers live so it renders in the hovered list.
  function onDragOver(e: DragOverEvent) {
    const { active, over } = e;
    if (!over) return;
    if (active.data.current?.type !== 'card') return;

    const activeId = String(active.id);
    const fromList = listOf(activeId);
    // The over target is either a card (→ its list) or a list droppable.
    const overData = over.data.current;
    const toList =
      overData?.type === 'list' ? String(over.id) : listOf(String(over.id));
    if (!fromList || !toList || fromList === toList) return;

    setCardsByList((prev) => {
      const from = [...(prev[fromList] ?? [])];
      const to = [...(prev[toList] ?? [])];
      const idx = from.findIndex((c) => c.id === activeId);
      if (idx === -1) return prev;
      const [moved] = from.splice(idx, 1);
      // Insert at the position of the hovered card, or append.
      const overIdx = to.findIndex((c) => c.id === String(over.id));
      if (overIdx === -1) to.push({ ...moved, listId: toList });
      else to.splice(overIdx, 0, { ...moved, listId: toList });
      return { ...prev, [fromList]: from, [toList]: to };
    });
  }

  async function onDragEnd(e: DragEndEvent) {
    const { active, over } = e;
    setActiveCard(null);
    if (!over) return;

    // List reordering.
    if (active.data.current?.type === 'list') {
      if (active.id === over.id) return;
      const oldIdx = lists.findIndex((l) => l.id === active.id);
      const newIdx = lists.findIndex((l) => l.id === over.id);
      if (oldIdx === -1 || newIdx === -1) return;
      const reordered = arrayMove(lists, oldIdx, newIdx);
      setLists(reordered);
      const others = reordered
        .filter((l) => l.id !== active.id)
        .map((l) => l.position);
      const position = positionForIndex(others, newIdx);
      try {
        const updated = await reorderList(String(active.id), position);
        setLists((prev) =>
          prev
            .map((l) => (l.id === updated.id ? updated : l))
            .sort((a, b) => a.position - b.position),
        );
      } catch (err) {
        toast.error(
          err instanceof ApiError ? err.message : 'Failed to reorder list.',
        );
        void loadShell();
      }
      return;
    }

    // Card move/reorder. Cross-list moves are already applied to state by
    // onDragOver; a WITHIN-list reorder isn't (onDragOver skips same-list), so
    // reorder here when dropping over another card in the same list.
    if (active.data.current?.type === 'card') {
      const cardId = String(active.id);
      const toList = listOf(cardId);
      if (!toList) return;
      let cards = cardsByList[toList] ?? [];
      const overId = String(over.id);
      if (overId !== cardId && over.data.current?.type !== 'list') {
        const from = cards.findIndex((c) => c.id === cardId);
        const to = cards.findIndex((c) => c.id === overId);
        if (from !== -1 && to !== -1 && from !== to) {
          cards = arrayMove(cards, from, to);
          setCardsByList((prev) => ({ ...prev, [toList]: cards }));
        }
      }
      const index = cards.findIndex((c) => c.id === cardId);
      const others = cards
        .filter((c) => c.id !== cardId)
        .map((c) => c.position);
      const position = positionForIndex(others, index);
      try {
        const updated = await moveCard(cardId, toList, position);
        // Reconcile the moved card's persisted position.
        setCardsByList((prev) => {
          const next = { ...prev };
          next[toList] = (next[toList] ?? [])
            .map((c) => (c.id === updated.id ? updated : c))
            .sort((a, b) => a.position - b.position);
          return next;
        });
      } catch (err) {
        toast.error(
          err instanceof ApiError ? err.message : 'Failed to move card.',
        );
        void loadCards(lists, filter);
      }
    }
  }

  // ── render ─────────────────────────────────────────────────────────
  if (forbidden) {
    return (
      <PageContainer>
        <EmptyState
          icon={LayoutGrid}
          title="You don’t have access to this board"
          description="You’re not a member of this board. Ask a Scrum Master to add you."
        />
        <div className="mt-4 flex justify-center">
          <Button variant="outline" onClick={() => router.push('/kanban')}>
            Back to boards
          </Button>
        </div>
      </PageContainer>
    );
  }

  if (loading || !board) {
    return (
      <PageContainer>
        <Skeleton className="mb-4 h-8 w-64" />
        <div className="flex gap-4">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-96 w-72" />
          ))}
        </div>
      </PageContainer>
    );
  }

  return (
    <PageContainer>
      {/* Header */}
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={() => router.push('/kanban')}
          className="text-sm text-muted-foreground hover:text-foreground"
        >
          Boards
        </button>
        <span className="text-muted-foreground">/</span>
        <h1 className="text-xl font-semibold tracking-tight">{board.name}</h1>

        <div className="ml-auto flex items-center gap-2">
          <button
            type="button"
            onClick={() => setShowMembers((v) => !v)}
            className="flex items-center gap-1 rounded-md border px-2 py-1 text-sm hover:bg-accent"
            title="Members"
          >
            <Users className="h-4 w-4" />
            {members.length}
          </button>
          {canManageLists && (
            <>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setManageOpen(true)}
                className="hidden md:inline-flex"
              >
                <Settings className="h-4 w-4" /> Manage
              </Button>
              <Button
                size="sm"
                onClick={() => setAddingList(true)}
                className="hidden md:inline-flex"
              >
                <Plus className="h-4 w-4" /> New List
              </Button>
            </>
          )}
        </div>
      </div>

      {showMembers && (
        <div className="mb-4 flex flex-wrap gap-2 rounded-md border bg-card p-3">
          {members.map((m) => (
            <span
              key={m.employeeId}
              className="flex items-center gap-1.5 rounded-full bg-muted px-2 py-1 text-xs"
            >
              <Avatar
                name={m.employeeName ?? m.employeeEmail ?? '?'}
                className="h-5 w-5 text-[9px]"
              />
              {m.employeeName ?? m.employeeEmail}
            </span>
          ))}
        </div>
      )}

      <div className="mb-4">
        <FilterBar
          filter={filter}
          onChange={setFilter}
          sprints={sprints}
          members={members}
        />
        {filterActive && (
          <p className="mt-1 text-xs text-muted-foreground">
            Filtered view — drag-and-drop is paused while a filter is applied.
          </p>
        )}
      </div>

      {lists.length === 0 ? (
        <EmptyState
          icon={LayoutGrid}
          title="No lists yet"
          description={
            canManageLists
              ? 'Add your first list (e.g. “To Do”) to start placing cards.'
              : 'This board has no lists yet.'
          }
        />
      ) : isMobile ? (
        <div>
          <div
            ref={mobileBoardRef}
            className="-mx-4 flex snap-x snap-mandatory gap-3 overflow-x-auto px-4 pb-4 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
            onScroll={(event) => {
              const element = event.currentTarget;
              if (!element.clientWidth) return;
              const next = Math.round(element.scrollLeft / element.clientWidth);
              setMobileListIndex(Math.max(0, Math.min(lists.length - 1, next)));
            }}
          >
            {lists.map((list) => (
              <div
                key={list.id}
                className="w-[calc(100vw-2rem)] shrink-0 snap-center [&>div]:w-full"
              >
                <ListColumn
                  list={list}
                  cards={cardsByList[list.id] ?? []}
                  canManage={false}
                  dndDisabled
                  sprintNames={sprintNames}
                  onOpenCard={setOpenCard}
                  onAddCard={addCard}
                />
              </div>
            ))}
          </div>
          <div
            className="flex items-center justify-center gap-2"
            aria-live="polite"
          >
            <span className="mr-1 text-xs font-medium text-muted-foreground">
              {lists[mobileListIndex]?.name} · {mobileListIndex + 1}/
              {lists.length}
            </span>
            {lists.map((list, index) => (
              <button
                key={list.id}
                type="button"
                aria-label={`Show ${list.name}`}
                aria-current={index === mobileListIndex ? 'true' : undefined}
                onClick={() => {
                  mobileBoardRef.current?.children[index]?.scrollIntoView({
                    behavior: 'smooth',
                    block: 'nearest',
                    inline: 'center',
                  });
                  setMobileListIndex(index);
                }}
                className={cn(
                  'size-2.5 rounded-full transition-colors',
                  index === mobileListIndex
                    ? 'bg-primary'
                    : 'bg-muted-foreground/30',
                )}
              />
            ))}
          </div>
          <p className="mt-2 text-center text-xs text-muted-foreground">
            Swipe between lists. Tap a card to view or move it.
          </p>
        </div>
      ) : (
        <DndContext
          sensors={sensors}
          collisionDetection={closestCorners}
          onDragStart={onDragStart}
          onDragOver={onDragOver}
          onDragEnd={onDragEnd}
        >
          <div className="flex items-start gap-4 overflow-x-auto pb-4">
            <SortableContext
              items={lists.map((l) => l.id)}
              strategy={horizontalListSortingStrategy}
            >
              {lists.map((l) => (
                <ListColumn
                  key={l.id}
                  list={l}
                  cards={cardsByList[l.id] ?? []}
                  canManage={canManageLists}
                  dndDisabled={filterActive}
                  sprintNames={sprintNames}
                  onOpenCard={setOpenCard}
                  onAddCard={addCard}
                />
              ))}
            </SortableContext>
          </div>
          <DragOverlay>
            {activeCard ? (
              <CardTile card={activeCard} onOpen={() => {}} />
            ) : null}
          </DragOverlay>
        </DndContext>
      )}

      {openCard && (
        <CardModal
          cardId={openCard.id}
          board={board}
          sprints={sprints}
          boardLabels={labels}
          lists={lists}
          appendPositionForList={appendPositionForList}
          onCardMoved={(moved) => reconcileModalMove(moved)}
          canManage={canManageBoard}
          onClose={() => {
            setOpenCard(null);
            // If we arrived via a deep-link URL, restore the plain board URL.
            if (initialOpenCardId) router.replace(`/kanban/boards/${boardId}`);
          }}
          onChanged={() => void loadCards(lists, filter)}
        />
      )}

      {manageOpen && (
        <ManageBoardDialog
          board={board}
          members={members}
          labels={labels}
          sprints={sprints}
          lists={lists}
          canManageBoard={canManageBoard}
          onClose={() => setManageOpen(false)}
          onMembersChanged={(next) => setMembers(next)}
          onLabelsChanged={(next) => setLabels(next)}
          onSprintsChanged={(next) => setSprints(next)}
          onListsChanged={(next) => {
            const ordered = [...next].sort((a, b) => a.position - b.position);
            setLists(ordered);
            setCardsByList((previous) =>
              Object.fromEntries(
                ordered.map((list) => [list.id, previous[list.id] ?? []]),
              ),
            );
          }}
        />
      )}

      {addingList && (
        <CreateListDialog
          boardId={boardId}
          nextPosition={
            lists.length ? lists[lists.length - 1].position + 1024 : 1024
          }
          onClose={() => setAddingList(false)}
          onCreated={(list) => {
            setLists((prev) =>
              [
                ...prev.map((item) =>
                  list.isDoneList ? { ...item, isDoneList: false } : item,
                ),
                list,
              ].sort((a, b) => a.position - b.position),
            );
            setCardsByList((prev) => ({ ...prev, [list.id]: [] }));
            setAddingList(false);
          }}
        />
      )}
    </PageContainer>
  );
}
