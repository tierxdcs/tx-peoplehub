import { apiFetch } from './api';
import { ageHours, urgencyTier } from './urgency';

export type PingStatus = 'PENDING' | 'ACKNOWLEDGED' | 'RESOLVED';
export type PingEmployee = { id: string; fullName: string; email: string; employeeId: string };
export type ReceivedPing = {
  id: string;
  status: PingStatus;
  respondedAt: string | null;
  ping: { id: string; message: string; linkedRecordType: string | null; linkedRecordId: string | null; createdAt: string; fromEmployee: PingEmployee };
};
export type SentPing = {
  id: string;
  message: string;
  linkedRecordType: string | null;
  linkedRecordId: string | null;
  createdAt: string;
  recipients: Array<{ id: string; status: PingStatus; respondedAt: string | null; employee: PingEmployee }>;
};

export const getReceivedPings = () => apiFetch<ReceivedPing[]>('/pings/received');
export const getSentPings = () => apiFetch<SentPing[]>('/pings/sent');
export const respondToPing = (id: string, status: Exclude<PingStatus, 'PENDING'>) =>
  apiFetch(`/pings/received/${id}/status`, { method: 'PATCH', body: JSON.stringify({ status }) });
export const createPing = (body: { message: string; recipientIds: string[]; linkedRecordType?: string; linkedRecordId?: string }) =>
  apiFetch('/pings', { method: 'POST', body: JSON.stringify(body) });
export const createContextPing = (body: { message: string; recipientIds: string[]; linkedRecordType: string; linkedRecordId: string; verticalCode?: string }) =>
  apiFetch('/pings/contextual', { method: 'POST', body: JSON.stringify(body) });
export const getContextPingRecipients = (params: { verticalCode?: string; linkedRecordType?: string; linkedRecordId?: string }) => {
  const query = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => value && query.set(key, value));
  return apiFetch<PingEmployee[]>(`/pings/recipients?${query.toString()}`);
};

/** Hours a ping has been waiting. Thin alias over the app-wide age helper so
 *  pings and pending-approval badges measure elapsed time identically. */
export function pingAgeHours(createdAt: string, now = new Date()) {
  return ageHours(createdAt, now);
}

/** A PENDING ping past the shared aging boundary (24h) — the original
 *  escalation this app's whole urgency scale is anchored to. */
export function isPingOverdue(status: PingStatus, hours: number) {
  return status === 'PENDING' && urgencyTier(hours) !== 'ok';
}

/** Resolved pings linger on the dashboard for 24 hours after resolution. */
export const DASHBOARD_RESOLVED_TTL_MS = 24 * 3_600_000;
const RECEIVED_STATUS_RANK: Record<PingStatus, number> = { PENDING: 0, ACKNOWLEDGED: 1, RESOLVED: 2 };

/**
 * Dashboard ordering for received pings: pending first (oldest / most overdue on
 * top), then acknowledged, then resolved (most recently handled on top). Resolved
 * pings resolved at least 24 hours ago are dropped so the panel does not
 * accumulate history —
 * the full log still lives on the My Pings register (unchanged).
 */
export function orderReceivedForDashboard(received: ReceivedPing[], now: number = Date.now()): ReceivedPing[] {
  return received
    .filter((row) => {
      if (row.status !== 'RESOLVED') return true;
      const resolvedAt = new Date(row.respondedAt ?? row.ping.createdAt).getTime();
      return now - resolvedAt < DASHBOARD_RESOLVED_TTL_MS;
    })
    .sort((a, b) => {
      const byStatus = RECEIVED_STATUS_RANK[a.status] - RECEIVED_STATUS_RANK[b.status];
      if (byStatus !== 0) return byStatus;
      const at = new Date(a.ping.createdAt).getTime();
      const bt = new Date(b.ping.createdAt).getTime();
      // Pending: oldest first to surface the most overdue. Handled: most recent first.
      return a.status === 'PENDING' ? at - bt : bt - at;
    });
}

export function linkedPingHref(type: string | null, id: string | null): string | null {
  if (!type || !id) return null;
  const routes: Record<string, string> = {
    KANBAN_CARD: `/kanban/cards/${id}`,
    ORDER: `/sales/orders/${id}`,
    BID: `/sales/bids/${id}`,
    PROJECT_KICKOFF: `/project-kickoff/${id}`,
    PLM_TRACKER: `/plm/trackers/${id}`,
    RFQ: `/scm/rfqs/${id}`,
    KANBAN_BOARD: `/kanban/boards/${id}`,
    // Same intake, from the two sides of the design handover: Sales reads it in
    // its own register, the design team in the quote BOM queue.
    CUSTOMER_BOM_INTAKE: `/sales/bom-intake/${id}`,
    DESIGN_BOM_INTAKE: `/design/bom-intake/${id}`,
    PAGE: id.startsWith('/') && !id.startsWith('//') ? id : '',
  };
  return routes[type] || null;
}

export type PingPageContext = { verticalCode?: string; linkedRecordType: string; linkedRecordId: string; label: string };
export function pingContextForPath(pathname: string): PingPageContext {
  const segments = pathname.split('/').filter(Boolean);
  const dynamic: Array<[RegExp, string, string]> = [
    [/^\/kanban\/boards\/([^/]+)/, 'KANBAN_BOARD', 'Kanban board'],
    [/^\/kanban\/cards\/([^/]+)/, 'KANBAN_CARD', 'Kanban card'],
    [/^\/sales\/orders\/([^/]+)/, 'ORDER', 'Order'],
    [/^\/sales\/bids\/([^/]+)/, 'BID', 'Bid'],
    [/^\/project-kickoff\/([^/]+)/, 'PROJECT_KICKOFF', 'Project kickoff'],
    [/^\/plm\/trackers\/([^/]+)/, 'PLM_TRACKER', 'PLM tracker'],
    [/^\/scm\/rfqs\/([^/]+)/, 'RFQ', 'RFQ'],
  ];
  const verticalByRoot: Record<string, string> = { sales: 'SALES', scm: 'SCM', stores: 'PRODUCTION', logistics: 'PRODUCTION', qms: 'QUALITY', design: 'DESIGN', hr: 'HR', finance: 'ACCOUNTS' };
  for (const [pattern, type, label] of dynamic) { const match = pathname.match(pattern); if (match) return { verticalCode: verticalByRoot[segments[0]], linkedRecordType: type, linkedRecordId: match[1], label }; }
  return { verticalCode: verticalByRoot[segments[0]], linkedRecordType: 'PAGE', linkedRecordId: pathname, label: 'Current page' };
}
