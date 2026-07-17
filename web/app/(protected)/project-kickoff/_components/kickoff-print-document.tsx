import { COMPANY } from '../../../lib/theme';
import {
  ACTION_ITEM_STATUS_LABEL,
  MEETING_MODE_LABEL,
  type ProjectKickoff,
} from '../../../lib/project-kickoff';

const NAVY = '#16283b';
const ACCENT = '#e0a83d';
const RULE = '#dfe3e8';
const MUTED = '#6b7280';

function fmtDate(iso: string | null): string {
  return iso
    ? new Date(iso).toLocaleDateString(undefined, {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
      })
    : '—';
}

function PageHeader() {
  return (
    <div>
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'flex-start',
          paddingBottom: 10,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center' }}>
          {COMPANY.logoPath ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={COMPANY.logoPath}
              alt={`${COMPANY.name} logo`}
              style={{ height: 46, width: 'auto', objectFit: 'contain' }}
            />
          ) : (
            <span style={{ fontSize: 22, fontWeight: 800 }}>{COMPANY.name}</span>
          )}
        </div>
        <div style={{ textAlign: 'right', fontSize: 11, color: MUTED }}>
          <div style={{ fontSize: 9, fontWeight: 700, letterSpacing: '0.12em', textTransform: 'uppercase', color: NAVY }}>
            Project Kickoff
          </div>
          <div style={{ marginTop: 3 }}>{COMPANY.contactEmail}</div>
          <div>{COMPANY.website}</div>
        </div>
      </div>
      <div style={{ borderTop: `2px solid ${NAVY}`, position: 'relative' }}>
        <div style={{ position: 'absolute', top: -2, left: 0, width: '14%', borderTop: `2px solid ${ACCENT}` }} />
      </div>
    </div>
  );
}

function PageFooter() {
  return (
    <div style={{ paddingTop: 8 }}>
      <div style={{ borderTop: `2px solid ${NAVY}`, position: 'relative', marginBottom: 8 }}>
        <div style={{ position: 'absolute', top: -2, right: 0, width: '18%', borderTop: `2px solid ${ACCENT}` }} />
      </div>
      <div style={{ fontSize: 8, color: MUTED, textAlign: 'center' }}>
        {COMPANY.confidentialityLine}
      </div>
    </div>
  );
}

/** Section heading with an amber tick. */
function Kicker({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 6,
        fontSize: 12,
        fontWeight: 700,
        color: NAVY,
        margin: '18px 0 8px',
      }}
    >
      <span style={{ width: 8, height: 8, background: ACCENT, display: 'inline-block' }} />
      {children}
    </div>
  );
}

const th: React.CSSProperties = {
  padding: '6px 8px',
  fontSize: 10,
  fontWeight: 700,
  color: '#fff',
  textAlign: 'left',
};
const td: React.CSSProperties = {
  padding: '6px 8px',
  fontSize: 10.5,
  verticalAlign: 'top',
  borderBottom: `1px solid ${RULE}`,
};

/**
 * Print-only Project Kickoff document. Same `.print-document` + running
 * header/footer pattern as the Techno-Commercial Proposal. Sections in the
 * spec's order; action items show their current computed status at export time.
 */
export function KickoffPrintDocument({ kickoff }: { kickoff: ProjectKickoff }) {
  const attendees = kickoff.attendees ?? [];
  const milestones = kickoff.milestones ?? [];
  const actionItems = kickoff.actionItems ?? [];
  const risks = kickoff.risks ?? [];

  return (
    <div className="print-document" style={{ color: '#111', lineHeight: 1.5 }}>
      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead className="print-running-head">
          <tr>
            <td style={{ padding: 0 }}>
              <PageHeader />
            </td>
          </tr>
        </thead>
        <tfoot className="print-running-foot">
          <tr>
            <td style={{ padding: 0 }}>
              <PageFooter />
            </td>
          </tr>
        </tfoot>
        <tbody>
          <tr>
            <td style={{ padding: '18px 0 0' }}>
              <div style={{ fontSize: 22, fontWeight: 800, color: NAVY, marginBottom: 4 }}>
                {kickoff.projectName}
              </div>
              <div style={{ fontSize: 11, color: MUTED, marginBottom: 6 }}>
                Project Kickoff Record · Status: {kickoff.status}
              </div>

              {/* Project information */}
              <Kicker>Project Information</Kicker>
              <table style={{ fontSize: 11, borderCollapse: 'collapse' }}>
                <tbody>
                  <tr>
                    <td style={{ color: MUTED, paddingRight: 16 }}>Meeting date</td>
                    <td style={{ fontWeight: 600 }}>{fmtDate(kickoff.meetingDate)}</td>
                  </tr>
                  <tr>
                    <td style={{ color: MUTED, paddingRight: 16, paddingTop: 3 }}>Mode</td>
                    <td style={{ paddingTop: 3 }}>{MEETING_MODE_LABEL[kickoff.meetingMode]}</td>
                  </tr>
                  {kickoff.meetingLocation && (
                    <tr>
                      <td style={{ color: MUTED, paddingRight: 16, paddingTop: 3 }}>Location</td>
                      <td style={{ paddingTop: 3 }}>{kickoff.meetingLocation}</td>
                    </tr>
                  )}
                </tbody>
              </table>

              {/* Attendees */}
              <Kicker>Attendees</Kicker>
              {attendees.length === 0 ? (
                <p style={{ fontSize: 10.5, color: MUTED }}>No attendees recorded.</p>
              ) : (
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead>
                    <tr style={{ background: NAVY }}>
                      <th style={th}>Name</th>
                      <th style={th}>Organization</th>
                      <th style={th}>Designation</th>
                      <th style={th}>Department</th>
                    </tr>
                  </thead>
                  <tbody>
                    {attendees.map((a) => (
                      <tr key={a.id} className="print-avoid-break">
                        <td style={td}>{a.name ?? '—'}</td>
                        <td style={td}>{a.isInternal ? COMPANY.name : a.externalOrganization ?? '—'}</td>
                        <td style={td}>{a.designation ?? '—'}</td>
                        <td style={td}>{a.department ?? '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}

              {/* Overview & scope */}
              <Kicker>Overview &amp; Scope</Kicker>
              <p style={{ fontSize: 11, whiteSpace: 'pre-wrap' }}>
                {kickoff.overviewAndScope?.trim() || '—'}
              </p>

              {/* Milestones */}
              <Kicker>Milestones</Kicker>
              {milestones.length === 0 ? (
                <p style={{ fontSize: 10.5, color: MUTED }}>No milestones.</p>
              ) : (
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead>
                    <tr style={{ background: NAVY }}>
                      <th style={th}>Milestone</th>
                      <th style={th}>Target date</th>
                      <th style={th}>Owner</th>
                      <th style={th}>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {milestones.map((m) => (
                      <tr key={m.id} className="print-avoid-break">
                        <td style={td}>{m.name}</td>
                        <td style={td}>{fmtDate(m.targetDate)}</td>
                        <td style={td}>{m.ownerName ?? '—'}</td>
                        <td style={td}>{m.status}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}

              {/* Action items */}
              <Kicker>Action Items</Kicker>
              {actionItems.length === 0 ? (
                <p style={{ fontSize: 10.5, color: MUTED }}>No action items.</p>
              ) : (
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead>
                    <tr style={{ background: NAVY }}>
                      <th style={th}>Description</th>
                      <th style={th}>Owner</th>
                      <th style={th}>Due date</th>
                      <th style={th}>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {actionItems.map((i) => (
                      <tr key={i.id} className="print-avoid-break">
                        <td style={td}>{i.description}</td>
                        <td style={td}>{i.ownerName ?? '—'}</td>
                        <td style={td}>{fmtDate(i.dueDate)}</td>
                        <td style={td}>{ACTION_ITEM_STATUS_LABEL[i.status]}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}

              {/* Risk register */}
              <Kicker>Risk Register</Kicker>
              {risks.length === 0 ? (
                <p style={{ fontSize: 10.5, color: MUTED }}>No risks recorded.</p>
              ) : (
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead>
                    <tr style={{ background: NAVY }}>
                      <th style={th}>Description</th>
                      <th style={th}>Likelihood</th>
                      <th style={th}>Impact</th>
                      <th style={th}>Mitigation</th>
                      <th style={th}>Owner</th>
                      <th style={th}>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {risks.map((r) => (
                      <tr key={r.id} className="print-avoid-break">
                        <td style={td}>{r.description}</td>
                        <td style={td}>{r.likelihood}</td>
                        <td style={td}>{r.impact}</td>
                        <td style={td}>{r.mitigationPlan ?? '—'}</td>
                        <td style={td}>{r.ownerName ?? '—'}</td>
                        <td style={td}>{r.status}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}

              {/* Minutes / notes */}
              {kickoff.minutesNotes?.trim() && (
                <>
                  <Kicker>Minutes &amp; Notes</Kicker>
                  <p style={{ fontSize: 11, whiteSpace: 'pre-wrap' }}>
                    {kickoff.minutesNotes}
                  </p>
                </>
              )}
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}
