'use client';

import { useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { PageContainer } from '../../components/ui/page-container';
import { Skeleton } from '../../components/ui/skeleton';

/**
 * The org chart now lives as a tab under My Profile, so this standalone route
 * only forwards there (carrying ?focus= through) — keeping older links and
 * bookmarks working instead of 404ing.
 */
export default function OrgChartRedirectPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const focusId = searchParams.get('focus');

  useEffect(() => {
    router.replace(
      focusId
        ? `/profile?tab=org-chart&focus=${encodeURIComponent(focusId)}`
        : '/profile?tab=org-chart',
    );
  }, [router, focusId]);

  return (
    <PageContainer>
      <Skeleton className="mb-4 h-9 w-48" />
      <Skeleton className="h-40 w-full max-w-2xl" />
    </PageContainer>
  );
}
