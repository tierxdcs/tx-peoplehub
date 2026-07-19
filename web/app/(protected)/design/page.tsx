'use client';
import { useEffect, useState } from 'react';
import { apiFetch } from '../../lib/api';
import { Card, CardContent } from '../../components/ui/card';
import { PageContainer } from '../../components/ui/page-container';
import { PageHeader } from '../../components/ui/page-header';
type D = {
  openRequests: number;
  activeProjects: number;
  overdueProjects: number;
  pendingRevisions: number;
  releasedDocuments: number;
  openChanges: number;
};
export default function DesignDashboard() {
  const [d, setD] = useState<D>();
  useEffect(() => {
    apiFetch<D>('/design/dashboard').then(setD);
  }, []);
  return (
    <PageContainer>
      <PageHeader
        title="Design Engineering"
        description="Controlled design requests, projects, drawings and production releases"
      />
      <div className="grid gap-4 md:grid-cols-3 xl:grid-cols-6">
        {d &&
          Object.entries({
            'Open requests': d.openRequests,
            'Active projects': d.activeProjects,
            'Overdue projects': d.overdueProjects,
            'Pending releases': d.pendingRevisions,
            'Released documents': d.releasedDocuments,
            'Open engineering changes': d.openChanges,
          }).map(([k, v]) => (
            <Card key={k}>
              <CardContent className="p-5">
                <div className="text-sm text-muted-foreground">{k}</div>
                <div className="text-2xl font-semibold">{v}</div>
              </CardContent>
            </Card>
          ))}
      </div>
    </PageContainer>
  );
}
