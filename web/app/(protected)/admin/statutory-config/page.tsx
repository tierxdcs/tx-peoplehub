'use client';

import { useCallback, useEffect, useState } from 'react';
import { apiFetch, ApiError } from '../../../lib/api';
import { StatutoryConfig, StatutoryConfigType } from '../../../lib/types';

const CONFIG_TYPES: StatutoryConfigType[] = [
  'PF',
  'ESI',
  'PROFESSIONAL_TAX',
  'TDS_SLAB',
  'STANDARD_DEDUCTION',
];

const fieldStyle: React.CSSProperties = {
  width: '100%',
  padding: 8,
  boxSizing: 'border-box',
};

/** Placeholder configData JSON per type — matches StatutoryConfigService's REQUIRED_FIELDS. */
const CONFIG_DATA_PLACEHOLDER: Record<StatutoryConfigType, string> = {
  PF: JSON.stringify(
    {
      employeeRate: 0.12,
      employerRate: 0.12,
      epsRate: 0.0833,
      wageCeiling: 15000,
      adminCharge: 0.005,
    },
    null,
    2,
  ),
  ESI: JSON.stringify(
    { employeeRate: 0.0075, employerRate: 0.0325, wageThreshold: 21000 },
    null,
    2,
  ),
  PROFESSIONAL_TAX: JSON.stringify(
    { slabs: [{ slabFrom: 0, slabTo: 15000, amount: 0 }] },
    null,
    2,
  ),
  TDS_SLAB: JSON.stringify(
    { slabs: [{ slabFrom: 0, slabTo: 300000, rate: 0 }] },
    null,
    2,
  ),
  STANDARD_DEDUCTION: JSON.stringify({ amount: 50000 }, null, 2),
};

export default function StatutoryConfigPage() {
  const [items, setItems] = useState<StatutoryConfig[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await apiFetch<StatutoryConfig[]>('/statutory-config');
      setItems(res);
    } catch {
      setError('Failed to load statutory config');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <div>
      <h1>Statutory Config</h1>

      <div
        style={{
          background: '#fff3cd',
          border: '2px solid #d9822b',
          borderRadius: 6,
          padding: 16,
          marginBottom: 24,
          fontWeight: 'bold',
          color: '#7a4a00',
        }}
      >
        ⚠ Statutory rates must be verified against current EPFO/ESIC/Income
        Tax Department sources before use in a real payroll run. Do not enter
        production rates without compliance sign-off. Every payslip generated
        from configs entered here is a test/placeholder computation, not a
        real one, until that sign-off is complete.
      </div>

      <div style={{ marginBottom: 16 }}>
        <button style={{ padding: '8px 16px' }} onClick={() => setShowForm(true)}>
          Add Config Version
        </button>
      </div>

      {error && <p style={{ color: 'crimson' }}>{error}</p>}
      {loading ? (
        <p>Loading…</p>
      ) : items.length === 0 ? (
        <p>No StatutoryConfig entries yet — payroll processing will fail until some are added.</p>
      ) : (
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ textAlign: 'left', borderBottom: '1px solid #ccc' }}>
              <th>Type</th>
              <th>State</th>
              <th>Effective From</th>
              <th>Effective To</th>
              <th>Source Note</th>
            </tr>
          </thead>
          <tbody>
            {items.map((c) => (
              <tr key={c.id} style={{ borderBottom: '1px solid #eee' }}>
                <td>{c.configType}</td>
                <td>{c.state ?? '—'}</td>
                <td>{c.effectiveFrom.slice(0, 10)}</td>
                <td>{c.effectiveTo ? c.effectiveTo.slice(0, 10) : 'Open-ended'}</td>
                <td>{c.sourceNote}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {showForm && (
        <CreateConfigForm
          onClose={() => setShowForm(false)}
          onCreated={() => {
            setShowForm(false);
            load();
          }}
        />
      )}
    </div>
  );
}

function CreateConfigForm({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: () => void;
}) {
  const [configType, setConfigType] = useState<StatutoryConfigType>('PF');
  const [state, setState] = useState('');
  const [effectiveFrom, setEffectiveFrom] = useState('');
  const [effectiveTo, setEffectiveTo] = useState('');
  const [configData, setConfigData] = useState(CONFIG_DATA_PLACEHOLDER.PF);
  const [sourceNote, setSourceNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  function handleTypeChange(next: StatutoryConfigType) {
    setConfigType(next);
    setConfigData(CONFIG_DATA_PLACEHOLDER[next]);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (configType === 'PROFESSIONAL_TAX' && !state.trim()) {
      setError('State is required for PROFESSIONAL_TAX');
      return;
    }
    if (!sourceNote.trim()) {
      setError('Source note is required — where did this rate come from?');
      return;
    }
    let parsedConfigData: Record<string, unknown>;
    try {
      parsedConfigData = JSON.parse(configData);
    } catch {
      setError('configData must be valid JSON');
      return;
    }

    setSubmitting(true);
    try {
      await apiFetch('/statutory-config', {
        method: 'POST',
        body: JSON.stringify({
          configType,
          state: state.trim() || undefined,
          effectiveFrom,
          effectiveTo: effectiveTo || undefined,
          configData: parsedConfigData,
          sourceNote,
        }),
      });
      onCreated();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to save config');
    } finally {
      setSubmitting(false);
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
      }}
      onClick={onClose}
    >
      <form
        onSubmit={handleSubmit}
        style={{ background: '#fff', padding: 24, borderRadius: 6, width: 460 }}
        onClick={(e) => e.stopPropagation()}
      >
        <h2>Add Config Version</h2>
        <p style={{ color: '#a00', fontWeight: 'bold', fontSize: 13 }}>
          ⚠ Do not enter production rates without compliance sign-off.
        </p>

        <div style={{ marginBottom: 12 }}>
          <label style={{ display: 'block', marginBottom: 4 }}>Type</label>
          <select
            value={configType}
            onChange={(e) =>
              handleTypeChange(e.target.value as StatutoryConfigType)
            }
            style={fieldStyle}
          >
            {CONFIG_TYPES.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </div>

        {configType === 'PROFESSIONAL_TAX' && (
          <div style={{ marginBottom: 12 }}>
            <label style={{ display: 'block', marginBottom: 4 }}>
              State (required)
            </label>
            <input
              value={state}
              onChange={(e) => setState(e.target.value)}
              style={fieldStyle}
            />
          </div>
        )}

        <div style={{ marginBottom: 12 }}>
          <label style={{ display: 'block', marginBottom: 4 }}>
            Effective from
          </label>
          <input
            type="date"
            value={effectiveFrom}
            onChange={(e) => setEffectiveFrom(e.target.value)}
            style={fieldStyle}
          />
        </div>

        <div style={{ marginBottom: 12 }}>
          <label style={{ display: 'block', marginBottom: 4 }}>
            Effective to (optional — open-ended if blank)
          </label>
          <input
            type="date"
            value={effectiveTo}
            onChange={(e) => setEffectiveTo(e.target.value)}
            style={fieldStyle}
          />
        </div>

        <div style={{ marginBottom: 12 }}>
          <label style={{ display: 'block', marginBottom: 4 }}>
            Config data (JSON — shape depends on type)
          </label>
          <textarea
            value={configData}
            onChange={(e) => setConfigData(e.target.value)}
            style={{ ...fieldStyle, minHeight: 120, fontFamily: 'monospace' }}
          />
        </div>

        <div style={{ marginBottom: 12 }}>
          <label style={{ display: 'block', marginBottom: 4 }}>
            Source note (where this rate came from / who approved it)
          </label>
          <input
            value={sourceNote}
            onChange={(e) => setSourceNote(e.target.value)}
            placeholder="e.g. TEST DATA — not a real rate"
            style={fieldStyle}
          />
        </div>

        {error && <p style={{ color: 'crimson' }}>{error}</p>}

        <div style={{ display: 'flex', gap: 8 }}>
          <button type="submit" disabled={submitting} style={{ padding: 8 }}>
            {submitting ? 'Saving…' : 'Save'}
          </button>
          <button type="button" onClick={onClose} style={{ padding: 8 }}>
            Cancel
          </button>
        </div>
      </form>
    </div>
  );
}
