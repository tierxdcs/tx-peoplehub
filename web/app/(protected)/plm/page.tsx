'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import {
  AlertTriangle,
  BellRing,
  CheckCircle2,
  Factory,
  RefreshCw,
  Workflow,
} from 'lucide-react';
import { ApiError } from '../../lib/api';
import { getMyPlmWork, PlmDashboardItem, plmTrackerHref } from '../../lib/plm';
import {
  DELIVERY_URGENCY_TEXT_CLASS,
  deliveryCountdownLabel,
  deliveryUrgencyTier,
} from '../../lib/delivery-urgency';
import { prettyEnum } from '../../lib/sales';
import { PageContainer } from '../../components/ui/page-container';
import { PageHeader } from '../../components/ui/page-header';
import { Card, CardContent } from '../../components/ui/card';
import { Button } from '../../components/ui/button';
import { EmptyState } from '../../components/ui/empty-state';
import { Skeleton } from '../../components/ui/skeleton';
import { StatusBadge } from '../../components/ui/status-badge';
import { cn } from '../../lib/utils';
import { RegisterToolbar } from '../../components/ui/register-toolbar';
import { Select } from '../../components/ui/select';
import {
  dominantBlockers,
  filterAndSortPlmItems,
  groupPlmItemsByOrder,
  type PlmWorkspaceFilters,
} from '../../lib/plm-workspace';

export default function PlmWorkspacePage() {
  const [items, setItems] = useState<PlmDashboardItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filters, setFilters] = useState<PlmWorkspaceFilters>({
    search: '',
    customer: 'ALL',
    owner: 'ALL',
    stage: 'ALL',
    health: 'ALL',
    flowType: 'ALL',
    sort: 'URGENCY',
  });
  const [groupByOrder, setGroupByOrder] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setItems(await getMyPlmWork());
    } catch (err) {
      setError(
        err instanceof ApiError
          ? err.message
          : 'Unable to load Product Lifecycle data',
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const summary = useMemo(
    () => ({
      active: items.length,
      production: items.filter((item) => item.currentStage === 'PRODUCTION')
        .length,
      atRisk: items.filter((item) => item.health === 'AT_RISK').length,
      blocked: items.filter((item) => item.health === 'BLOCKED').length,
    }),
    [items],
  );
  const customers = useMemo(
    () =>
      unique(
        items
          .map((item) => item.customerName)
          .filter((value): value is string => Boolean(value)),
      ),
    [items],
  );
  const owners = useMemo(
    () => unique(items.map((item) => item.ownerName)),
    [items],
  );
  const stages = useMemo(
    () => unique(items.map((item) => item.currentStage)),
    [items],
  );
  const visibleItems = useMemo(
    () => filterAndSortPlmItems(items, filters),
    [filters, items],
  );
  const blockerSummary = useMemo(
    () => dominantBlockers(visibleItems),
    [visibleItems],
  );
  const orderGroups = useMemo(
    () => groupPlmItemsByOrder(visibleItems),
    [visibleItems],
  );

  function setFilter<K extends keyof PlmWorkspaceFilters>(
    key: K,
    value: PlmWorkspaceFilters[K],
  ) {
    setFilters((current) => ({ ...current, [key]: value }));
  }

  return (
    <PageContainer>
      <PageHeader
        title="Product Lifecycle"
        description="Order-line progress from completed Project Kickoff through design, production, quality and dispatch."
        action={
          <Button
            variant="outline"
            onClick={() => void load()}
            disabled={loading}
          >
            <RefreshCw className={cn('size-4', loading && 'animate-spin')} />
            Refresh
          </Button>
        }
      />

      <section className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <SummaryCard
          label="Active lines"
          value={summary.active}
          icon={Workflow}
        />
        <SummaryCard
          label="In production"
          value={summary.production}
          icon={Factory}
        />
        <SummaryCard
          label="At risk"
          value={summary.atRisk}
          icon={AlertTriangle}
          tone="warning"
        />
        <SummaryCard
          label="Blocked"
          value={summary.blocked}
          icon={AlertTriangle}
          tone="danger"
        />
      </section>

      <RegisterToolbar
        title="Lifecycle Register"
        search={filters.search}
        onSearchChange={(value) => setFilter('search', value)}
        searchPlaceholder="Search order, product or SKU"
        filters={
          <>
            <FilterSelect
              label="Customer"
              value={filters.customer}
              onChange={(value) => setFilter('customer', value)}
              options={customers}
            />
            <FilterSelect
              label="Owner / PM"
              value={filters.owner}
              onChange={(value) => setFilter('owner', value)}
              options={owners}
            />
            <FilterSelect
              label="Stage"
              value={filters.stage}
              onChange={(value) =>
                setFilter('stage', value as PlmWorkspaceFilters['stage'])
              }
              options={stages}
              pretty
            />
            <FilterSelect
              label="Status"
              value={filters.health}
              onChange={(value) =>
                setFilter('health', value as PlmWorkspaceFilters['health'])
              }
              options={['BLOCKED', 'AT_RISK', 'ON_TRACK']}
              pretty
            />
            <FilterSelect
              label="Delivery type"
              value={filters.flowType}
              onChange={(value) =>
                setFilter('flowType', value as PlmWorkspaceFilters['flowType'])
              }
              options={['NPD', 'IN_HOUSE', 'VENDOR']}
              pretty
            />
            <Select
              aria-label="Sort lifecycle lines"
              value={filters.sort}
              onChange={(event) =>
                setFilter(
                  'sort',
                  event.target.value as PlmWorkspaceFilters['sort'],
                )
              }
              className="w-full sm:w-44"
            >
              <option value="URGENCY">Due date: urgent first</option>
              <option value="DAYS_IN_STAGE">Days in stage: longest</option>
            </Select>
            <Select
              aria-label="Group lifecycle lines"
              value={groupByOrder ? 'ORDER' : 'LINE'}
              onChange={(event) =>
                setGroupByOrder(event.target.value === 'ORDER')
              }
              className="w-full sm:w-40"
            >
              <option value="ORDER">Group by order</option>
              <option value="LINE">Show all lines</option>
            </Select>
          </>
        }
      />

      {blockerSummary.length > 0 && (
        <div className="mb-4 rounded-md border border-destructive/25 bg-destructive/5 p-3 text-sm">
          <p className="font-medium text-destructive">
            {visibleItems.filter((item) => item.blocker).length} visible line(s)
            blocked
          </p>
          <p className="mt-1 text-muted-foreground">
            {blockerSummary
              .map((entry) => `${entry.count} on: ${entry.reason}`)
              .join(' · ')}
          </p>
        </div>
      )}

      {error && (
        <p className="mb-4 rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
          {error}
        </p>
      )}

      {loading ? (
        <div className="space-y-3">
          {Array.from({ length: 3 }).map((_, index) => (
            <Skeleton key={index} className="h-28 w-full" />
          ))}
        </div>
      ) : items.length === 0 ? (
        <Card>
          <CardContent className="p-0">
            <EmptyState
              icon={Workflow}
              title="No active lifecycle trackers"
              description="A tracker appears automatically for each classified order line after its Project Kickoff is completed. Open Project Kickoff to complete delivery classification and finish the kickoff."
            />
          </CardContent>
        </Card>
      ) : visibleItems.length === 0 ? (
        <Card>
          <CardContent className="p-0">
            <EmptyState
              icon={Workflow}
              title="No lifecycle lines match"
              description="Change the search or filters to see other active tracker lines."
            />
          </CardContent>
        </Card>
      ) : groupByOrder ? (
        <div className="space-y-4">
          {orderGroups.map(({ orderId, lines }) => (
            <OrderGroup key={orderId} lines={lines} />
          ))}
        </div>
      ) : (
        <div className="space-y-3">
          {visibleItems.map((item) => (
            <LifecycleRow key={item.trackerId} item={item} />
          ))}
        </div>
      )}
    </PageContainer>
  );
}

function unique<T extends string>(values: T[]) {
  return [...new Set(values)].sort((a, b) => a.localeCompare(b));
}

function FilterSelect({
  label,
  value,
  onChange,
  options,
  pretty = false,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: string[];
  pretty?: boolean;
}) {
  return (
    <Select
      aria-label={label}
      value={value}
      onChange={(event) => onChange(event.target.value)}
      className="w-full sm:w-40"
    >
      <option value="ALL">All {label.toLocaleLowerCase()}</option>
      {options.map((option) => (
        <option key={option} value={option}>
          {pretty ? prettyEnum(option) : option}
        </option>
      ))}
    </Select>
  );
}

function OrderGroup({ lines }: { lines: PlmDashboardItem[] }) {
  const blocked = lines.filter((line) => line.health === 'BLOCKED').length;
  const atRisk = lines.filter((line) => line.health === 'AT_RISK').length;
  return (
    <section className="overflow-hidden rounded-lg border bg-card">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b bg-muted/25 px-4 py-3">
        <div>
          <p className="font-semibold">
            {lines[0].orderNumber}
            {lines[0].customerName ? ` · ${lines[0].customerName}` : ''}
          </p>
          <p className="text-xs text-muted-foreground">
            {lines.length} lifecycle line{lines.length === 1 ? '' : 's'}
          </p>
        </div>
        <span
          className={cn(
            'rounded-full px-2.5 py-1 text-xs font-medium',
            blocked
              ? 'bg-destructive/10 text-destructive'
              : atRisk
                ? 'bg-warning/15 text-warning-foreground'
                : 'bg-success/10 text-success',
          )}
        >
          {blocked
            ? `${blocked} blocked`
            : atRisk
              ? `${atRisk} at risk`
              : 'On track'}
        </span>
      </div>
      <div className="divide-y">
        {lines.map((line) => (
          <LifecycleRow key={line.trackerId} item={line} embedded />
        ))}
      </div>
    </section>
  );
}

function SummaryCard({
  label,
  value,
  icon: Icon,
  tone = 'default',
}: {
  label: string;
  value: number;
  icon: React.ComponentType<{ className?: string }>;
  tone?: 'default' | 'warning' | 'danger';
}) {
  return (
    <Card>
      <CardContent className="flex items-center gap-3 p-4">
        <span
          className={cn(
            'flex size-10 items-center justify-center rounded-full bg-muted text-muted-foreground',
            tone === 'warning' && 'bg-warning/15 text-warning-foreground',
            tone === 'danger' && 'bg-destructive/10 text-destructive',
          )}
        >
          <Icon className="size-5" />
        </span>
        <div>
          <p className="text-2xl font-semibold">{value}</p>
          <p className="text-xs text-muted-foreground">{label}</p>
        </div>
      </CardContent>
    </Card>
  );
}

function LifecycleRow({
  item,
  embedded = false,
}: {
  item: PlmDashboardItem;
  embedded?: boolean;
}) {
  const health = {
    ON_TRACK: { label: 'On track', className: 'bg-success/10 text-success' },
    AT_RISK: {
      label: 'At risk',
      className: 'bg-warning/15 text-warning-foreground',
    },
    BLOCKED: {
      label: 'Blocked',
      className: 'bg-destructive/10 text-destructive',
    },
  }[item.health];
  const content = (
    <div className="p-4">
      <div className="flex flex-col justify-between gap-4 md:flex-row md:items-center">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <Link
              href={plmTrackerHref(item.trackerId)}
              className="font-semibold text-primary hover:underline"
            >
              {item.orderNumber}
            </Link>
            <span className="font-medium">{item.productName}</span>
            <span className="text-xs text-muted-foreground">
              {item.productSku}
            </span>
            {item.hasPendingPing && (
              <span className="inline-flex items-center gap-1 rounded-full bg-warning/15 px-2 py-0.5 text-xs text-warning-foreground">
                <BellRing className="size-3" />
                Pending ping
              </span>
            )}
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            {prettyEnum(item.flowType)} · Owner: {item.ownerName}
            {item.customerName
              ? ` · Customer: ${item.customerName}`
              : ''} · {item.ageDays} day{item.ageDays === 1 ? '' : 's'} in stage
          </p>
          <DeliveryUrgency item={item} />
          {item.blocker && (
            <p className="mt-2 flex items-center gap-1.5 text-sm text-destructive">
              <AlertTriangle className="size-4" />
              {item.blocker}
            </p>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2 md:justify-end">
          <StatusBadge value={item.currentStage} />
          <span
            className={cn(
              'rounded-full px-2.5 py-1 text-xs font-medium',
              health.className,
            )}
          >
            {health.label}
          </span>
          {item.currentStage === 'PRODUCTION' && (
            <span className="inline-flex items-center gap-1 rounded-full bg-muted px-2.5 py-1 text-xs">
              <CheckCircle2 className="size-3.5" />
              {item.production.done}/{item.production.total} cards
            </span>
          )}
          <Link href={plmTrackerHref(item.trackerId)}>
            <Button size="sm" variant="outline">
              Open tracker
            </Button>
          </Link>
        </div>
      </div>
    </div>
  );
  return embedded ? (
    content
  ) : (
    <Card>
      <CardContent className="p-0">{content}</CardContent>
    </Card>
  );
}

function DeliveryUrgency({ item }: { item: PlmDashboardItem }) {
  const tier = deliveryUrgencyTier(item.daysUntilDue);
  if (!item.promisedDeliveryDate || tier === 'UNCONFIRMED')
    return (
      <p className="mt-1 text-xs text-muted-foreground">
        {deliveryCountdownLabel(null)}
      </p>
    );
  return (
    <p
      className={cn(
        'mt-1 text-xs font-medium',
        DELIVERY_URGENCY_TEXT_CLASS[tier],
      )}
    >
      <time dateTime={item.promisedDeliveryDate}>
        Delivery {new Date(item.promisedDeliveryDate).toLocaleDateString()}
      </time>{' '}
      · {deliveryCountdownLabel(item.daysUntilDue)}
    </p>
  );
}
