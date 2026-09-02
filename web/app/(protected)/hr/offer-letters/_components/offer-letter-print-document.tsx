import { COMPANY } from '../../../../lib/theme';
import type { EmploymentType } from '../../../../lib/types';

type Row = {
  label: string;
  perMonth: string | null;
  perAnnum: string | null;
  emphasize?: boolean;
  note?: string;
};
export type OfferLetterStatus =
  | 'DRAFT'
  | 'PENDING_VERTICAL_APPROVAL'
  | 'PENDING_CEO_APPROVAL'
  | 'APPROVED'
  | 'REJECTED';

export type OfferLetterDocument = {
  id: string;
  referenceNumber: string;
  keyResponsibilities: string;
  kpis: string;
  createdAt: string;
  // The letter's subject, whoever it is. Still called `employee` because that is
  // the shape every stored snapshot uses: for a candidate-anchored letter the
  // server fills it from the application + the letter's own offered terms.
  employee: {
    firstName: string;
    lastName: string;
    gender: string | null;
    designation: string | null;
    employmentType: string | null;
    dateOfJoining: string | null;
    workLocation: string | null;
    territory: string | null;
    vertical: { name: string } | null;
    reportingManager: {
      firstName: string;
      lastName: string;
      designation: string | null;
    } | null;
  };
  compensation: {
    directComponents: Row[];
    employeeDeductions: Row[];
    indirectBenefits: Row[];
    grandTotal: Row;
  };
  // Approval-gate metadata (always present from the API; the print body itself
  // ignores it — it's consumed by the authoring page and the approval inbox).
  status: OfferLetterStatus;
  submittedAt: string | null;
  approverComments: string | null;
  // Two-stage decision trail: the vertical owner's first sign-off, the CEO's
  // final sign-off, and any rejection. Each is null until that step happens.
  verticalApprovedBy: { firstName: string; lastName: string } | null;
  verticalApprovedAt: string | null;
  ceoApprovedBy: { firstName: string; lastName: string } | null;
  ceoApprovedAt: string | null;
  rejectedBy: { firstName: string; lastName: string } | null;
  rejectedAt: string | null;
  // The vertical owner the letter routes to on submit (null → CEO finalises).
  verticalOwner: { firstName: string; lastName: string } | null;
  // The candidate's own answer — orthogonal to `status`, which is only our
  // internal approval ladder. Onboarding requires APPROVED *and* accepted.
  sentAt: string | null;
  acceptedAt: string | null;
  declinedAt: string | null;
  declineReason: string | null;
  // The letter's own copy of the employment terms, so the authoring form can
  // round-trip them. Null on a legacy employee-anchored letter, whose Employee
  // row remains the source of truth.
  offeredDesignation: string | null;
  offeredEmploymentType: EmploymentType | null;
  offeredDateOfJoining: string | null;
  offeredWorkLocation: string | null;
  offeredTerritory: string | null;
  offeredMonthlyCtc: string | null;
  reportsToId: string | null;
  // Exactly one of these anchors the letter: an employee (legacy) or the
  // selected candidate application the offer was made to (the normal path).
  employeeId: string | null;
  candidateApplication?: {
    id: string;
    name: string;
    contact: string;
    status: string;
  } | null;
  candidateRequisition?: {
    id: string;
    requisitionNumber: string;
    positionTitle: string;
  } | null;
};

const ink = '#11343e';
const border = '#ccd5d8';
// Shared house letterhead palette (matches the TCP / confirmation / kickoff
// documents so every outward-facing PDF carries the same branded header).
const NAVY = '#16283b';
const ACCENT = '#e0a83d';
const MUTED = '#6b7280';
const fmt = (value: string | null) =>
  value === null
    ? '—'
    : new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0 }).format(
        Number(value),
      );
const date = (value: string | null) =>
  value
    ? new Intl.DateTimeFormat('en-GB', {
        day: '2-digit',
        month: 'long',
        year: 'numeric',
      }).format(new Date(value))
    : '—';
const lines = (value: string) =>
  value
    .split(/\n+/)
    .map((line) => line.replace(/^[-•*]\s*/, '').trim())
    .filter(Boolean);
// Salutation from the stored free-text gender ('Male'/'Female'/'Others').
// Falls back to the neutral "Mr./Ms." when gender is unknown or non-binary.
const salutation = (gender: string | null) => {
  const g = gender?.trim().toLowerCase();
  if (g === 'male') return 'Mr.';
  if (g === 'female') return 'Ms.';
  return 'Mr./Ms.';
};
const employment = (value: string | null) =>
  value === 'FULL_TIME_PERMANENT'
    ? 'Full-time'
    : value
      ? value.replaceAll('_', ' ').toLowerCase()
      : '—';

// The shared house letterhead: logo (left) + "Get in touch" block (right), a
// navy full-width rule with an amber segment on the left. Uses a plain <img>
// (not next/image) so it paints synchronously before window.print() fires —
// next/image's lazy/optimizer pipeline was leaving the logo blank in the PDF.
function Letterhead() {
  return (
    <>
      <header
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
              style={{ height: 52, width: 'auto', objectFit: 'contain' }}
            />
          ) : (
            <span style={{ fontSize: 22, fontWeight: 800 }}>
              {COMPANY.name}
            </span>
          )}
        </div>
        <div style={{ textAlign: 'right', fontSize: 11, color: MUTED }}>
          <div
            style={{
              fontSize: 9,
              fontWeight: 700,
              letterSpacing: '0.12em',
              textTransform: 'uppercase',
              color: NAVY,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'flex-end',
              gap: 6,
            }}
          >
            <span
              style={{
                width: 8,
                height: 8,
                background: ACCENT,
                display: 'inline-block',
              }}
            />
            Get in touch
          </div>
          <div style={{ marginTop: 3 }}>{COMPANY.contactEmail}</div>
          <div>{COMPANY.website}</div>
        </div>
      </header>
      <div style={{ borderTop: `2px solid ${NAVY}`, position: 'relative' }}>
        <div
          style={{
            position: 'absolute',
            top: -2,
            left: 0,
            width: '14%',
            borderTop: `2px solid ${ACCENT}`,
          }}
        />
      </div>
    </>
  );
}

function Section({
  number,
  title,
  children,
}: {
  number: number;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="mt-6">
      <h2
        className="border-b pb-2 text-[13px] font-bold"
        style={{ color: ink, borderColor: border }}
      >
        {number}. {title}
      </h2>
      <div className="mt-3">{children}</div>
    </section>
  );
}

function SalaryTable({ title, rows }: { title: string; rows: Row[] }) {
  return (
    <section className="mt-5">
      <h3 className="mb-2 font-bold" style={{ color: ink }}>
        {title}
      </h3>
      <table className="w-full border-collapse text-[10px]">
        <thead style={{ background: ink, color: 'white' }}>
          <tr>
            <th className="border p-2 text-left">SL. NO.</th>
            <th className="border p-2 text-left">PARTICULARS</th>
            <th className="border p-2 text-right">PER MONTH (₹)</th>
            <th className="border p-2 text-right">PER ANNUM (₹)</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => (
            <tr
              key={`${row.label}-${index}`}
              className={row.emphasize ? 'font-bold' : ''}
              style={row.emphasize ? { background: '#f1f3f4' } : undefined}
            >
              <td className="border p-2" style={{ borderColor: border }}>
                {index + 1}
              </td>
              <td className="border p-2" style={{ borderColor: border }}>
                {row.label}
              </td>
              <td
                className="border p-2 text-right"
                style={{ borderColor: border }}
              >
                {row.perMonth === null ? (row.note ?? '—') : fmt(row.perMonth)}
              </td>
              <td
                className="border p-2 text-right"
                style={{ borderColor: border }}
              >
                {row.perAnnum === null ? (row.note ?? '—') : fmt(row.perAnnum)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

export function OfferLetterPrintDocument({
  offer,
  preview = false,
}: {
  offer: OfferLetterDocument;
  // `.print-document` is display:none on screen (it only paints under @media
  // print). Pass preview to ALSO render the document visibly on screen — used
  // by the approver's review page, where the document is read, not printed.
  preview?: boolean;
}) {
  const employee = offer.employee;
  const fullName = `${employee.firstName} ${employee.lastName}`;
  const manager = employee.reportingManager
    ? `${employee.reportingManager.firstName} ${employee.reportingManager.lastName}${employee.reportingManager.designation ? `, ${employee.reportingManager.designation}` : ''}`
    : '—';
  const fixedAnnual = offer.compensation.directComponents.at(-1)?.perAnnum;
  const variable = offer.compensation.indirectBenefits.find(
    (row) => row.label === 'Variable Pay',
  )?.perAnnum;
  return (
    <div
      className="print-document bg-white text-[#202020]"
      style={preview ? { display: 'block' } : undefined}
    >
      <div className="text-[11px] leading-[1.55]">
        <Letterhead />
        <div className="mt-5 text-gray-500">
          <div>Date: {date(offer.createdAt)}</div>
          <div>Ref: {offer.referenceNumber}</div>
        </div>
        <h1 className="mt-6 text-[16px] font-bold" style={{ color: ink }}>
          Private &amp; Confidential
        </h1>
        <div className="mt-3 font-serif">
          <strong>
            {salutation(employee.gender)} {fullName}
          </strong>
          <div className="text-gray-500">{employee.workLocation ?? ''}</div>
        </div>
        <p className="mt-6 font-bold" style={{ color: ink }}>
          Subject: Offer of Employment — {employee.designation ?? 'Position'}
        </p>
        <p className="mt-5 font-serif text-[12px]">
          Dear {employee.firstName},
        </p>
        <p className="mt-4 font-serif text-[12px]">
          We are pleased to offer you the position of{' '}
          <strong>{employee.designation}</strong> at {COMPANY.name}. Your
          experience, industry knowledge, and professional achievements
          impressed us throughout our conversations, and we are confident that
          you will play a significant role in strengthening our organization.
        </p>
        <p className="mt-3 font-serif text-[12px]">
          We look forward to welcoming you to our growing team as we build one
          of India&apos;s leading AI infrastructure companies.
        </p>
        <Section number={1} title="Position & Reporting">
          <table className="w-full border-collapse">
            {[
              ['Position', employee.designation],
              ['Department', employee.vertical?.name],
              ['Employing Entity', COMPANY.legalEntityName],
              ['Reports To', manager],
              ['Employment Type', employment(employee.employmentType)],
              ['Place of Posting', employee.workLocation],
              ['Date of Joining', date(employee.dateOfJoining)],
              ['Probation Period', 'Three (3) months'],
            ].map(([label, value]) => (
              <tbody key={label}>
                <tr>
                  <th
                    className="w-1/3 border bg-gray-100 p-2 text-left"
                    style={{ borderColor: border, color: ink }}
                  >
                    {label}
                  </th>
                  <td className="border p-2" style={{ borderColor: border }}>
                    {value ?? '—'}
                  </td>
                </tr>
              </tbody>
            ))}
          </table>
        </Section>
      </div>

      <div className="break-before-page text-[11px] leading-[1.55]">
        <Section number={2} title="About Phaze Dynamics">
          <p className="font-serif text-[12px]">
            Phaze Dynamics is a global digital infrastructure company
            headquartered in Toronto, Canada, with its Global Manufacturing
            &amp; Engineering Center located in Bengaluru, India. The company
            engineers intelligent, modular, and open digital infrastructure
            across six strategic business units:
          </p>
          <ul className="mt-3 list-disc space-y-1 pl-5 font-serif text-[12px]">
            <li>Phaze Edge</li>
            <li>Phaze Infrastructure</li>
            <li>Phaze Compute</li>
            <li>Phaze MOD</li>
            <li>Phaze Intelligence</li>
            <li>Phaze Services</li>
          </ul>
          <p className="mt-3 font-serif text-[12px]">
            Our mission is to engineer the next phase of AI infrastructure by
            delivering innovative solutions for data centers, edge computing,
            open compute, modular data centers, and AI-powered infrastructure
            management.
          </p>
        </Section>
        <Section number={3} title="Compensation">
          <p className="font-serif text-[12px]">
            Your annual Cost to Company (CTC) shall be{' '}
            <strong>₹{fmt(offer.compensation.grandTotal.perAnnum)}</strong> per
            annum, structured as follows:
          </p>
          <table className="mt-3 w-full border-collapse">
            <tbody>
              {[
                ['Fixed Salary', fixedAnnual],
                ['Variable Pay', variable],
                ['Total CTC', offer.compensation.grandTotal.perAnnum],
              ].map(([label, value]) => (
                <tr key={label}>
                  <th
                    className="border bg-gray-100 p-2 text-left"
                    style={{ borderColor: border, color: ink }}
                  >
                    {label}
                  </th>
                  <td className="border p-2" style={{ borderColor: border }}>
                    ₹{fmt(value ?? null)} per annum
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="mt-3 font-serif text-[12px]">
            The detailed component-wise salary structure is set out in{' '}
            <strong>Annexure A — Salary Structure</strong> at the end of this
            letter.
          </p>
        </Section>
        <Section number={4} title="Key Responsibilities">
          <ul className="list-disc space-y-1 pl-5 font-serif text-[12px]">
            {lines(offer.keyResponsibilities).map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        </Section>
      </div>

      <div className="break-before-page text-[11px] leading-[1.55]">
        <Section number={5} title="Key Performance Indicators (KPIs)">
          <p className="mb-3 font-serif text-[12px]">
            Your performance will be evaluated on the basis of, but not limited
            to, the following:
          </p>
          <ul className="list-disc space-y-1 pl-5 font-serif text-[12px]">
            {lines(offer.kpis).map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        </Section>
        <Section number={6} title="Confidentiality">
          <p className="font-serif text-[12px]">
            During your employment, you will have access to confidential
            business information, including customer data, pricing, technical
            documentation, intellectual property, and strategic plans. You agree
            to maintain strict confidentiality over all such information both
            during and after your employment.
          </p>
        </Section>
        <Section number={7} title="Intellectual Property">
          <p className="font-serif text-[12px]">
            All inventions, product concepts, software, documents, designs,
            engineering work, customer databases, and intellectual property
            developed during the course of your employment shall remain the
            exclusive property of {COMPANY.name}.
          </p>
        </Section>
        <Section number={8} title="Code of Conduct">
          <p className="font-serif text-[12px]">
            You are expected to comply with all Company policies, ethical
            standards, anti-bribery guidelines, information security
            requirements, and applicable laws while representing {COMPANY.name}.
          </p>
        </Section>
      </div>

      <div className="break-before-page text-[11px] leading-[1.55]">
        <Section number={9} title="Notice Period">
          <p className="font-serif text-[12px]">
            Either party may terminate this employment by providing sixty (60)
            days&apos; written notice, or salary in lieu thereof, subject to
            Company policy and applicable laws.
          </p>
        </Section>
        <Section number={10} title="Acceptance">
          <p className="font-serif text-[12px]">
            We are delighted to extend this offer and look forward to your
            positive response. Kindly confirm your acceptance by signing and
            returning a copy of this letter on or before your date of joining.
            This offer is contingent upon successful completion of background
            verification and submission of the required documents.
          </p>
        </Section>
        <p className="mt-8 font-serif text-[12px]">Yours sincerely,</p>
        <div className="mt-8 w-52 border-t pt-2" style={{ borderColor: ink }}>
          <strong>Authorized Signatory</strong>
          <div className="text-gray-500">{COMPANY.legalEntityName}</div>
        </div>
        <div
          className="mt-8 rounded border bg-gray-50 p-5"
          style={{ borderColor: border }}
        >
          <strong style={{ color: ink }}>Candidate Acceptance</strong>
          <p className="mt-3 font-serif text-[12px]">
            I, ______________________________, accept the above offer of
            employment and agree to abide by the terms and conditions of
            employment with {COMPANY.name}.
          </p>
          <div className="mt-16 grid grid-cols-3 gap-6 text-gray-500">
            <div className="border-t pt-2">Candidate Signature</div>
            <div className="border-t pt-2">Name</div>
            <div className="border-t pt-2">Date</div>
          </div>
        </div>
      </div>

      <div className="break-before-page text-[11px] leading-[1.45]">
        <h1
          className="border-b pb-3 text-[15px] font-bold"
          style={{ color: ink, borderColor: border }}
        >
          Annexure A — Salary Structure
        </h1>
        <p className="mt-2 text-gray-500">
          {fullName} · {employee.designation}
        </p>
        <SalaryTable
          title="Direct Components"
          rows={offer.compensation.directComponents}
        />
        <SalaryTable
          title="Deductions from Employee Side"
          rows={offer.compensation.employeeDeductions}
        />
        <SalaryTable
          title="Other Indirect Benefits"
          rows={offer.compensation.indirectBenefits}
        />
        <SalaryTable
          title="Grand Total (CTC)"
          rows={[offer.compensation.grandTotal]}
        />
      </div>
    </div>
  );
}
