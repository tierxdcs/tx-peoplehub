'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useParams } from 'next/navigation';
import { COMPANY } from '../../../lib/theme';
import {
  publicResolveRfq,
  publicSaveRfqQuote,
  publicSubmitRfqQuote,
  publicDeclineRfq,
  type PublicRfqView,
  type PublicQuoteLineInput,
} from '../../../lib/rfq';

/**
 * Public RFQ quote form — outside the app shell, unauthenticated, resolved by
 * token (mirrors the vendor questionnaire). Sealed-bid: the invited partner
 * enters a per-line unit price, optional lead time / remarks, and header terms,
 * then either saves a draft, submits (locks), or declines. Standalone document
 * look branded via COMPANY.
 */

const ACCENT = '#f97316';
const INK = '#1e2340';

const inr = new Intl.NumberFormat('en-IN', {
  style: 'currency',
  currency: 'INR',
  maximumFractionDigits: 2,
});
function money(n: number): string {
  return Number.isFinite(n) ? inr.format(n) : '—';
}

interface LineState {
  unitPrice: string;
  deliveryLeadTimeDays: string;
  remarks: string;
}

export default function PublicRfqQuotePage() {
  const { token } = useParams<{ token: string }>();

  const [loading, setLoading] = useState(true);
  const [needsPassword, setNeedsPassword] = useState(false);
  const [password, setPassword] = useState('');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [view, setView] = useState<PublicRfqView | null>(null);
  const [banner, setBanner] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [done, setDone] = useState<'submitted' | 'declined' | null>(null);

  // Header fields.
  const [quotedLeadTimeDays, setQuotedLeadTimeDays] = useState('');
  const [paymentTermsOffered, setPaymentTermsOffered] = useState('');
  const [validityDays, setValidityDays] = useState('');
  const [notes, setNotes] = useState('');
  const [declineReason, setDeclineReason] = useState('');

  // Per-line state keyed by rfqLineId.
  const [lineState, setLineState] = useState<Record<string, LineState>>({});

  // Password kept in a ref so save/submit calls always use the resolved one.
  const pwRef = useRef<string | undefined>(undefined);

  const applyView = useCallback((v: PublicRfqView) => {
    setView(v);
    if (v.quoteStatus === 'SUBMITTED') setDone('submitted');
    if (v.quoteStatus === 'DECLINED') setDone('declined');
    // Seed header + line state from any previously-saved quote (resume).
    if (v.quote) {
      setQuotedLeadTimeDays(
        v.quote.quotedLeadTimeDays != null ? String(v.quote.quotedLeadTimeDays) : '',
      );
      setPaymentTermsOffered(v.quote.paymentTermsOffered ?? '');
      setValidityDays(v.quote.validityDays != null ? String(v.quote.validityDays) : '');
      setNotes(v.quote.notes ?? '');
    }
    const seeded: Record<string, LineState> = {};
    for (const line of v.rfq.lines) {
      const q = v.quote?.lines.find((l) => l.rfqLineId === line.id);
      seeded[line.id] = {
        unitPrice: q?.unitPrice ?? '',
        deliveryLeadTimeDays:
          q?.deliveryLeadTimeDays != null ? String(q.deliveryLeadTimeDays) : '',
        remarks: q?.remarks ?? '',
      };
    }
    setLineState(seeded);
  }, []);

  const resolve = useCallback(
    async (pwd?: string) => {
      const res = await publicResolveRfq(token, pwd);
      if (res.ok) {
        pwRef.current = pwd;
        setNeedsPassword(false);
        setErrorMsg(null);
        applyView(res.data);
      } else if (res.status === 403 && /password/i.test(res.message)) {
        setNeedsPassword(true);
      } else {
        setErrorMsg(res.message);
      }
    },
    [token, applyView],
  );

  useEffect(() => {
    resolve().finally(() => setLoading(false));
  }, [resolve]);

  function setLine(lineId: string, patch: Partial<LineState>) {
    setLineState((s) => ({ ...s, [lineId]: { ...s[lineId], ...patch } }));
  }

  function buildLines(requireAllPriced: boolean): PublicQuoteLineInput[] | null {
    if (!view) return null;
    const out: PublicQuoteLineInput[] = [];
    for (const line of view.rfq.lines) {
      const st = lineState[line.id];
      const priced = st?.unitPrice.trim() !== '' && Number(st.unitPrice) >= 0;
      if (!priced) {
        if (requireAllPriced) return null;
        continue;
      }
      out.push({
        rfqLineId: line.id,
        unitPrice: Number(st.unitPrice),
        ...(st.deliveryLeadTimeDays.trim()
          ? { deliveryLeadTimeDays: Number(st.deliveryLeadTimeDays) }
          : {}),
        ...(st.remarks.trim() ? { remarks: st.remarks.trim() } : {}),
      });
    }
    return out;
  }

  function header() {
    return {
      password: pwRef.current,
      ...(quotedLeadTimeDays.trim() ? { quotedLeadTimeDays: Number(quotedLeadTimeDays) } : {}),
      ...(paymentTermsOffered.trim() ? { paymentTermsOffered: paymentTermsOffered.trim() } : {}),
      ...(validityDays.trim() ? { validityDays: Number(validityDays) } : {}),
      ...(notes.trim() ? { notes: notes.trim() } : {}),
    };
  }

  async function save() {
    setSaving(true);
    setBanner(null);
    const lines = buildLines(false) ?? [];
    const res = await publicSaveRfqQuote(token, { ...header(), lines });
    setSaving(false);
    if (res.ok) {
      applyView(res.data);
      setBanner('Draft saved. You can close this and resume later via the same link.');
    } else {
      setBanner(res.message);
    }
  }

  async function submit() {
    const lines = buildLines(true);
    if (lines == null) {
      setBanner('Please enter a unit price for every line before submitting.');
      return;
    }
    setSaving(true);
    setBanner(null);
    const res = await publicSubmitRfqQuote(token, { ...header(), lines });
    setSaving(false);
    if (res.ok) {
      applyView(res.data);
      setDone('submitted');
    } else {
      setBanner(res.message);
    }
  }

  async function decline() {
    setSaving(true);
    setBanner(null);
    const res = await publicDeclineRfq(token, {
      password: pwRef.current,
      ...(declineReason.trim() ? { declineReason: declineReason.trim() } : {}),
    });
    setSaving(false);
    if (res.ok) {
      applyView(res.data);
      setDone('declined');
    } else {
      setBanner(res.message);
    }
  }

  // ── Render states ──────────────────────────────────────────────────
  if (loading) {
    return (
      <Shell>
        <p style={{ color: '#6b7280' }}>Loading…</p>
      </Shell>
    );
  }
  if (errorMsg) {
    return (
      <Shell>
        <div style={{ padding: 24, textAlign: 'center' }}>
          <h2 style={{ color: INK }}>This link isn’t available</h2>
          <p style={{ color: '#6b7280' }}>{errorMsg}</p>
          <p style={{ color: '#6b7280', fontSize: 13 }}>
            If you believe this is an error, please contact your {COMPANY.name}{' '}
            representative for a new link.
          </p>
        </div>
      </Shell>
    );
  }
  if (needsPassword) {
    return (
      <Shell>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void resolve(password);
          }}
          style={{ padding: 24, maxWidth: 360, margin: '0 auto' }}
        >
          <h2 style={{ color: INK }}>Password required</h2>
          <p style={{ color: '#6b7280', fontSize: 14 }}>
            This quote link is password-protected.
          </p>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Enter password"
            style={inputStyle}
          />
          <button type="submit" style={{ ...btnPrimary, marginTop: 12 }}>
            Continue
          </button>
        </form>
      </Shell>
    );
  }
  if (done === 'submitted') {
    return (
      <Shell>
        <div style={{ padding: 24, textAlign: 'center' }}>
          <h2 style={{ color: INK }}>Thank you — your quote has been submitted.</h2>
          <p style={{ color: '#6b7280' }}>
            Your quotation has been received by {COMPANY.name} and is now locked. No
            further changes are needed.
          </p>
        </div>
      </Shell>
    );
  }
  if (done === 'declined') {
    return (
      <Shell>
        <div style={{ padding: 24, textAlign: 'center' }}>
          <h2 style={{ color: INK }}>You have declined to quote.</h2>
          <p style={{ color: '#6b7280' }}>
            Thank you for letting us know. No further action is required.
          </p>
        </div>
      </Shell>
    );
  }
  if (!view) {
    return (
      <Shell>
        <p>Not available.</p>
      </Shell>
    );
  }

  const { rfq } = view;
  const grandTotal = rfq.lines.reduce((sum, line) => {
    const st = lineState[line.id];
    const price = Number(st?.unitPrice);
    const qty = Number(line.quantity);
    return sum + (Number.isFinite(price) && Number.isFinite(qty) ? price * qty : 0);
  }, 0);

  return (
    <Shell>
      <p
        style={{
          margin: '0 0 20px',
          padding: '12px 16px',
          background: '#f8f8f9',
          borderLeft: `4px solid ${ACCENT}`,
          fontSize: 14,
          color: '#374151',
        }}
      >
        Please provide your unit prices for each line below. Use <strong>Save
        Draft</strong> to keep your progress — you can resume later via the same
        link. Your quote is sealed until the RFQ closes.
      </p>

      {banner && (
        <p
          style={{
            margin: '0 0 16px',
            padding: '10px 14px',
            background: '#fff7ec',
            border: '1px solid #f1d9b0',
            borderRadius: 4,
            fontSize: 13.5,
            color: '#92400e',
          }}
        >
          {banner}
        </p>
      )}

      {/* RFQ header */}
      <section style={{ marginBottom: 24 }}>
        <h2 style={{ fontSize: 18, margin: '0 0 4px', color: INK }}>
          {rfq.rfqNumber} — {rfq.title}
        </h2>
        {rfq.description && (
          <p style={{ fontSize: 13.5, color: '#374151', margin: '6px 0 12px' }}>
            {rfq.description}
          </p>
        )}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 10 }}>
          <Meta label="Submission Deadline" value={rfq.submissionDeadline.slice(0, 10)} />
          <Meta label="Required By" value={rfq.requiredByDate?.slice(0, 10) ?? '—'} />
          <Meta label="Delivery Location" value={rfq.deliveryLocation ?? '—'} />
          <Meta label="Payment Terms Requested" value={rfq.paymentTermsRequested ?? '—'} />
        </div>
      </section>

      {/* Line pricing table */}
      <table style={{ width: '100%', borderCollapse: 'collapse', marginBottom: 8 }}>
        <thead>
          <tr>
            {['Item', 'Qty', 'Unit Price (₹)', 'Lead Time (days)', 'Remarks', 'Line Total'].map(
              (h) => (
                <th
                  key={h}
                  style={{
                    background: INK,
                    color: '#fff',
                    fontSize: 12.5,
                    padding: '8px 10px',
                    textAlign: 'left',
                  }}
                >
                  {h}
                </th>
              ),
            )}
          </tr>
        </thead>
        <tbody>
          {rfq.lines.map((line) => {
            const st = lineState[line.id] ?? { unitPrice: '', deliveryLeadTimeDays: '', remarks: '' };
            const lineTotal = Number(st.unitPrice) * Number(line.quantity) || 0;
            return (
              <tr key={line.id}>
                <td style={cellStyle}>
                  <div style={{ fontWeight: 600, color: INK }}>{line.itemName ?? '—'}</div>
                  <div style={{ fontSize: 12, color: '#6b7280' }}>
                    {line.itemCode ?? ''}
                    {line.specificationNotes ? ` · ${line.specificationNotes}` : ''}
                  </div>
                </td>
                <td style={cellStyle}>
                  {line.quantity} {line.unitOfMeasure}
                </td>
                <td style={{ ...cellStyle, width: 130 }}>
                  <input
                    type="number"
                    min="0"
                    step="any"
                    style={inputStyle}
                    value={st.unitPrice}
                    onChange={(e) => setLine(line.id, { unitPrice: e.target.value })}
                  />
                </td>
                <td style={{ ...cellStyle, width: 110 }}>
                  <input
                    type="number"
                    min="0"
                    step="1"
                    style={inputStyle}
                    value={st.deliveryLeadTimeDays}
                    onChange={(e) => setLine(line.id, { deliveryLeadTimeDays: e.target.value })}
                  />
                </td>
                <td style={{ ...cellStyle, width: 180 }}>
                  <input
                    style={inputStyle}
                    value={st.remarks}
                    onChange={(e) => setLine(line.id, { remarks: e.target.value })}
                  />
                </td>
                <td style={{ ...cellStyle, textAlign: 'right', fontWeight: 600, color: INK }}>
                  {money(lineTotal)}
                </td>
              </tr>
            );
          })}
        </tbody>
        <tfoot>
          <tr>
            <td colSpan={5} style={{ ...cellStyle, textAlign: 'right', fontWeight: 600 }}>
              Grand Total
            </td>
            <td style={{ ...cellStyle, textAlign: 'right', fontWeight: 700, color: INK }}>
              {money(grandTotal)}
            </td>
          </tr>
        </tfoot>
      </table>

      {/* Quote header fields */}
      <section style={{ marginTop: 24 }}>
        <h3 style={{ fontSize: 14, margin: '0 0 10px', color: INK }}>Quote Terms</h3>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12 }}>
          <Labeled label="Lead Time (days)">
            <input
              type="number"
              min="0"
              style={inputStyle}
              value={quotedLeadTimeDays}
              onChange={(e) => setQuotedLeadTimeDays(e.target.value)}
            />
          </Labeled>
          <Labeled label="Payment Terms Offered">
            <input
              style={inputStyle}
              value={paymentTermsOffered}
              onChange={(e) => setPaymentTermsOffered(e.target.value)}
            />
          </Labeled>
          <Labeled label="Validity (days)">
            <input
              type="number"
              min="0"
              style={inputStyle}
              value={validityDays}
              onChange={(e) => setValidityDays(e.target.value)}
            />
          </Labeled>
        </div>
        <div style={{ marginTop: 12 }}>
          <Labeled label="Notes">
            <textarea
              style={{ ...inputStyle, minHeight: 70, resize: 'vertical' }}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
            />
          </Labeled>
        </div>
      </section>

      {/* Actions */}
      <div style={{ display: 'flex', gap: 12, marginTop: 28, justifyContent: 'flex-end' }}>
        <button onClick={save} disabled={saving} style={btnSecondary}>
          {saving ? 'Saving…' : 'Save Draft'}
        </button>
        <button onClick={submit} disabled={saving} style={btnPrimary}>
          Submit Quote
        </button>
      </div>

      {/* Decline */}
      <section
        style={{
          marginTop: 28,
          padding: '16px 18px',
          background: '#f8f8f9',
          borderRadius: 4,
        }}
      >
        <h3 style={{ fontSize: 14, margin: '0 0 8px', color: INK }}>Decline to Quote</h3>
        <p style={{ fontSize: 13, color: '#6b7280', margin: '0 0 10px' }}>
          If you cannot participate in this RFQ, you may decline below.
        </p>
        <input
          style={{ ...inputStyle, marginBottom: 10 }}
          placeholder="Reason (optional)"
          value={declineReason}
          onChange={(e) => setDeclineReason(e.target.value)}
        />
        <button
          onClick={decline}
          disabled={saving}
          style={{ ...btnSecondary, borderColor: '#c0392b', color: '#c0392b' }}
        >
          Decline to Quote
        </button>
      </section>
    </Shell>
  );
}

// ── Layout shell (standalone document look) ──────────────────────────
function Shell({ children }: { children: React.ReactNode }) {
  return (
    <main style={{ background: '#eef0f3', minHeight: '100vh', padding: '24px 0 60px' }}>
      <div
        style={{
          maxWidth: 860,
          margin: '0 auto',
          background: '#fff',
          boxShadow: '0 2px 10px rgba(0,0,0,0.08)',
        }}
      >
        <header
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '28px 40px 20px',
            borderBottom: `3px solid ${INK}`,
          }}
        >
          {COMPANY.logoPath ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={COMPANY.logoPath} alt={COMPANY.name} style={{ height: 46 }} />
          ) : (
            <strong style={{ fontSize: 20, color: INK }}>{COMPANY.name}</strong>
          )}
          <div style={{ textAlign: 'right' }}>
            <div
              style={{
                fontSize: 12,
                letterSpacing: '0.06em',
                color: '#6b7280',
                textTransform: 'uppercase',
              }}
            >
              {COMPANY.legalEntityName}
            </div>
            <h1 style={{ fontSize: 20, margin: '4px 0 0', color: INK }}>
              Request for Quotation
            </h1>
          </div>
        </header>
        <div style={{ padding: '20px 40px 40px' }}>{children}</div>
        <footer
          style={{
            textAlign: 'center',
            fontSize: 11.5,
            color: '#6b7280',
            padding: '20px 40px 34px',
          }}
        >
          {COMPANY.legalEntityName} — Request for Quotation · {COMPANY.confidentialityLine}
        </footer>
      </div>
    </main>
  );
}

function Meta({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div
        style={{
          fontSize: 11,
          letterSpacing: '0.05em',
          textTransform: 'uppercase',
          color: '#6b7280',
        }}
      >
        {label}
      </div>
      <div style={{ fontSize: 13.5, color: INK, fontWeight: 500 }}>{value}</div>
    </div>
  );
}

function Labeled({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label style={{ display: 'block' }}>
      <span style={{ display: 'block', fontSize: 12.5, color: '#374151', marginBottom: 4 }}>
        {label}
      </span>
      {children}
    </label>
  );
}

// ── Styles ───────────────────────────────────────────────────────────
const inputStyle: React.CSSProperties = {
  width: '100%',
  padding: '6px 8px',
  border: '1px solid #d8dbe2',
  borderRadius: 3,
  fontSize: 13.5,
  fontFamily: 'inherit',
  color: INK,
  boxSizing: 'border-box',
};
const cellStyle: React.CSSProperties = {
  padding: '6px 10px',
  borderBottom: '1px solid #d8dbe2',
  fontSize: 13.5,
  color: '#374151',
  verticalAlign: 'top',
};
const btnPrimary: React.CSSProperties = {
  background: INK,
  color: '#fff',
  border: 'none',
  padding: '9px 18px',
  borderRadius: 4,
  fontSize: 13.5,
  cursor: 'pointer',
};
const btnSecondary: React.CSSProperties = {
  background: '#fff',
  color: INK,
  border: `1px solid ${INK}`,
  padding: '9px 18px',
  borderRadius: 4,
  fontSize: 13.5,
  cursor: 'pointer',
};
