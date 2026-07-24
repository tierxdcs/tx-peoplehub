'use client';

import { useEffect, useState } from 'react';
import { apiFetch } from '../../../lib/api';
import { Vertical } from '../../../lib/types';

export default function VerticalsPage() {
  const [verticals, setVerticals] = useState<Vertical[]>([]);
  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [loading, setLoading] = useState(true);

  async function load() {
    setLoading(true);
    const res = await apiFetch<Vertical[]>('/verticals');
    setVerticals(res);
    setLoading(false);
  }

  useEffect(() => {
    load();
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await apiFetch('/verticals', {
        method: 'POST',
        body: JSON.stringify({ name, code }),
      });
      setName('');
      setCode('');
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Request failed');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div>
      <h1>Verticals</h1>

      {loading ? (
        <p>Loading…</p>
      ) : (
        <table style={{ width: '100%', borderCollapse: 'collapse', marginBottom: 24 }}>
          <thead>
            <tr style={{ textAlign: 'left', borderBottom: '1px solid hsl(var(--border))' }}>
              <th>Name</th>
              <th>Code</th>
              <th>Active</th>
            </tr>
          </thead>
          <tbody>
            {verticals.map((v) => (
              <tr key={v.id} style={{ borderBottom: '1px solid hsl(var(--border))' }}>
                <td>{v.name}</td>
                <td>{v.code}</td>
                <td>{v.isActive ? 'Yes' : 'No'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <h2>Create vertical</h2>
      <form onSubmit={handleSubmit} style={{ maxWidth: 360 }}>
        <div style={{ marginBottom: 12 }}>
          <label>Name</label>
          <br />
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
            style={{ width: '100%', padding: 8 }}
          />
        </div>
        <div style={{ marginBottom: 12 }}>
          <label>Code</label>
          <br />
          <input
            value={code}
            onChange={(e) => setCode(e.target.value)}
            required
            style={{ width: '100%', padding: 8 }}
          />
        </div>
        {error && <p className="text-destructive">{error}</p>}
        <button type="submit" disabled={submitting} style={{ padding: 8 }}>
          {submitting ? 'Creating…' : 'Create'}
        </button>
      </form>
    </div>
  );
}
