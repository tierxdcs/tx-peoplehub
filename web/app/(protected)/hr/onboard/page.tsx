'use client';

import { useEffect, useMemo, useState } from 'react';
import { Check, ChevronLeft, ChevronRight, ShieldAlert } from 'lucide-react';
import { apiFetch, ApiError } from '../../../lib/api';
import { Employee, EmploymentType, Vertical } from '../../../lib/types';
import { PageContainer } from '../../../components/ui/page-container';
import { PageHeader } from '../../../components/ui/page-header';
import { Card, CardContent } from '../../../components/ui/card';
import { Button } from '../../../components/ui/button';
import { Input } from '../../../components/ui/input';
import { Select } from '../../../components/ui/select';
import { Field } from '../../../components/ui/field';
import { cn } from '../../../lib/utils';

const EMPLOYMENT_TYPES: { value: EmploymentType; label: string }[] = [
  { value: 'FULL_TIME_PERMANENT', label: 'Full-time (Permanent)' },
  { value: 'CONTRACT', label: 'Contract' },
  { value: 'INTERN', label: 'Intern' },
  { value: 'PART_TIME', label: 'Part-time' },
];

/** The wizard steps, in order. `sensitive` steps get a PII banner. */
const STEPS = [
  { key: 'personal', title: 'Personal', sensitive: false },
  { key: 'employment', title: 'Employment', sensitive: false },
  { key: 'compensation', title: 'Compensation', sensitive: true },
  { key: 'statutory', title: 'Statutory', sensitive: true },
  { key: 'banking', title: 'Banking', sensitive: true },
] as const;

export default function OnboardEmployeePage() {
  const [verticals, setVerticals] = useState<Vertical[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [created, setCreated] = useState<Employee | null>(null);
  const [step, setStep] = useState(0);

  // Personal
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [dateOfBirth, setDateOfBirth] = useState('');
  const [gender, setGender] = useState('');
  const [personalEmail, setPersonalEmail] = useState('');
  const [mobile, setMobile] = useState('');
  const [emergencyContactName, setEmergencyContactName] = useState('');
  const [emergencyContactRelation, setEmergencyContactRelation] = useState('');
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

  // Required fields per step — gate "Next" so a step can't be left incomplete.
  // ESIC is the only optional field; everything else on a step is required.
  const stepComplete = useMemo(() => {
    return [
      // Personal
      !!(
        firstName &&
        lastName &&
        dateOfBirth &&
        gender &&
        personalEmail &&
        mobile &&
        emergencyContactName &&
        emergencyContactRelation &&
        emergencyContactPhone
      ),
      // Employment
      !!(verticalId && designation && employmentType && dateOfJoining && workLocation),
      // Compensation
      !!(basicSalary && hra && effectiveDate),
      // Statutory
      !!(panNumber && aadhaarLast4.length === 4 && pfAccountNumber),
      // Banking
      !!(bankAccountNumber && ifscCode),
    ];
  }, [
    firstName, lastName, dateOfBirth, gender, personalEmail, mobile,
    emergencyContactName, emergencyContactRelation, emergencyContactPhone,
    verticalId, designation, employmentType, dateOfJoining, workLocation,
    basicSalary, hra, effectiveDate,
    panNumber, aadhaarLast4, pfAccountNumber,
    bankAccountNumber, ifscCode,
  ]);

  const isLast = step === STEPS.length - 1;
  const canAdvance = stepComplete[step];
  const allComplete = stepComplete.every(Boolean);

  function goNext() {
    setError(null);
    if (!canAdvance) {
      setError('Please complete all required fields on this step.');
      return;
    }
    if (!isLast) setStep((s) => s + 1);
  }

  function goBack() {
    setError(null);
    setStep((s) => Math.max(0, s - 1));
  }

  async function handleSubmit() {
    setError(null);
    if (!allComplete) {
      setError('Some required fields are missing. Check the earlier steps.');
      return;
    }
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
      <PageContainer className="max-w-xl">
        <PageHeader title="Employee onboarded" />
        <Card>
          <CardContent className="space-y-4 p-6">
            <div className="flex items-center gap-3">
              <span className="flex size-9 items-center justify-center rounded-full bg-success/15 text-success">
                <Check className="size-5" />
              </span>
              <div>
                <div className="font-medium">
                  {created.employeeId} — {created.firstName} {created.lastName}
                </div>
                <div className="text-sm text-muted-foreground">
                  Onboarding complete
                </div>
              </div>
            </div>
            <Field label="Official email (auto-generated)">
              <Input
                value={created.officialEmail ?? ''}
                readOnly
                className="bg-muted"
              />
            </Field>
            <p className="rounded-md bg-primary/5 p-3 text-sm text-muted-foreground">
              Pending ERP access grant from Admin — they cannot log in until an
              Admin grants access.
            </p>
            <Button
              onClick={() => {
                setCreated(null);
                setStep(0);
              }}
            >
              Onboard another
            </Button>
          </CardContent>
        </Card>
      </PageContainer>
    );
  }

  const current = STEPS[step];

  return (
    <PageContainer className="max-w-2xl">
      <PageHeader
        title="Onboard Employee"
        description="Fill each section, then move to the next. Sensitive PII is stored encrypted."
      />

      {/* Stepper — click a completed/earlier step to jump back. */}
      <ol className="mb-6 flex items-center gap-2">
        {STEPS.map((s, i) => {
          const done = i < step && stepComplete[i];
          const active = i === step;
          const reachable = i <= step;
          return (
            <li key={s.key} className="flex flex-1 items-center gap-2">
              <button
                type="button"
                disabled={!reachable}
                onClick={() => reachable && setStep(i)}
                className={cn(
                  'flex items-center gap-2 whitespace-nowrap text-sm',
                  reachable ? 'cursor-pointer' : 'cursor-default',
                )}
              >
                <span
                  className={cn(
                    'flex size-7 shrink-0 items-center justify-center rounded-full border text-xs font-medium',
                    active && 'border-primary bg-primary text-primary-foreground',
                    done && 'border-success bg-success text-white',
                    !active && !done && 'border-muted-foreground/30 text-muted-foreground',
                  )}
                >
                  {done ? <Check className="size-4" /> : i + 1}
                </span>
                <span
                  className={cn(
                    'hidden sm:inline',
                    active ? 'font-medium text-foreground' : 'text-muted-foreground',
                  )}
                >
                  {s.title}
                </span>
              </button>
              {i < STEPS.length - 1 && (
                <span className="h-px flex-1 bg-border" aria-hidden />
              )}
            </li>
          );
        })}
      </ol>

      <Card>
        <CardContent className="p-6">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-lg font-semibold">{current.title}</h2>
            {current.sensitive && (
              <span className="inline-flex items-center gap-1 rounded-full bg-warning/15 px-2 py-0.5 text-xs font-medium text-warning">
                <ShieldAlert className="size-3.5" /> Sensitive — encrypted
              </span>
            )}
          </div>

          {/* Only the current step's fields are mounted → true slide feel. */}
          {step === 0 && (
            <div className="space-y-4">
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="First name">
                  <Input value={firstName} onChange={(e) => setFirstName(e.target.value)} />
                </Field>
                <Field label="Last name">
                  <Input value={lastName} onChange={(e) => setLastName(e.target.value)} />
                </Field>
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Date of birth">
                  <Input type="date" value={dateOfBirth} onChange={(e) => setDateOfBirth(e.target.value)} />
                </Field>
                <Field label="Gender">
                  <Input value={gender} onChange={(e) => setGender(e.target.value)} />
                </Field>
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Personal email">
                  <Input type="email" value={personalEmail} onChange={(e) => setPersonalEmail(e.target.value)} />
                </Field>
                <Field label="Mobile">
                  <Input value={mobile} onChange={(e) => setMobile(e.target.value)} />
                </Field>
              </div>
              <div className="grid gap-4 sm:grid-cols-3">
                <Field label="Emergency contact name">
                  <Input value={emergencyContactName} onChange={(e) => setEmergencyContactName(e.target.value)} />
                </Field>
                <Field label="Relation">
                  <Input value={emergencyContactRelation} onChange={(e) => setEmergencyContactRelation(e.target.value)} />
                </Field>
                <Field label="Phone">
                  <Input value={emergencyContactPhone} onChange={(e) => setEmergencyContactPhone(e.target.value)} />
                </Field>
              </div>
            </div>
          )}

          {step === 1 && (
            <div className="space-y-4">
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Vertical">
                  <Select value={verticalId} onChange={(e) => setVerticalId(e.target.value)}>
                    <option value="">Select a vertical…</option>
                    {verticals.map((v) => (
                      <option key={v.id} value={v.id}>{v.name}</option>
                    ))}
                  </Select>
                </Field>
                <Field label="Designation">
                  <Input value={designation} onChange={(e) => setDesignation(e.target.value)} placeholder="e.g. Senior Design Engineer" />
                </Field>
              </div>
              <div className="grid gap-4 sm:grid-cols-3">
                <Field label="Employment type">
                  <Select value={employmentType} onChange={(e) => setEmploymentType(e.target.value as EmploymentType)}>
                    {EMPLOYMENT_TYPES.map((t) => (
                      <option key={t.value} value={t.value}>{t.label}</option>
                    ))}
                  </Select>
                </Field>
                <Field label="Date of joining">
                  <Input type="date" value={dateOfJoining} onChange={(e) => setDateOfJoining(e.target.value)} />
                </Field>
                <Field label="Work location">
                  <Input value={workLocation} onChange={(e) => setWorkLocation(e.target.value)} placeholder="e.g. Bengaluru" />
                </Field>
              </div>
            </div>
          )}

          {step === 2 && (
            <div className="grid gap-4 sm:grid-cols-3">
              <Field label="Basic salary">
                <Input type="number" min={0} value={basicSalary} onChange={(e) => setBasicSalary(e.target.value)} />
              </Field>
              <Field label="HRA">
                <Input type="number" min={0} value={hra} onChange={(e) => setHra(e.target.value)} />
              </Field>
              <Field label="Effective date">
                <Input type="date" value={effectiveDate} onChange={(e) => setEffectiveDate(e.target.value)} />
              </Field>
            </div>
          )}

          {step === 3 && (
            <div className="space-y-4">
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="PAN number">
                  <Input value={panNumber} onChange={(e) => setPanNumber(e.target.value.toUpperCase())} />
                </Field>
                <Field label="Aadhaar — last 4 digits only">
                  <Input
                    value={aadhaarLast4}
                    onChange={(e) => setAadhaarLast4(e.target.value.replace(/\D/g, '').slice(0, 4))}
                    maxLength={4}
                    inputMode="numeric"
                  />
                </Field>
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="PF account number">
                  <Input value={pfAccountNumber} onChange={(e) => setPfAccountNumber(e.target.value)} />
                </Field>
                <Field label="ESIC number (optional)">
                  <Input value={esicNumber} onChange={(e) => setEsicNumber(e.target.value)} />
                </Field>
              </div>
            </div>
          )}

          {step === 4 && (
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Bank account number">
                <Input value={bankAccountNumber} onChange={(e) => setBankAccountNumber(e.target.value)} />
              </Field>
              <Field label="IFSC code">
                <Input value={ifscCode} onChange={(e) => setIfscCode(e.target.value.toUpperCase())} />
              </Field>
            </div>
          )}

          {error && <p className="mt-4 text-sm text-destructive">{error}</p>}

          {/* Navigation */}
          <div className="mt-6 flex items-center justify-between border-t pt-4">
            <Button variant="outline" onClick={goBack} disabled={step === 0}>
              <ChevronLeft className="size-4" /> Back
            </Button>
            <span className="text-xs text-muted-foreground">
              Step {step + 1} of {STEPS.length}
            </span>
            {isLast ? (
              <Button onClick={handleSubmit} disabled={submitting || !allComplete}>
                {submitting ? 'Submitting…' : 'Onboard Employee'}
              </Button>
            ) : (
              <Button onClick={goNext} disabled={!canAdvance}>
                Next <ChevronRight className="size-4" />
              </Button>
            )}
          </div>
        </CardContent>
      </Card>
    </PageContainer>
  );
}
