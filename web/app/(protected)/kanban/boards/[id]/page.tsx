'use client';

import { useParams, useSearchParams } from 'next/navigation';
import { BoardView } from '../../_components/board-view';

/**
 * Board route. An `openCard` query param (set by the deep-link resolver) tells
 * the board to auto-open a card modal once loaded.
 */
export default function BoardPage() {
  const params = useParams<{ id: string }>();
  const search = useSearchParams();
  const openCard = search.get('openCard') ?? undefined;
  const sprint = search.get('sprint') ?? undefined;
  return (
    <BoardView
      boardId={params.id}
      initialOpenCardId={openCard}
      initialSprintId={sprint}
    />
  );
}
