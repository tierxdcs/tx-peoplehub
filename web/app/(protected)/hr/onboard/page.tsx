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
import { EmployeePhotoField } from '../../../components/ui/employee-photo-field';
import { formatINR } from '../../../lib/sales';
import { useNumberFormat } from '../../../lib/number-format-context';
import { cn } from '../../../lib/utils';

const EMPLOYMENT_TYPES: { value: EmploymentType; label: string }[] = [
  { value: 'FULL_TIME_PERMANENT', label: 'Full-time (Permanent)' },
  { value: 'CONTRACT', label: 'Contract' },
  { value: 'INTERN', label: 'Intern' },
  { value: 'PART_TIME', label: 'Part-time' },
];

/** Constrained to a fixed list to avoid free-text entry errors. */
const GENDERS = ['Male', 'Female', 'Others'];

/** Emergency-contact relations, constrained to reduce free-text errors. */
const RELATIONS = [
  'Spouse',
  'Parent',
  'Sibling',
  'Child',
  'Relative',
  'Friend',
  'Guardian',
  'Other',
];

/** Company work locations — constrained to the actual units to avoid free-text errors. */
const WORK_LOCATIONS = ['Unit 1 - Peenya', 'Unit 2 - Dabaspet', 'Hybrid'];

const OFFICIAL_EMAIL_DOMAIN = 'phaze-dynamics.com';

type OnboardingRequisitionOption = {
  id: string;
  requisitionNumber: string;
  offerReferenceNumber: string | null;
  hasApprovedOffer: boolean;
  selectedCandidateName: string;
  designation: string | null;
  employmentType: EmploymentType | null;
  vertical: { id: string; name: string } | null;
  dateOfJoining: string | null;
  workLocation: string | null;
  territory: string | null;
  compensation: {
    basicSalary: string | null;
    hra: string | null;
    specialAllowance: string | null;
    variablePay: string | null;
    effectiveDate: string | null;
  } | null;
};

function suggestedOfficialEmail(firstName: string, lastName: string) {
  const normalize = (value: string) =>
    value.toLowerCase().replace(/[^a-z0-9]/g, '');
  const first = normalize(firstName);
  const last = normalize(lastName);
  return first && last ? `${first}.${last}@${OFFICIAL_EMAIL_DOMAIN}` : '';
}

/** The wizard steps, in order. `sensitive` steps get a PII banner. */
const STEPS = [
  { key: 'personal', title: 'Personal', sensitive: false },
  { key: 'employment', title: 'Employment', sensitive: false },
  { key: 'compensation', title: 'Compensation', sensitive: true },
  { key: 'statutory', title: 'Statutory', sensitive: true },
  { key: 'banking', title: 'Banking', sensitive: true },
] as const;

export default function OnboardEmployeePage() {
  const { style: numberFormatStyle } = useNumberFormat();
  const [verticals, setVerticals] = useState<Vertical[]>([]);
  const [requisitionOptions, setRequisitionOptions] = useState<
    OnboardingRequisitionOption[]
  >([]);
  const [candidateRequisitionId, setCandidateRequisitionId] = useState('');
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
  // Optional employee photo — uploaded to R2 up front; only the returned
  // storageKey is sent with the onboarding payload.
  const [photoStorageKey, setPhotoStorageKey] = useState('');

  // Employment
  const [verticalId, setVerticalId] = useState('');
  const [designation, setDesignation] = useState('');
  const [employmentType, setEmploymentType] = useState<EmploymentType>(
    'FULL_TIME_PERMANENT',
  );
  const [dateOfJoining, setDateOfJoining] = useState('');
  const [workLocation, setWorkLocation] = useState('');
  const [territory, setTerritory] = useState('');
  const [officialEmail, setOfficialEmail] = useState('');
  const [officialEmailEdited, setOfficialEmailEdited] = useState(false);

  const displayedOfficialEmail = officialEmailEdited
    ? officialEmail
    : suggestedOfficialEmail(firstName, lastName);

  // Compensation. basic/hra/specialAllowance are MONTHLY; variablePay is
  // ANNUAL (an indirect CTC component the payroll engine never reads).
  const [basicSalary, setBasicSalary] = useState('');
  const [hra, setHra] = useState('');
  const [specialAllowance, setSpecialAllowance] = useState('');
  const [variablePay, setVariablePay] = useState('');
  const [effectiveDate, setEffectiveDate] = useState('');

  // Live earning-side CTC preview. Statutory deductions (PF/ESI/PT/TDS and
  // employer contributions) are deliberately NOT shown here — those are
  // computed at payroll-run time from StatutoryConfig, never at onboarding.
  const monthlyGross =
    (Number(basicSalary) || 0) +
    (Number(hra) || 0) +
    (Number(specialAllowance) || 0);
  const annualCtc = monthlyGross * 12 + (Number(variablePay) || 0);

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
    apiFetch<OnboardingRequisitionOption[]>(
      '/candidate-requisitions/onboarding-options',
    )
      .then(setRequisitionOptions)
      .catch(() => setError('Failed to load approved hiring requisitions'));
  }, []);

  function selectRequisition(id: string) {
    setCandidateRequisitionId(id);
    if (!id) return;
    const option = requisitionOptions.find((item) => item.id === id);
    if (!option) return;

    const [candidateFirstName = '', ...candidateLastNameParts] =
      option.selectedCandidateName.trim().split(/\s+/);
    setFirstName(candidateFirstName);
    setLastName(candidateLastNameParts.join(' '));

    // Never carry terms from a previously selected requisition. A fulfilled
    // requisition without an approved Offer Letter is still eligible, but only
    // its confirmed candidate name is safe to prefill.
    setDesignation('');
    setEmploymentType('FULL_TIME_PERMANENT');
    setVerticalId('');
    setDateOfJoining('');
    setWorkLocation('');
    setTerritory('');
    setBasicSalary('');
    setHra('');
    setSpecialAllowance('');
    setVariablePay('');
    setEffectiveDate('');

    if (!option.hasApprovedOffer) {
      setError(null);
      return;
    }
    setDesignation(option.designation ?? '');
    setEmploymentType(option.employmentType ?? 'FULL_TIME_PERMANENT');
    setVerticalId(option.vertical?.id ?? '');
    if (option.dateOfJoining)
      setDateOfJoining(option.dateOfJoining.slice(0, 10));
    if (option.workLocation) setWorkLocation(option.workLocation);
    if (option.territory) setTerritory(option.territory);
    setBasicSalary(option.compensation?.basicSalary ?? '');
    setHra(option.compensation?.hra ?? '');
    setSpecialAllowance(option.compensation?.specialAllowance ?? '');
    setVariablePay(option.compensation?.variablePay ?? '');
    if (option.compensation?.effectiveDate) {
      setEffectiveDate(option.compensation.effectiveDate.slice(0, 10));
    }
    setError(null);
  }

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
      !!(
        verticalId &&
        designation &&
        employmentType &&
        dateOfJoining &&
        workLocation &&
        displayedOfficialEmail
      ),
      // Compensation
      !!(basicSalary && hra && effectiveDate),
      // Statutory
      !!(panNumber && aadhaarLast4.length === 4 && pfAccountNumber),
      // Banking
      !!(bankAccountNumber && ifscCode),
    ];
  }, [
    firstName,
    lastName,
    dateOfBirth,
    gender,
    personalEmail,
    mobile,
    emergencyContactName,
    emergencyContactRelation,
    emergencyContactPhone,
    verticalId,
    designation,
    employmentType,
    dateOfJoining,
    workLocation,
    displayedOfficialEmail,
    basicSalary,
    hra,
    effectiveDate,
    panNumber,
    aadhaarLast4,
    pfAccountNumber,
    bankAccountNumber,
    ifscCode,
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
          ...(candidateRequisitionId ? { candidateRequisitionId } : {}),
          firstName,
          lastName,
          ...(officialEmailEdited
            ? { officialEmail: officialEmail.trim().toLowerCase() }
            : {}),
          dateOfBirth,
          gender,
          personalEmail,
          mobile,
          designation,
          employmentType,
          dateOfJoining,
          workLocation,
          ...(territory.trim() ? { territory: territory.trim() } : {}),
          verticalId,
          emergencyContactName,
          emergencyContactRelation,
          emergencyContactPhone,
          ...(photoStorageKey ? { photoStorageKey } : {}),
          compensation: {
            basicSalary: Number(basicSalary),
            hra: Number(hra),
            ...(specialAllowance
              ? { specialAllowance: Number(specialAllowance) }
              : {}),
            ...(variablePay ? { variablePay: Number(variablePay) } : {}),
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
      if (candidateRequisitionId) {
        setRequisitionOptions((options) =>
          options.filter((option) => option.id !== candidateRequisitionId),
        );
      }
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
            <Field label="Official email">
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
                setCandidateRequisitionId('');
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

      <Card className="mb-6">
        <CardContent className="p-6">
          <Field label="Link to a Candidate Requisition (optional)">
            <Select
              value={candidateRequisitionId}
              onChange={(event) => selectRequisition(event.target.value)}
            >
              <option value="">No requisition — exception onboarding</option>
              {requisitionOptions.map((option) => (
                <option key={option.id} value={option.id}>
                  {option.requisitionNumber} — {option.selectedCandidateName} —{' '}
                  {option.designation ?? 'Terms to be entered'}
                </option>
              ))}
            </Select>
            <p className="mt-2 text-xs text-muted-foreground">
              Approved and Fulfilled requisitions appear. The confirmed
              candidate name is always filled; approved Offer Letter terms are
              added when available. Every field remains editable for HR review.
            </p>
          </Field>
        </CardContent>
      </Card>

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
                    active &&
                      'border-primary bg-primary text-primary-foreground',
                    done && 'border-success bg-success text-success-foreground',
                    !active &&
                      !done &&
                      'border-muted-foreground/30 text-muted-foreground',
                  )}
                >
                  {done ? <Check className="size-4" /> : i + 1}
                </span>
                <span
                  className={cn(
                    'hidden sm:inline',
                    active
                      ? 'font-medium text-foreground'
                      : 'text-muted-foreground',
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
              <Field label="Photo (optional)">
                <EmployeePhotoField
                  onUploaded={(key) => setPhotoStorageKey(key)}
                  onRemove={
                    photoStorageKey ? () => setPhotoStorageKey('') : undefined
                  }
                />
              </Field>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="First name">
                  <Input
                    value={firstName}
                    onChange={(e) => setFirstName(e.target.value)}
                  />
                </Field>
                <Field label="Last name">
                  <Input
                    value={lastName}
                    onChange={(e) => setLastName(e.target.value)}
                  />
                </Field>
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Date of birth">
                  <Input
                    type="date"
                    value={dateOfBirth}
                    onChange={(e) => setDateOfBirth(e.target.value)}
                  />
                </Field>
                <Field label="Gender">
                  <Select
                    value={gender}
                    onChange={(e) => setGender(e.target.value)}
                  >
                    <option value="">Select a gender…</option>
                    {GENDERS.map((g) => (
                      <option key={g} value={g}>
                        {g}
                      </option>
                    ))}
                  </Select>
                </Field>
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Personal email">
                  <Input
                    type="email"
                    value={personalEmail}
                    onChange={(e) => setPersonalEmail(e.target.value)}
                  />
                </Field>
                <Field label="Mobile">
                  <Input
                    value={mobile}
                    onChange={(e) => setMobile(e.target.value)}
                  />
                </Field>
              </div>
              <div className="grid gap-4 sm:grid-cols-3">
                <Field label="Emergency contact name">
                  <Input
                    value={emergencyContactName}
                    onChange={(e) => setEmergencyContactName(e.target.value)}
                  />
                </Field>
                <Field label="Relation">
                  <Select
                    value={emergencyContactRelation}
                    onChange={(e) =>
                      setEmergencyContactRelation(e.target.value)
                    }
                  >
                    <option value="">Select a relation…</option>
                    {RELATIONS.map((r) => (
                      <option key={r} value={r}>
                        {r}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field label="Phone">
                  <Input
                    value={emergencyContactPhone}
                    onChange={(e) => setEmergencyContactPhone(e.target.value)}
                  />
                </Field>
              </div>
              <Field label="Territory (optional)">
                <Input
                  value={territory}
                  onChange={(e) => setTerritory(e.target.value)}
                  placeholder="e.g. South India"
                />
              </Field>
            </div>
          )}

          {step === 1 && (
            <div className="space-y-4">
              <Field label="Official email">
                <Input
                  type="email"
                  required
                  value={displayedOfficialEmail}
                  onChange={(e) => {
                    setOfficialEmailEdited(true);
                    setOfficialEmail(e.target.value);
                  }}
                  placeholder={`firstname.lastname@${OFFICIAL_EMAIL_DOMAIN}`}
                />
                <p className="mt-1 text-xs text-muted-foreground">
                  Suggested automatically from the employee name. HR can edit it
                  before onboarding.
                </p>
              </Field>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Vertical">
                  <Select
                    value={verticalId}
                    onChange={(e) => setVerticalId(e.target.value)}
                  >
                    <option value="">Select a vertical…</option>
                    {verticals.map((v) => (
                      <option key={v.id} value={v.id}>
                        {v.name}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field label="Designation">
                  <Input
                    value={designation}
                    onChange={(e) => setDesignation(e.target.value)}
                    placeholder="e.g. Senior Design Engineer"
                  />
                </Field>
              </div>
              <div className="grid gap-4 sm:grid-cols-3">
                <Field label="Employment type">
                  <Select
                    value={employmentType}
                    onChange={(e) =>
                      setEmploymentType(e.target.value as EmploymentType)
                    }
                  >
                    {EMPLOYMENT_TYPES.map((t) => (
                      <option key={t.value} value={t.value}>
                        {t.label}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field label="Date of joining">
                  <Input
                    type="date"
                    value={dateOfJoining}
                    onChange={(e) => setDateOfJoining(e.target.value)}
                  />
                </Field>
                <Field label="Work location">
                  <Select
                    value={workLocation}
                    onChange={(e) => setWorkLocation(e.target.value)}
                  >
                    <option value="">Select a work location…</option>
                    {WORK_LOCATIONS.map((w) => (
                      <option key={w} value={w}>
                        {w}
                      </option>
                    ))}
                  </Select>
                </Field>
              </div>
            </div>
          )}

          {step === 2 && (
            <div className="space-y-4">
              <div className="grid gap-4 sm:grid-cols-3">
                <Field label="Basic salary" hint="Per month">
                  <Input
                    type="number"
                    min={0}
                    value={basicSalary}
                    onChange={(e) => setBasicSalary(e.target.value)}
                  />
                </Field>
                <Field label="HRA" hint="Per month">
                  <Input
                    type="number"
                    min={0}
                    value={hra}
                    onChange={(e) => setHra(e.target.value)}
                  />
                </Field>
                <Field label="Special allowance" hint="Per month (optional)">
                  <Input
                    type="number"
                    min={0}
                    value={specialAllowance}
                    onChange={(e) => setSpecialAllowance(e.target.value)}
                  />
                </Field>
                <Field label="Variable pay" hint="Per year (optional)">
                  <Input
                    type="number"
                    min={0}
                    value={variablePay}
                    onChange={(e) => setVariablePay(e.target.value)}
                  />
                </Field>
                <Field label="Effective date">
                  <Input
                    type="date"
                    value={effectiveDate}
                    onChange={(e) => setEffectiveDate(e.target.value)}
                  />
                </Field>
              </div>

              {/* Earning-side CTC preview. Statutory deductions (PF/ESI/PT/TDS
                  + employer contributions) are computed at payroll-run time
                  from StatutoryConfig — never fabricated here — so they are
                  intentionally omitted. */}
              <div className="rounded-md border bg-muted/40 p-4">
                <div className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  CTC preview (earning components)
                </div>
                <dl className="grid grid-cols-2 gap-x-8 gap-y-2 text-sm sm:grid-cols-3">
                  <div className="flex justify-between sm:block">
                    <dt className="text-muted-foreground">Monthly gross</dt>
                    <dd className="font-medium">
                      {formatINR(monthlyGross, numberFormatStyle)}
                    </dd>
                  </div>
                  <div className="flex justify-between sm:block">
                    <dt className="text-muted-foreground">
                      Annual variable pay
                    </dt>
                    <dd className="font-medium">
                      {formatINR(Number(variablePay) || 0, numberFormatStyle)}
                    </dd>
                  </div>
                  <div className="flex justify-between sm:block">
                    <dt className="text-muted-foreground">Annual CTC</dt>
                    <dd className="text-base font-semibold">
                      {formatINR(annualCtc, numberFormatStyle)}
                    </dd>
                  </div>
                </dl>
                <p className="mt-3 text-xs text-muted-foreground">
                  Statutory deductions (PF, ESI, Professional Tax, TDS) and
                  employer contributions are calculated during payroll
                  processing from the configured statutory rates — they are not
                  set at onboarding.
                </p>
              </div>
            </div>
          )}

          {step === 3 && (
            <div className="space-y-4">
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="PAN number">
                  <Input
                    value={panNumber}
                    onChange={(e) => setPanNumber(e.target.value.toUpperCase())}
                  />
                </Field>
                <Field label="Aadhaar — last 4 digits only">
                  <Input
                    value={aadhaarLast4}
                    onChange={(e) =>
                      setAadhaarLast4(
                        e.target.value.replace(/\D/g, '').slice(0, 4),
                      )
                    }
                    maxLength={4}
                    inputMode="numeric"
                  />
                </Field>
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="PF account number">
                  <Input
                    value={pfAccountNumber}
                    onChange={(e) => setPfAccountNumber(e.target.value)}
                  />
                </Field>
                <Field label="ESIC number (optional)">
                  <Input
                    value={esicNumber}
                    onChange={(e) => setEsicNumber(e.target.value)}
                  />
                </Field>
              </div>
            </div>
          )}

          {step === 4 && (
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Bank account number">
                <Input
                  value={bankAccountNumber}
                  onChange={(e) => setBankAccountNumber(e.target.value)}
                />
              </Field>
              <Field label="IFSC code">
                <Input
                  value={ifscCode}
                  onChange={(e) => setIfscCode(e.target.value.toUpperCase())}
                />
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
              <Button
                onClick={handleSubmit}
                disabled={submitting || !allComplete}
              >
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
