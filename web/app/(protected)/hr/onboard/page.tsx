'use client';

import { useEffect, useState } from 'react';
import { apiFetch, ApiError } from '../../../lib/api';
import { Employee, EmploymentType, Vertical } from '../../../lib/types';

const EMPLOYMENT_TYPES: EmploymentType[] = [
  'FULL_TIME_PERMANENT',
  'CONTRACT',
  'INTERN',
  'PART_TIME',
];

const fieldStyle: React.CSSProperties = {
  width: '100%',
  padding: 8,
  boxSizing: 'border-box',
};

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div style={{ marginBottom: 12 }}>
      <label style={{ display: 'block', marginBottom: 4 }}>{label}</label>
      {children}
    </div>
  );
}

function Section({
  title,
  sensitive,
  children,
}: {
  title: string;
  sensitive?: boolean;
  children: React.ReactNode;
}) {
  return (
    <fieldset
      style={{
        border: sensitive ? '1px solid #d9822b' : '1px solid #ddd',
        borderRadius: 4,
        padding: 16,
        marginBottom: 20,
      }}
    >
      <legend style={{ fontWeight: 'bold' }}>
        {title}
        {sensitive && (
          <span
            style={{
              marginLeft: 8,
              fontSize: 11,
              fontWeight: 'normal',
              color: '#d9822b',
              border: '1px solid #d9822b',
              borderRadius: 3,
              padding: '1px 6px',
            }}
          >
            SENSITIVE
          </span>
        )}
      </legend>
      {children}
    </fieldset>
  );
}

export default function OnboardEmployeePage() {
  const [verticals, setVerticals] = useState<Vertical[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [created, setCreated] = useState<Employee | null>(null);

  // Personal
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [dateOfBirth, setDateOfBirth] = useState('');
  const [gender, setGender] = useState('');
  const [personalEmail, setPersonalEmail] = useState('');
  const [mobile, setMobile] = useState('');
  const [emergencyContactName, setEmergencyContactName] = useState('');
  const [emergencyContactRelation, setEmergencyContactRelation] =
    useState('');
  const [emergencyContactPhone, setEmergencyContactPhone] = useState('');

  // Employment
  const [verticalId, setVerticalId] = useState('');
  const [designation, setDesignation] = useState('');
  const [employmentType, setEmploymentType] =
    useState<EmploymentType>('FULL_TIME_PERMANENT');
  const [dateOfJoining, setDateOfJoining] = useState('');
  const [workLocation, setWorkLocation] = useState('');

  // Compensation
  const [basicSalary, setBasicSalary] = useState('');
  const [hra, setHra] = useState('');
  const [effectiveDate, setEffectiveDate] = useState('');

  // Statutory
  const [panNumber, setPanNumber] = useState('');
  const [aadhaarLast4, setAadhaarLast4] = useState('');
  const [pfAccountNumber, setPfAccountNumber] = useState('');
  const [esicNumber, setEsicNumber] = useState('');

  // Banking
  const [bankAccountNumber, setBankAccountNumber] = useState('');
  const [ifscCode, setIfscCode] = useState('');

  useEffect(() => {
    apiFetch<Vertical[]>('/verticals').then(setVerticals);
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const employee = await apiFetch<Employee>('/employees/onboard', {
        method: 'POST',
        body: JSON.stringify({
          firstName,
          lastName,
          dateOfBirth,
          gender,
          personalEmail,
          mobile,
          designation,
          employmentType,
          dateOfJoining,
          workLocation,
          verticalId,
          emergencyContactName,
          emergencyContactRelation,
          emergencyContactPhone,
          compensation: {
            basicSalary: Number(basicSalary),
            hra: Number(hra),
            effectiveDate,
          },
          statutoryInfo: {
            panNumber,
            aadhaarLast4,
            pfAccountNumber,
            ...(esicNumber ? { esicNumber } : {}),
          },
          bankDetails: { bankAccountNumber, ifscCode },
        }),
      });
      setCreated(employee);
    } catch (err) {
      setError(
        err instanceof ApiError ? err.message : 'Failed to onboard employee',
      );
    } finally {
      setSubmitting(false);
    }
  }

  if (created) {
    return (
      <div style={{ maxWidth: 560 }}>
        <h1>Employee onboarded</h1>
        <p>
          <strong>{created.employeeId}</strong> — {created.firstName}{' '}
          {created.lastName}
        </p>
        <Field label="Official email (auto-generated)">
          <input
            value={created.officialEmail ?? ''}
            readOnly
            style={{ ...fieldStyle, background: '#f5f5f5' }}
          />
        </Field>
        <p style={{ padding: 12, background: '#eef6ff', borderRadius: 4 }}>
          Employee onboarded — pending ERP access grant from Admin. They
          cannot log in until an Admin grants access.
        </p>
        <button onClick={() => setCreated(null)}>Onboard another</button>
      </div>
    );
  }

  return (
    <div style={{ maxWidth: 560 }}>
      <h1>Onboard Employee</h1>
      <form onSubmit={handleSubmit}>
        <Section title="Personal">
          <Field label="First name">
            <input
              value={firstName}
              onChange={(e) => setFirstName(e.target.value)}
              required
              style={fieldStyle}
            />
          </Field>
          <Field label="Last name">
            <input
              value={lastName}
              onChange={(e) => setLastName(e.target.value)}
              required
              style={fieldStyle}
            />
          </Field>
          <Field label="Date of birth">
            <input
              type="date"
              value={dateOfBirth}
              onChange={(e) => setDateOfBirth(e.target.value)}
              required
              style={fieldStyle}
            />
          </Field>
          <Field label="Gender">
            <input
              value={gender}
              onChange={(e) => setGender(e.target.value)}
              required
              style={fieldStyle}
            />
          </Field>
          <Field label="Personal email">
            <input
              type="email"
              value={personalEmail}
              onChange={(e) => setPersonalEmail(e.target.value)}
              required
              style={fieldStyle}
            />
          </Field>
          <Field label="Mobile">
            <input
              value={mobile}
              onChange={(e) => setMobile(e.target.value)}
              required
              style={fieldStyle}
            />
          </Field>
          <Field label="Emergency contact name">
            <input
              value={emergencyContactName}
              onChange={(e) => setEmergencyContactName(e.target.value)}
              required
              style={fieldStyle}
            />
          </Field>
          <Field label="Emergency contact relation">
            <input
              value={emergencyContactRelation}
              onChange={(e) => setEmergencyContactRelation(e.target.value)}
              required
              style={fieldStyle}
            />
          </Field>
          <Field label="Emergency contact phone">
            <input
              value={emergencyContactPhone}
              onChange={(e) => setEmergencyContactPhone(e.target.value)}
              required
              style={fieldStyle}
            />
          </Field>
        </Section>

        <Section title="Employment">
          <Field label="Vertical">
            <select
              value={verticalId}
              onChange={(e) => setVerticalId(e.target.value)}
              required
              style={fieldStyle}
            >
              <option value="">Select a vertical…</option>
              {verticals.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Designation">
            <input
              value={designation}
              onChange={(e) => setDesignation(e.target.value)}
              required
              style={fieldStyle}
            />
          </Field>
          <Field label="Employment type">
            <select
              value={employmentType}
              onChange={(e) =>
                setEmploymentType(e.target.value as EmploymentType)
              }
              style={fieldStyle}
            >
              {EMPLOYMENT_TYPES.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Date of joining">
            <input
              type="date"
              value={dateOfJoining}
              onChange={(e) => setDateOfJoining(e.target.value)}
              required
              style={fieldStyle}
            />
          </Field>
          <Field label="Work location">
            <input
              value={workLocation}
              onChange={(e) => setWorkLocation(e.target.value)}
              required
              style={fieldStyle}
            />
          </Field>
        </Section>

        <Section title="Compensation" sensitive>
          <Field label="Basic salary">
            <input
              type="number"
              min={0}
              value={basicSalary}
              onChange={(e) => setBasicSalary(e.target.value)}
              required
              style={fieldStyle}
            />
          </Field>
          <Field label="HRA">
            <input
              type="number"
              min={0}
              value={hra}
              onChange={(e) => setHra(e.target.value)}
              required
              style={fieldStyle}
            />
          </Field>
          <Field label="Effective date">
            <input
              type="date"
              value={effectiveDate}
              onChange={(e) => setEffectiveDate(e.target.value)}
              required
              style={fieldStyle}
            />
          </Field>
        </Section>

        <Section title="Statutory" sensitive>
          <Field label="PAN number">
            <input
              value={panNumber}
              onChange={(e) => setPanNumber(e.target.value)}
              required
              style={fieldStyle}
            />
          </Field>
          <Field label="Aadhaar — last 4 digits only">
            <input
              value={aadhaarLast4}
              onChange={(e) =>
                setAadhaarLast4(e.target.value.replace(/\D/g, '').slice(0, 4))
              }
              maxLength={4}
              inputMode="numeric"
              required
              style={fieldStyle}
            />
          </Field>
          <Field label="PF account number">
            <input
              value={pfAccountNumber}
              onChange={(e) => setPfAccountNumber(e.target.value)}
              required
              style={fieldStyle}
            />
          </Field>
          <Field label="ESIC number (optional)">
            <input
              value={esicNumber}
              onChange={(e) => setEsicNumber(e.target.value)}
              style={fieldStyle}
            />
          </Field>
        </Section>

        <Section title="Banking" sensitive>
          <Field label="Bank account number">
            <input
              value={bankAccountNumber}
              onChange={(e) => setBankAccountNumber(e.target.value)}
              required
              style={fieldStyle}
            />
          </Field>
          <Field label="IFSC code">
            <input
              value={ifscCode}
              onChange={(e) => setIfscCode(e.target.value)}
              required
              style={fieldStyle}
            />
          </Field>
        </Section>

        {error && <p style={{ color: 'crimson' }}>{error}</p>}

        <button type="submit" disabled={submitting} style={{ padding: 8 }}>
          {submitting ? 'Submitting…' : 'Onboard Employee'}
        </button>
      </form>
    </div>
  );
}
