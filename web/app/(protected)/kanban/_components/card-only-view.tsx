'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  addComment,
  getFeed,
  type KanbanCard,
  type KanbanFeedItem,
} from '../../../lib/kanban';
import { ApiError } from '../../../lib/api';
import { useAuth } from '../../../lib/auth-context';
import { useToast } from '../../../components/ui/toaster';
import { Textarea } from '../../../components/ui/textarea';
import { Button } from '../../../components/ui/button';
import { Avatar } from '../../../components/ui/avatar';
import { Badge } from '../../../components/ui/badge';
import { Spinner } from '../../../components/ui/spinner';
import { CardAttachments } from './card-attachments';

function toDateDisplay(iso: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
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
 * Read-mostly view of a single card for a non-board-member who is that
 * card's assignee (card-only access — see KanbanAccessService.assertCanViewCard
 * and KanbanCardEntity.viewerHasBoardAccess). No board chrome, no other
 * cards, no membership info: title/description/fields/labels/dates/priority/
 * sprint are read-only, and the feed supports comments and file attachments
 * — no move, no edit, no "Mark complete", no delete.
 */
export function CardOnlyView({ card }: { card: KanbanCard }) {
  const { user } = useAuth();
  const toast = useToast();
  const [feed, setFeed] = useState<KanbanFeedItem[]>([]);
  const [feedLoading, setFeedLoading] = useState(true);
  const [comment, setComment] = useState('');
  const [posting, setPosting] = useState(false);

  const refreshFeed = useCallback(async () => {
    try {
      setFeed(await getFeed(card.id));
    } catch {
      /* non-critical */
    } finally {
      setFeedLoading(false);
    }
  }, [card.id]);

  useEffect(() => {
    void refreshFeed();
  }, [refreshFeed]);

  async function postComment() {
    const text = comment.trim();
    if (!text) return;
    setPosting(true);
    try {
      await addComment(card.id, text);
      setComment('');
      await refreshFeed();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Failed to comment.');
    } finally {
      setPosting(false);
    }
  }

  return (
    <div className="mx-auto w-full max-w-2xl">
      <div className="rounded-lg border bg-card p-6">
        <p className="mb-1 text-xs text-muted-foreground">
          Shared with you as the assignee of this card — you’re not a member of
          its board.
        </p>
        <h1 className="text-lg font-semibold">{card.title}</h1>

        {card.labels && card.labels.length > 0 && (
          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            {card.labels.map((l) => (
              <span
                key={l.id}
                className="rounded px-2 py-0.5 text-xs font-medium text-white"
                style={{ backgroundColor: l.color }}
              >
                {l.name}
              </span>
            ))}
          </div>
        )}

        {card.description && (
          <div className="mt-4">
            <p className="mb-1 text-xs font-medium text-muted-foreground">
              Description
            </p>
            <p className="whitespace-pre-wrap text-sm">{card.description}</p>
          </div>
        )}

        <div className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-3">
          <Field label="Priority">
            <span className="text-sm capitalize">
              {card.priority.toLowerCase()}
            </span>
          </Field>
          <Field label="Start date">
            <span className="text-sm">{toDateDisplay(card.startDate)}</span>
          </Field>
          <Field label="Due date">
            <span className="flex items-center gap-2 text-sm">
              {toDateDisplay(card.dueDate)}
              {card.isOverdue && <Badge variant="destructive">Overdue</Badge>}
            </span>
          </Field>
          <Field label="Sprint">
            <span className="text-sm">{card.sprintName ?? 'No sprint'}</span>
          </Field>
        </div>

        <div className="mt-6">
          <CardAttachments
            cardId={card.id}
            canDeleteAny={false}
            currentUserId={user?.sub}
            onChanged={refreshFeed}
          />
        </div>

        <div className="mt-6">
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

          {feedLoading ? (
            <div className="mt-3 flex justify-center">
              <Spinner className="text-muted-foreground" />
            </div>
          ) : (
            <ul className="mt-3 space-y-3">
              {feed.map((item) => (
                <li key={`${item.kind}-${item.id}`} className="flex gap-2">
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
                      <span className="ml-1">· {relative(item.createdAt)}</span>
                    </p>
                  ) : (
                    <div className="min-w-0 flex-1 rounded-md bg-muted px-3 py-2">
                      <p className="flex items-center gap-2 text-xs text-muted-foreground">
                        <span className="font-medium text-foreground">
                          {item.actorName ?? 'Someone'}
                        </span>
                        {relative(item.createdAt)}
                        {item.actorId === user?.sub && (
                          <span className="ml-auto italic">you</span>
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
          )}
        </div>
      </div>
    </div>
  );
}

function Field({
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
