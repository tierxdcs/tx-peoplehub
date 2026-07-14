'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { getCard } from '../../../../lib/kanban';
import { ApiError } from '../../../../lib/api';
import { PageContainer } from '../../../../components/ui/page-container';
import { EmptyState } from '../../../../components/ui/empty-state';
import { Button } from '../../../../components/ui/button';
import { Spinner } from '../../../../components/ui/spinner';
import { FileQuestion } from 'lucide-react';

/**
 * Deep-link resolver (spec §4): a notification links here as
 * /kanban/cards/:id. We fetch the card (which now carries boardId), then
 * redirect to its board with ?openCard=:id so the board view opens the modal
 * in context. This is the concrete fix for the previously-dead bell link.
 */
export default function CardDeepLinkPage() {
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const cardId = params.id;
  const [error, setError] = useState<'notfound' | 'error' | null>(null);

  useEffect(() => {
    let cancelled = false;
    getCard(cardId)
      .then((card) => {
        if (cancelled) return;
        if (card.boardId) {
          router.replace(`/kanban/boards/${card.boardId}?openCard=${card.id}`);
        } else {
          setError('error');
        }
      })
      .catch((err) => {
        if (cancelled) return;
        setError(err instanceof ApiError && err.statusCode === 404 ? 'notfound' : 'error');
      });
    return () => {
      cancelled = true;
    };
  }, [cardId, router]);

  if (!error) {
    return (
      <PageContainer>
        <div className="flex h-64 items-center justify-center">
          <Spinner className="text-muted-foreground" />
        </div>
      </PageContainer>
    );
  }

  return (
    <PageContainer>
      <EmptyState
        icon={FileQuestion}
        title={error === 'notfound' ? 'Card not found' : 'Couldn’t open this card'}
        description={
          error === 'notfound'
            ? 'This card may have been deleted, or you don’t have access to its board.'
            : 'Something went wrong resolving this card.'
        }
      />
      <div className="mt-4 flex justify-center">
        <Button variant="outline" onClick={() => router.push('/kanban')}>
          Back to boards
        </Button>
      </div>
    </PageContainer>
  );
}
