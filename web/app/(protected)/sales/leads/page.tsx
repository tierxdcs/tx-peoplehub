'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { apiFetch, ApiError } from '../../../lib/api';
import {
  Lead,
  LeadPriority,
  LeadSource,
  Opportunity,
  Order,
  PaginatedResult,
} from '../../../lib/types';
import { formatINR, leadDisplayStatus } from '../../../lib/sales';
import { statusVariant } from '../../../lib/status';
import { todayDateStr } from '../../../lib/date';
import { PageContainer } from '../../../components/ui/page-container';
import { PageHeader } from '../../../components/ui/page-header';
import { Card, CardContent } from '../../../components/ui/card';
import { Badge } from '../../../components/ui/badge';
import { StatusBadge } from '../../../components/ui/status-badge';
import { Button } from '../../../components/ui/button';
import { Input } from '../../../components/ui/input';
import { Select } from '../../../components/ui/select';
import { Textarea } from '../../../components/ui/textarea';
import { Field } from '../../../components/ui/field';
import { Skeleton } from '../../../components/ui/skeleton';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '../../../components/ui/dialog';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '../../../components/ui/table';
import { useToast } from '../../../components/ui/toaster';
import { useConfirm } from '../../../components/ui/confirm';

function StatCard({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <Card className="min-w-[160px] flex-1">
      <CardContent className="p-4">
        <div className="text-sm font-medium text-muted-foreground">{label}</div>
        <div className="mt-1 text-2xl font-semibold">{value}</div>
      </CardContent>
    </Card>
  );
}

export default function LeadsPage() {
  const router = useRouter();
  const toast = useToast();
  const confirm = useConfirm();
  const [leads, setLeads] = useState<Lead[]>([]);
  const [opportunities, setOpportunities] = useState<Opportunity[]>([]);
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showNew, setShowNew] = useState(false);
  const [convertTarget, setConvertTarget] = useState<Lead | null>(null);
  const [acting, setActing] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      // Everything needed for the blended pipeline view + summary cards.
      const [leadsRes, oppsRes, ordersRes] = await Promise.all([
        apiFetch<PaginatedResult<Lead>>('/leads?page=1&limit=100'),
        apiFetch<PaginatedResult<Opportunity>>('/opportunities?page=1&limit=100'),
        apiFetch<PaginatedResult<Order>>('/orders?page=1&limit=100'),
      ]);
      setLeads(leadsRes.items);
      setOpportunities(oppsRes.items);
      setOrders(ordersRes.items);
    } catch {
      setError('Failed to load leads');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const oppById = useMemo(() => {
    const m = new Map<string, Opportunity>();
    opportunities.forEach((o) => m.set(o.id, o));
    return m;
  }, [opportunities]);

  const summary = useMemo(() => {
    const newLeads = leads.filter((l) => l.status === 'NEW').length;
    const qualified = leads.filter((l) => l.status === 'QUALIFIED').length;
    const proposals = opportunities.filter(
      (o) => o.stage === 'PROPOSAL' || o.stage === 'NEGOTIATION',
    ).length;
    // Won YTD = sum of Order.totalAmount for orders created this year
    // (booked revenue — confirmed definition).
    const year = new Date().getFullYear();
    const wonYtd = orders
      .filter((o) => new Date(o.createdAt).getFullYear() === year)
      .reduce((sum, o) => sum + Number(o.totalAmount), 0);
    return { newLeads, qualified, proposals, wonYtd };
  }, [leads, opportunities, orders]);

  async function qualify(lead: Lead) {
    const ok = await confirm({
      title: 'Qualify lead?',
      description: `Mark ${lead.leadNumber} (${lead.companyName}) as Qualified.`,
      confirmLabel: 'Qualify',
    });
    if (!ok) return;
    setActing(lead.id);
    try {
      await apiFetch(`/leads/${lead.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ status: 'QUALIFIED' }),
      });
      toast.success(`${lead.leadNumber} qualified.`);
      await load();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Failed to qualify lead');
    } finally {
      setActing(null);
    }
  }

  /** Context-sensitive action per row, driven by actual status (spec §2.2). */
  function renderAction(lead: Lead) {
    if (acting === lead.id) {
      return <span className="text-sm text-muted-foreground">…</span>;
    }
    if (lead.status === 'NEW') {
      return (
        <Button size="sm" onClick={() => qualify(lead)}>
          Qualify
        </Button>
      );
    }
    if (lead.status === 'CONTACTED') {
      return (
        <Button
          size="sm"
          variant="outline"
          onClick={() => router.push(`/sales/leads/${lead.id}`)}
        >
          Follow-up
        </Button>
      );
    }
    if (lead.status === 'QUALIFIED') {
      return (
        <Button size="sm" onClick={() => setConvertTarget(lead)}>
          Convert to Opportunity
        </Button>
      );
    }
    if (lead.status === 'CONVERTED' && lead.convertedToOpportunityId) {
      // Once converted, always link to the Opportunity — its detail page owns
      // the bid-gate decision (deriveBidGate: Submit / Pending / Rejected /
      // Approved+Create Bid). The Lead Register must NOT predict that state
      // itself, so no bid-gate lookup happens here.
      return (
        <Button
          size="sm"
          variant="outline"
          onClick={() =>
            router.push(
              `/sales/opportunities/${lead.convertedToOpportunityId}`,
            )
          }
        >
          View Opportunity
        </Button>
      );
    }
    return <span className="text-muted-foreground">—</span>;
  }

  return (
    <PageContainer>
      <PageHeader
        title="Leads"
        description="Enquiry pipeline — from new lead through qualification and conversion."
        action={<Button onClick={() => setShowNew(true)}>+ New Enquiry</Button>}
      />

      <div className="mb-6 flex flex-wrap gap-3">
        <StatCard label="New Leads" value={summary.newLeads} />
        <StatCard label="Qualified" value={summary.qualified} />
        <StatCard label="Proposals" value={summary.proposals} />
        <StatCard label="Won YTD" value={formatINR(summary.wonYtd)} />
      </div>

      {error && <p className="mb-4 text-sm text-destructive">{error}</p>}

      <h2 className="mb-2 text-lg font-semibold">Lead Register</h2>
      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Lead ID</TableHead>
                <TableHead>Company</TableHead>
                <TableHead>Contact</TableHead>
                <TableHead>Requirement</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Priority</TableHead>
                <TableHead>Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                Array.from({ length: 5 }).map((_, i) => (
                  <TableRow key={i}>
                    {Array.from({ length: 7 }).map((__, j) => (
                      <TableCell key={j}>
                        <Skeleton className="h-4 w-24" />
                      </TableCell>
                    ))}
                  </TableRow>
                ))
              ) : leads.length === 0 ? (
                <TableRow>
                  <TableCell
                    colSpan={7}
                    className="py-8 text-center text-muted-foreground"
                  >
                    No leads yet.
                  </TableCell>
                </TableRow>
              ) : (
                leads.map((lead) => {
                  const opp = lead.convertedToOpportunityId
                    ? oppById.get(lead.convertedToOpportunityId)
                    : null;
                  const display = leadDisplayStatus(lead, opp);
                  return (
                    <TableRow key={lead.id}>
                      <TableCell className="font-medium">
                        {lead.leadNumber}
                      </TableCell>
                      <TableCell>{lead.companyName}</TableCell>
                      <TableCell>{lead.contactName}</TableCell>
                      <TableCell className="max-w-xs truncate">
                        {lead.requirement}
                      </TableCell>
                      <TableCell>
                        {/* Blended lead-status / opportunity-stage label,
                            rendered with the app-wide status colors. */}
                        <Badge variant={statusVariant(display.toUpperCase().replace(/ /g, '_'))}>
                          {display}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <StatusBadge value={lead.priority} />
                      </TableCell>
                      <TableCell>{renderAction(lead)}</TableCell>
                    </TableRow>
                  );
                })
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {showNew && (
        <NewLeadForm
          onClose={() => setShowNew(false)}
          onSaved={() => {
            setShowNew(false);
            toast.success('Lead created.');
            load();
          }}
        />
      )}

      {convertTarget && (
        <ConvertLeadForm
          lead={convertTarget}
          onClose={() => setConvertTarget(null)}
          onConverted={(opportunityId) => {
            setConvertTarget(null);
            // Land on the Opportunity detail page — its Bid/No-Bid gate
            // (Submit Assessment → … → Approved+Create Bid) owns whether a bid
            // can be drafted. Going straight to the bid form would bypass it.
            router.push(`/sales/opportunities/${opportunityId}`);
          }}
        />
      )}
    </PageContainer>
  );
}

const PRIORITIES: LeadPriority[] = ['HIGH', 'MEDIUM', 'LOW'];
const SOURCES: LeadSource[] = [
  'REFERRAL',
  'WEBSITE',
  'COLD_OUTREACH',
  'EVENT',
  'OTHER',
];

function NewLeadForm({
  onClose,
  onSaved,
}: {
  onClose: () => void;
  onSaved: () => void;
}) {
  const [companyName, setCompanyName] = useState('');
  const [contactName, setContactName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [requirement, setRequirement] = useState('');
  const [priority, setPriority] = useState<LeadPriority>('MEDIUM');
  const [source, setSource] = useState<LeadSource>('OTHER');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const next: Record<string, string> = {};
    if (!companyName) next.companyName = 'Company is required';
    if (!contactName) next.contactName = 'Contact is required';
    if (!requirement) next.requirement = 'Requirement is required';
    setErrors(next);
    if (Object.keys(next).length > 0) return;

    setSubmitting(true);
    try {
      await apiFetch('/leads', {
        method: 'POST',
        body: JSON.stringify({
          companyName,
          contactName,
          email: email || undefined,
          phone: phone || undefined,
          requirement,
          priority,
          source,
        }),
      });
      onSaved();
    } catch (err) {
      setErrors({
        _form: err instanceof ApiError ? err.message : 'Failed to create lead',
      });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New Enquiry</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <Field label="Company name" required error={errors.companyName}>
            <Input
              value={companyName}
              onChange={(e) => setCompanyName(e.target.value)}
              aria-invalid={!!errors.companyName}
            />
          </Field>
          <Field label="Contact name" required error={errors.contactName}>
            <Input
              value={contactName}
              onChange={(e) => setContactName(e.target.value)}
              aria-invalid={!!errors.contactName}
            />
          </Field>
          <Field label="Email">
            <Input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </Field>
          <Field label="Phone">
            <Input value={phone} onChange={(e) => setPhone(e.target.value)} />
          </Field>
          <Field label="Requirement" required error={errors.requirement}>
            <Textarea
              value={requirement}
              onChange={(e) => setRequirement(e.target.value)}
              placeholder="e.g. Liquid Cooling LC25 — 500 nos"
              aria-invalid={!!errors.requirement}
            />
          </Field>
          <div className="flex gap-3">
            <Field label="Priority" className="flex-1">
              <Select
                value={priority}
                onChange={(e) => setPriority(e.target.value as LeadPriority)}
              >
                {PRIORITIES.map((p) => (
                  <option key={p} value={p}>
                    {p}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Source" className="flex-1">
              <Select
                value={source}
                onChange={(e) => setSource(e.target.value as LeadSource)}
              >
                {SOURCES.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </Select>
            </Field>
          </div>

          {errors._form && (
            <p className="text-sm text-destructive">{errors._form}</p>
          )}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={submitting}>
              {submitting ? 'Saving…' : 'Create Lead'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/**
 * "Convert to Opportunity" on a QUALIFIED lead converts it into an Opportunity
 * (spec §2.6/§3.1) — creating a Customer from the lead when none is linked —
 * then routes to the Opportunity detail page. Bid creation is NOT started here:
 * it's gated behind the Opportunity's Bid/No-Bid assessment, which the rep
 * submits on that page before a bid can be drafted.
 */
function ConvertLeadForm({
  lead,
  onClose,
  onConverted,
}: {
  lead: Lead;
  onClose: () => void;
  onConverted: (opportunityId: string) => void;
}) {
  const [opportunityName, setOpportunityName] = useState(
    `${lead.companyName} — ${lead.requirement}`.slice(0, 120),
  );
  const [estimatedValue, setEstimatedValue] = useState('');
  const [expectedCloseDate, setExpectedCloseDate] = useState('');
  const [billingState, setBillingState] = useState('');
  const [billingText, setBillingText] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const next: Record<string, string> = {};
    if (!opportunityName) next.opportunityName = 'Required';
    if (estimatedValue === '') next.estimatedValue = 'Required';
    if (!expectedCloseDate) next.expectedCloseDate = 'Required';
    if (!billingText.trim() && !billingState.trim())
      next.billingState = 'A billing address or state is required';
    setErrors(next);
    if (Object.keys(next).length > 0) return;

    setSubmitting(true);
    try {
      const billingAddress = billingText.trim()
        ? { line1: billingText, state: billingState || undefined }
        : { state: billingState };
      const opp = await apiFetch<Opportunity>(`/leads/${lead.id}/convert`, {
        method: 'POST',
        body: JSON.stringify({
          opportunityName,
          estimatedValue: Number(estimatedValue),
          expectedCloseDate,
          billingAddress,
        }),
      });
      onConverted(opp.id);
    } catch (err) {
      setErrors({
        _form: err instanceof ApiError ? err.message : 'Failed to convert lead',
      });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Convert {lead.leadNumber} → Opportunity</DialogTitle>
          <DialogDescription>
            Converting creates an Opportunity (and a Customer from this lead),
            then takes you to the Opportunity, where you’ll submit the
            Bid/No-Bid assessment before a bid can be created.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <Field label="Opportunity name" required error={errors.opportunityName}>
            <Input
              value={opportunityName}
              onChange={(e) => setOpportunityName(e.target.value)}
              aria-invalid={!!errors.opportunityName}
            />
          </Field>
          <Field label="Estimated value (₹)" required error={errors.estimatedValue}>
            <Input
              type="number"
              min={0}
              value={estimatedValue}
              onChange={(e) => setEstimatedValue(e.target.value)}
              aria-invalid={!!errors.estimatedValue}
            />
          </Field>
          <Field
            label="Expected close date"
            required
            error={errors.expectedCloseDate}
          >
            <Input
              type="date"
              value={expectedCloseDate}
              // Forward-looking: an expected close date can't be in the past.
              min={todayDateStr()}
              onChange={(e) => setExpectedCloseDate(e.target.value)}
              aria-invalid={!!errors.expectedCloseDate}
            />
          </Field>
          <Field label="Billing address (line)">
            <Input
              value={billingText}
              onChange={(e) => setBillingText(e.target.value)}
              placeholder="123 MG Road, Mumbai"
            />
          </Field>
          <Field
            label="Billing state (drives GST intra/inter-state)"
            error={errors.billingState}
          >
            <Input
              value={billingState}
              onChange={(e) => setBillingState(e.target.value)}
              placeholder="Maharashtra"
              aria-invalid={!!errors.billingState}
            />
          </Field>

          {errors._form && (
            <p className="text-sm text-destructive">{errors._form}</p>
          )}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={submitting}>
              {submitting ? 'Converting…' : 'Convert to Opportunity'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
