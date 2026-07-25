'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { ArrowLeft } from 'lucide-react';
import { PageContainer } from '../../../../components/ui/page-container';
import { PageHeader } from '../../../../components/ui/page-header';
import { Button } from '../../../../components/ui/button';
import { PlmSection } from '../../../sales/orders/[id]/_components/plm-section';

export default function PlmTrackerPage() {
  const { id } = useParams<{ id: string }>();

  return (
    <PageContainer>
      <PageHeader
        title="Product Lifecycle Tracker"
        description="Project progress from kickoff through design, procurement, production, quality and dispatch."
        action={
          <Link href="/plm">
            <Button variant="outline">
              <ArrowLeft className="size-4" />
              Product Lifecycle
            </Button>
          </Link>
        }
      />
      <PlmSection trackerId={id} />
    </PageContainer>
  );
}
