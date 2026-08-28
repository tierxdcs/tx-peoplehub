import Link from 'next/link';
import { Users } from 'lucide-react';
import { Avatar } from '../ui/avatar';
import { cn } from '../../lib/utils';
import { OrgChartNode } from '../../lib/org-chart';

/**
 * One person's box in an org chart — the single node rendering, shared by the
 * profile mini chart and the full-company page so a node looks and behaves the
 * same in both. Always a link to that person's profile; the photo comes from
 * the signed URL the API returns and falls back to the app's initials Avatar
 * when they have none.
 */
export function OrgNodeCard({
  node,
  href,
  highlighted = false,
  compact = false,
  className,
}: {
  node: OrgChartNode;
  href: string;
  /** The profile owner / focused person — visually distinct from the rest. */
  highlighted?: boolean;
  compact?: boolean;
  className?: string;
}) {
  const secondary = node.designation ?? node.verticalName ?? node.employeeId;
  return (
    <Link
      href={href}
      aria-current={highlighted ? 'page' : undefined}
      className={cn(
        'flex items-center gap-2.5 rounded-lg border bg-card px-2.5 py-2 transition-colors hover:border-primary/50 hover:bg-muted/50',
        compact ? 'w-[178px]' : 'w-[200px]',
        highlighted && 'border-primary bg-primary/5 ring-1 ring-primary/25',
        className,
      )}
    >
      <Avatar
        name={node.fullName}
        imageUrl={node.photoUrl}
        className={compact ? 'size-8' : 'size-9'}
      />
      <div className="min-w-0 flex-1">
        <div
          className={cn(
            'truncate font-semibold',
            compact ? 'text-[12.5px]' : 'text-[13px]',
            highlighted && 'text-primary',
          )}
        >
          {node.fullName}
        </div>
        <div className="truncate text-[11px] text-muted-foreground">
          {secondary}
        </div>
      </div>
      {node.directReportCount > 0 && (
        <span
          title={`${node.directReportCount} direct report${node.directReportCount === 1 ? '' : 's'}`}
          className="flex shrink-0 items-center gap-0.5 text-[10.5px] font-medium text-muted-foreground"
        >
          <Users className="size-3" />
          {node.directReportCount}
        </span>
      )}
    </Link>
  );
}
