'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { CheckCircle2, Tag, Trash2, X } from 'lucide-react';
import {
  addComment,
  archiveCard,
  attachLabel,
  deleteComment,
  detachLabel,
  getCard,
  getFeed,
  moveCard,
  setCardSprint,
  updateCard,
  type KanbanBoard,
  type KanbanCard,
  type KanbanFeedItem,
  type KanbanLabel,
  type KanbanList,
  type KanbanSprint,
} from '../../../lib/kanban';
import type { LeadPriority } from '../../../lib/types';
import { ApiError } from '../../../lib/api';
import { useAuth } from '../../../lib/auth-context';
import { useToast } from '../../../components/ui/toaster';
import { useConfirm } from '../../../components/ui/confirm';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '../../../components/ui/dialog';
import { Input } from '../../../components/ui/input';
import { Textarea } from '../../../components/ui/textarea';
import { Select } from '../../../components/ui/select';
import { Button } from '../../../components/ui/button';
import { Avatar } from '../../../components/ui/avatar';
import { Badge } from '../../../components/ui/badge';
import { Spinner } from '../../../components/ui/spinner';
import { CardAttachments } from './card-attachments';
import { EmployeePicker } from '../../vault/_components/employee-picker';
import { cn } from '../../../lib/utils';

function toDateInput(iso: string | null): string {
  return iso ? iso.slice(0, 10) : '';
}

function relative(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/**
 * Card detail modal (spec §4). Loads the full card + feed by id (so it works
 * both from a click and a deep-link). Only ever mounted from BoardView, which
 * itself 403s non-members — so every viewer here already has full board
 * access. (A non-member card-only assignee gets a separate, standalone card
 * view instead — see kanban/cards/[id]/page.tsx.) Any member edits title/
 * description/dates/priority/assignee/labels and comments; the sprint field
 * is read-only for members and an editable dropdown for canManage; delete is
 * shown to the creator or a managing user.
 */
export function CardModal({
  cardId,
  board,
  sprints,
  boardLabels,
  lists,
  appendPositionForList,
  onCardMoved,
  canManage,
  onClose,
  onChanged,
}: {
  cardId: string;
  board: KanbanBoard;
  sprints: KanbanSprint[];
  boardLabels: KanbanLabel[];
  lists: KanbanList[];
  appendPositionForList: (listId: string) => number;
  onCardMoved: (card: KanbanCard, previousListId: string) => void;
  canManage: boolean;
  onClose: () => void;
  onChanged: () => void;
}) {
  const { user } = useAuth();
  const toast = useToast();
  const confirm = useConfirm();

  const [card, setCard] = useState<KanbanCard | null>(null);
  const [feed, setFeed] = useState<KanbanFeedItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);

  // Local editable buffers for the text fields (committed on blur).
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [comment, setComment] = useState('');
  const [posting, setPosting] = useState(false);
  const [labelMenuOpen, setLabelMenuOpen] = useState(false);
  const [moving, setMoving] = useState(false);
  const labelMenuRef = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [c, f] = await Promise.all([getCard(cardId), getFeed(cardId)]);
      setCard(c);
      setTitle(c.title);
      setDescription(c.description ?? '');
      setFeed(f);
    } catch (err) {
      if (err instanceof ApiError && err.statusCode === 404) setNotFound(true);
      else toast.error('Failed to load card.');
    } finally {
      setLoading(false);
    }
  }, [cardId, toast]);

  useEffect(() => {
    void load();
  }, [load]);

  // Close the label menu on outside click.
  useEffect(() => {
    if (!labelMenuOpen) return;
    function onDown(e: MouseEvent) {
      if (
        labelMenuRef.current &&
        !labelMenuRef.current.contains(e.target as Node)
      ) {
        setLabelMenuOpen(false);
      }
    }
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [labelMenuOpen]);

  const canDelete = !!card && (canManage || card.createdById === user?.sub);

  async function patch(
    input: Parameters<typeof updateCard>[1],
    successMsg?: string,
  ) {
    if (!card) return;
    try {
      const updated = await updateCard(card.id, input);
      setCard(updated);
      if (successMsg) toast.success(successMsg);
      onChanged();
      void refreshFeed();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Update failed.');
      void load();
    }
  }

  async function refreshFeed() {
    try {
      setFeed(await getFeed(cardId));
    } catch {
      /* non-critical */
    }
  }

  async function onToggleLabel(label: KanbanLabel) {
    if (!card) return;
    const attached = card.labels?.some((l) => l.id === label.id);
    try {
      const updated = attached
        ? await detachLabel(card.id, label.id)
        : await attachLabel(card.id, label.id);
      setCard(updated);
      onChanged();
    } catch (err) {
      toast.error(
        err instanceof ApiError ? err.message : 'Failed to update labels.',
      );
    }
  }

  async function onSetSprint(sprintId: string) {
    if (!card) return;
    try {
      const updated = await setCardSprint(card.id, sprintId || null);
      setCard(updated);
      onChanged();
      void refreshFeed();
    } catch (err) {
      toast.error(
        err instanceof ApiError ? err.message : 'Failed to set sprint.',
      );
    }
  }

  async function onMoveToList(listId: string) {
    if (!card || listId === card.listId || moving) return;
    const previous = card;
    const optimistic = {
      ...card,
      listId,
      position: appendPositionForList(listId),
    };
    setCard(optimistic);
    onCardMoved(optimistic, previous.listId);
    setMoving(true);
    try {
      const updated = await moveCard(card.id, listId, optimistic.position);
      setCard(updated);
      onCardMoved(updated, previous.listId);
      window.sessionStorage.setItem('kanban-dashboard-dirty', '1');
      window.dispatchEvent(
        new CustomEvent('kanban:card-moved', { detail: updated }),
      );
      toast.success('Card moved.');
      void refreshFeed();
    } catch (err) {
      setCard(previous);
      onCardMoved(previous, listId);
      toast.error(
        err instanceof ApiError ? err.message : 'Failed to move card.',
      );
    } finally {
      setMoving(false);
    }
  }

  async function postComment() {
    const text = comment.trim();
    if (!text) return;
    setPosting(true);
    try {
      await addComment(cardId, text);
      setComment('');
      await refreshFeed();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Failed to comment.');
    } finally {
      setPosting(false);
    }
  }

  async function onDeleteComment(commentId: string) {
    if (
      !(await confirm({
        title: 'Delete comment?',
        description: 'This cannot be undone.',
        confirmLabel: 'Delete',
        destructive: true,
      }))
    )
      return;
    try {
      await deleteComment(cardId, commentId);
      await refreshFeed();
    } catch (err) {
      toast.error(
        err instanceof ApiError ? err.message : 'Failed to delete comment.',
      );
    }
  }

  async function onDelete() {
    if (!card) return;
    if (
      !(await confirm({
        title: 'Delete card?',
        description: `“${card.title}” will be removed from the board.`,
        confirmLabel: 'Delete',
        destructive: true,
      }))
    )
      return;
    try {
      await archiveCard(card.id);
      toast.success('Card deleted.');
      onChanged();
      onClose();
    } catch (err) {
      toast.error(
        err instanceof ApiError ? err.message : 'Failed to delete card.',
      );
    }
  }

  const sprintName = card?.sprintId
    ? (sprints.find((s) => s.id === card.sprintId)?.name ?? '—')
    : 'No sprint';

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="left-0 top-0 h-dvh max-h-dvh w-screen max-w-none translate-x-0 translate-y-0 rounded-none p-4 sm:left-1/2 sm:top-1/2 sm:h-auto sm:max-h-[90vh] sm:w-full sm:max-w-2xl sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-lg sm:p-6">
        {loading ? (
          <div className="flex h-40 items-center justify-center">
            <Spinner className="text-muted-foreground" />
          </div>
        ) : notFound || !card ? (
          <>
            <DialogHeader>
              <DialogTitle>Card not found</DialogTitle>
            </DialogHeader>
            <p className="text-sm text-muted-foreground">
              This card may have been deleted, or you don’t have access to it.
            </p>
          </>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle className="pr-8">
                <Input
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  onBlur={() => {
                    if (title.trim() && title !== card.title)
                      void patch({ title: title.trim() });
                    else setTitle(card.title);
                  }}
                  className="border-none px-0 text-lg font-semibold shadow-none focus-visible:ring-0"
                />
              </DialogTitle>
              <p className="text-xs text-muted-foreground">in {board.name}</p>
            </DialogHeader>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-[1fr_200px]">
              {/* Main column */}
              <div className="order-2 space-y-4 sm:order-1">
                {/* Labels */}
                <div className="flex flex-wrap items-center gap-1.5">
                  {card.labels?.map((l) => (
                    <span
                      key={l.id}
                      className="rounded px-2 py-0.5 text-xs font-medium text-white"
                      style={{ backgroundColor: l.color }}
                    >
                      {l.name}
                    </span>
                  ))}
                  <div className="relative" ref={labelMenuRef}>
                    <button
                      type="button"
                      onClick={() => setLabelMenuOpen((v) => !v)}
                      className="flex items-center gap-1 rounded border px-2 py-0.5 text-xs text-muted-foreground hover:bg-accent"
                    >
                      <Tag className="h-3 w-3" /> Labels
                    </button>
                    {labelMenuOpen && (
                      <div className="absolute z-50 mt-1 w-52 rounded-md border bg-popover p-1 shadow-md">
                        {boardLabels.length === 0 ? (
                          <p className="px-2 py-1.5 text-xs text-muted-foreground">
                            No labels defined. A Scrum Master can add them in
                            board management.
                          </p>
                        ) : (
                          boardLabels.map((l) => {
                            const on = card.labels?.some((x) => x.id === l.id);
                            return (
                              <button
                                key={l.id}
                                type="button"
                                onClick={() => onToggleLabel(l)}
                                className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm hover:bg-accent"
                              >
                                <span
                                  className="h-3 w-6 rounded"
                                  style={{ backgroundColor: l.color }}
                                />
                                <span className="flex-1 truncate">
                                  {l.name}
                                </span>
                                {on && (
                                  <span className="text-xs text-primary">
                                    ✓
                                  </span>
                                )}
                              </button>
                            );
                          })
                        )}
                      </div>
                    )}
                  </div>
                </div>

                {/* Description */}
                <div>
                  <p className="mb-1 text-xs font-medium text-muted-foreground">
                    Description
                  </p>
                  <Textarea
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    onBlur={() => {
                      if (description !== (card.description ?? ''))
                        void patch({ description: description || null });
                    }}
                    placeholder="Add a more detailed description…"
                    rows={4}
                  />
                </div>

                {/* Attachments */}
                <CardAttachments
                  cardId={cardId}
                  canDeleteAny
                  currentUserId={user?.sub}
                  onChanged={refreshFeed}
                />

                {/* Feed */}
                <div>
                  <p className="mb-2 text-xs font-medium text-muted-foreground">
                    Comments and activity
                  </p>
                  <div className="flex gap-2">
                    <Textarea
                      value={comment}
                      onChange={(e) => setComment(e.target.value)}
                      placeholder="Write a comment…"
                      rows={2}
                    />
                  </div>
                  <div className="mt-2 flex justify-end">
                    <Button
                      size="sm"
                      onClick={postComment}
                      disabled={posting || !comment.trim()}
                    >
                      {posting ? 'Posting…' : 'Comment'}
                    </Button>
                  </div>

                  <ul className="mt-3 space-y-3">
                    {feed.map((item) => (
                      <li
                        key={`${item.kind}-${item.id}`}
                        className="flex gap-2"
                      >
                        <Avatar
                          name={item.actorName ?? '?'}
                          className="h-6 w-6 shrink-0 text-[10px]"
                        />
                        {item.kind === 'ACTIVITY' ? (
                          <p className="text-xs text-muted-foreground">
                            <span className="font-medium text-foreground">
                              {item.actorName ?? 'Someone'}
                            </span>{' '}
                            {item.text}
                            <span className="ml-1">
                              · {relative(item.createdAt)}
                            </span>
                          </p>
                        ) : (
                          <div className="min-w-0 flex-1 rounded-md bg-muted px-3 py-2">
                            <p className="flex items-center gap-2 text-xs text-muted-foreground">
                              <span className="font-medium text-foreground">
                                {item.actorName ?? 'Someone'}
                              </span>
                              {relative(item.createdAt)}
                              {(canManage || item.actorId === user?.sub) && (
                                <button
                                  type="button"
                                  onClick={() => onDeleteComment(item.id)}
                                  className="ml-auto text-muted-foreground hover:text-destructive"
                                  aria-label="Delete comment"
                                >
                                  <Trash2 className="h-3 w-3" />
                                </button>
                              )}
                            </p>
                            <p className="mt-0.5 whitespace-pre-wrap text-sm">
                              {item.text}
                            </p>
                          </div>
                        )}
                      </li>
                    ))}
                    {feed.length === 0 && (
                      <li className="text-xs text-muted-foreground">
                        No activity yet.
                      </li>
                    )}
                  </ul>
                </div>
              </div>

              {/* Sidebar: metadata */}
              <div className="order-1 space-y-3 sm:order-2">
                <SideField label="Move to…">
                  <Select
                    value={card.listId}
                    onChange={(e) => void onMoveToList(e.target.value)}
                    disabled={moving}
                    className="h-11 sm:h-8"
                  >
                    {lists.map((list) => (
                      <option key={list.id} value={list.id}>
                        {list.name}
                      </option>
                    ))}
                  </Select>
                </SideField>

                {lists.find((list) => list.isDoneList)?.id !== card.listId &&
                  lists.some((list) => list.isDoneList) && (
                    <Button
                      size="sm"
                      className="h-11 w-full sm:h-8"
                      disabled={moving}
                      onClick={() => {
                        const done = lists.find((list) => list.isDoneList);
                        if (done) void onMoveToList(done.id);
                      }}
                    >
                      <CheckCircle2 className="h-4 w-4" />
                      {moving ? 'Moving…' : 'Mark complete'}
                    </Button>
                  )}

                <SideField label="Assignee">
                  {card.assigneeId && card.assigneeName ? (
                    <div className="flex items-center gap-2 rounded-md border px-2 py-1 text-sm">
                      <Avatar
                        name={card.assigneeName}
                        className="h-6 w-6 text-[10px]"
                      />
                      <span className="min-w-0 flex-1 truncate">
                        {card.assigneeName}
                      </span>
                      <button
                        type="button"
                        aria-label="Unassign"
                        onClick={() => void patch({ assigneeId: null })}
                        className="rounded-sm p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
                      >
                        <X className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  ) : (
                    <p className="mb-1.5 text-sm text-muted-foreground">
                      Unassigned
                    </p>
                  )}
                  <div className="mt-1.5">
                    <EmployeePicker
                      onSelect={(e) => void patch({ assigneeId: e.id })}
                      excludeIds={card.assigneeId ? [card.assigneeId] : []}
                    />
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Any employee — assigning someone who isn’t a board member
                    gives them access to just this card.
                  </p>
                </SideField>

                <SideField label="Vertical">
                  <div className="flex h-11 items-center rounded-md border bg-muted/50 px-3 text-sm text-muted-foreground sm:h-8">
                    {card.verticalName ?? 'Not assigned'}
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Set automatically from the assignee.
                  </p>
                </SideField>

                <SideField label="Priority">
                  <Select
                    value={card.priority}
                    onChange={(e) =>
                      void patch({ priority: e.target.value as LeadPriority })
                    }
                    className="h-11 sm:h-8"
                  >
                    <option value="HIGH">High</option>
                    <option value="MEDIUM">Medium</option>
                    <option value="LOW">Low</option>
                  </Select>
                </SideField>

                <SideField label="Start date">
                  <Input
                    type="date"
                    value={toDateInput(card.startDate)}
                    onChange={(e) =>
                      void patch({ startDate: e.target.value || null })
                    }
                    className="h-11 sm:h-8"
                  />
                </SideField>

                <SideField label="Due date">
                  <Input
                    type="date"
                    value={toDateInput(card.dueDate)}
                    onChange={(e) =>
                      void patch({ dueDate: e.target.value || null })
                    }
                    className={cn(
                      'h-11 sm:h-8',
                      card.isOverdue && 'border-destructive',
                    )}
                  />
                  {card.isOverdue && (
                    <Badge variant="destructive" className="mt-1">
                      Overdue
                    </Badge>
                  )}
                </SideField>

                <SideField label="Sprint">
                  {canManage ? (
                    <Select
                      value={card.sprintId ?? ''}
                      onChange={(e) => void onSetSprint(e.target.value)}
                      className="h-11 sm:h-8"
                    >
                      <option value="">No sprint</option>
                      {sprints.map((s) => (
                        <option key={s.id} value={s.id}>
                          {s.name}
                        </option>
                      ))}
                    </Select>
                  ) : (
                    <p className="text-sm">{sprintName}</p>
                  )}
                </SideField>

                {canDelete && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={onDelete}
                    className="w-full text-destructive hover:bg-destructive/10"
                  >
                    <Trash2 className="h-4 w-4" /> Delete card
                  </Button>
                )}
              </div>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

function SideField({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <p className="mb-1 text-xs font-medium text-muted-foreground">{label}</p>
      {children}
    </div>
  );
}
