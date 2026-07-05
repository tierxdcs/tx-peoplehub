'use client';

import { useState } from 'react';
import { apiFetch } from '../../../../lib/api';
import { BankDetails, Compensation, Statutory } from '../../../../lib/types';

type Tab = 'compensation' | 'statutory' | 'banking';

const currency = new Intl.NumberFormat('en-IN', {
  style: 'currency',
  currency: 'INR',
  maximumFractionDigits: 2,
});

interface SensitiveDetailPanelProps {
  employeeId: string;
  employeeName: string;
  onClose: () => void;
}

/**
 * Admin-only. Only ever rendered by the roster page when the viewer is an
 * Admin/SuperAdmin — HR-vertical viewers never see the trigger for this at
 * all. Each tab fetches its own endpoint only when opened, not eagerly.
 */
export function SensitiveDetailPanel({
  employeeId,
  employeeName,
  onClose,
}: SensitiveDetailPanelProps) {
  const [activeTab, setActiveTab] = useState<Tab>('compensation');
  const [compensation, setCompensation] = useState<Compensation | null>(null);
  const [statutory, setStatutory] = useState<Statutory | null>(null);
  const [bankDetails, setBankDetails] = useState<BankDetails | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function selectTab(tab: Tab) {
    setActiveTab(tab);
    setError(null);

    if (tab === 'compensation' && !compensation) {
      setLoading(true);
      apiFetch<Compensation>(`/employees/${employeeId}/compensation`)
        .then(setCompensation)
        .catch(() => setError('Failed to load compensation'))
        .finally(() => setLoading(false));
    } else if (tab === 'statutory' && !statutory) {
      setLoading(true);
      apiFetch<Statutory>(`/employees/${employeeId}/statutory`)
        .then(setStatutory)
        .catch(() => setError('Failed to load statutory info'))
        .finally(() => setLoading(false));
    } else if (tab === 'banking' && !bankDetails) {
      setLoading(true);
      apiFetch<BankDetails>(`/employees/${employeeId}/bank-details`)
        .then(setBankDetails)
        .catch(() => setError('Failed to load bank details'))
        .finally(() => setLoading(false));
    }
  }

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.4)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 100,
      }}
      onClick={onClose}
    >
      <div
        style={{
          background: '#fff',
          padding: 24,
          borderRadius: 6,
          width: 420,
          maxHeight: '80vh',
          overflowY: 'auto',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <h2>{employeeName} — Sensitive Details</h2>
        <p
          style={{
            background: '#fff4e5',
            border: '1px solid #d9822b',
            borderRadius: 4,
            padding: 8,
            fontSize: 13,
          }}
        >
          You are viewing sensitive PII. This action is recorded in the
          audit log.
        </p>

        <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
          {(['compensation', 'statutory', 'banking'] as Tab[]).map((tab) => (
            <button
              key={tab}
              onClick={() => selectTab(tab)}
              style={{
                padding: '6px 12px',
                fontWeight: activeTab === tab ? 'bold' : 'normal',
              }}
            >
              {tab === 'compensation'
                ? 'Compensation'
                : tab === 'statutory'
                  ? 'Statutory'
                  : 'Banking'}
            </button>
          ))}
        </div>

        {loading && <p>Loading…</p>}
        {error && <p style={{ color: 'crimson' }}>{error}</p>}

        {!loading && activeTab === 'compensation' && compensation && (
          <dl>
            <dt>Basic salary</dt>
            <dd>{currency.format(Number(compensation.basicSalary))}</dd>
            <dt>HRA</dt>
            <dd>{currency.format(Number(compensation.hra))}</dd>
            <dt>Effective date</dt>
            <dd>{compensation.effectiveDate}</dd>
          </dl>
        )}

        {!loading && activeTab === 'statutory' && statutory && (
          <dl>
            <dt>PAN number</dt>
            <dd>{statutory.panNumber}</dd>
            <dt>Aadhaar (last 4)</dt>
            <dd>{statutory.aadhaarLast4}</dd>
            <dt>PF account number</dt>
            <dd>{statutory.pfAccountNumber}</dd>
            <dt>ESIC number</dt>
            <dd>{statutory.esicNumber ?? '—'}</dd>
          </dl>
        )}

        {!loading && activeTab === 'banking' && bankDetails && (
          <dl>
            <dt>Bank account number</dt>
            <dd>{bankDetails.bankAccountNumber}</dd>
            <dt>IFSC code</dt>
            <dd>{bankDetails.ifscCode}</dd>
          </dl>
        )}

        <button onClick={onClose} style={{ marginTop: 16 }}>
          Close
        </button>
      </div>
    </div>
  );
}
