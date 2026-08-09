import { PageContainer } from '../../components/ui/page-container';
import { PageHeader } from '../../components/ui/page-header';
import { HelpProcessExplorer } from './process-explorer';

export default function HelpPage() {
  return (
    <PageContainer>
      <PageHeader
        title="Help & SOP"
        description="Explore how work moves across PhazeOne, who participates and where approvals happen."
      />
      <HelpProcessExplorer />
    </PageContainer>
  );
}
