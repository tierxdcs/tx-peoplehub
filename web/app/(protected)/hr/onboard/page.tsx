'use client';

import { useEffect, useMemo, useState } from 'react';
import { Check, ChevronLeft, ChevronRight, ShieldAlert } from 'lucide-react';
import { apiFetch, ApiError } from '../../../lib/api';
import { Employee, EmploymentType, Vertical } from '../../../lib/types';
import {
  Callout,
  SCard,
  SCardTitle,
  SIGNAL_EYEBROW,
  SIGNAL_HAIRLINE,
  SIGNAL_MUTED,
  SIGNAL_ROW_DIVIDER,
  SignalHeader,
  SignalPage,
  ToneChip,
} from '../../../components/ui/signal';
import { Button } from '../../../components/ui/button';
import { Input } from '../../../components/ui/input';
import { Select } from '../../../components/ui/select';
import { Field } from '../../../components/ui/field';
import { EmployeePhotoField } from '../../../components/ui/employee-photo-field';
import { formatINR } from '../../../lib/sales';
import { useNumberFormat } from '../../../lib/number-format-context';
import type { NumberFormatStyle } from '../../../lib/number-format-context';
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

/**
 * A requisition that is ready to onboard against: approved, nobody onboarded on
 * it yet, and carrying an approved offer letter the candidate has ACCEPTED. The
 * acceptance is the gate — the server refuses an onboarding without one — so
 * every option here has offer terms behind it.
 */
type OnboardingRequisitionOption = {
  id: string;
  requisitionNumber: string;
  offerLetterId: string | null;
  offerReferenceNumber: string | null;
  hasApprovedOffer: boolean;
  offerAcceptedAt: string | null;
  candidateApplicationId: string | null;
  selectedCandidateName: string;
  designation: string | null;
  employmentType: EmploymentType | null;
  vertical: { id: string; name: string } | null;
  dateOfJoining: string | null;
  workLocation: string | null;
  territory: string | null;
  compensation: {
    monthlyCtc: string | null;
    basicSalary: string | null;
    hra: string | null;
    specialAllowance: string | null;
    variablePay: string | null;
    effectiveDate: string | null;
  } | null;
};

type CompensationPreview = {
  branch: 'PF_CAPPED' | 'PF_UNCAPPED';
  monthlyCtc: string;
  annualCtc: string;
  grossMonthly: string;
  basicMonthly: string;
  hraMonthly: string;
  conveyanceMonthly: string;
  otherAllowanceMonthly: string;
  professionalTaxMonthly: string;
  employeePfMonthly: string;
  employeeEsiMonthly: string | null;
  employerPfMonthly: string;
  employerEsiMonthly: string | null;
  totalDeductionsMonthly: string;
  netSalaryMonthly: string;
  totalAnnualisedSalary: string;
  insuranceAnnual: string;
  incentiveAnnual: string;
  employerPfAnnual: string;
  totalCompanyContributionsAnnual: string;
  totalEmolumentsAnnual: string;
};

function SalarySection({
  title,
  rows,
  numberFormatStyle,
}: {
  title: string;
  rows: Array<[string, string | null]>;
  numberFormatStyle: NumberFormatStyle;
}) {
  return (
    <div>
      <h3 className="mb-2 text-sm font-medium">{title}</h3>
      <dl className="grid gap-x-8 gap-y-1 text-sm sm:grid-cols-2">
        {rows.map(([label, value]) => (
          <div
            key={label}
            className={cn(
              'flex justify-between gap-4 border-b py-1.5 last:border-b-0',
              SIGNAL_ROW_DIVIDER,
            )}
          >
            <dt className={SIGNAL_MUTED}>{label}</dt>
            <dd className="whitespace-nowrap font-medium">
              {value === null
                ? 'Not applicable'
                : formatINR(Number(value), numberFormatStyle)}
            </dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

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

  // Compensation is entered as target Annual CTC. The salary engine is
  // monthly-driven (annual = monthly × 12), so we send annual / 12 at the API
  // boundary; the server multiplies back and rounds to paise, so the annual the
  // user typed is what gets calculated and stored. The server then derives every
  // component from the effective Statutory Config.
  const [annualCtc, setAnnualCtc] = useState('');
  const [effectiveDate, setEffectiveDate] = useState('');
  const [compensationPreview, setCompensationPreview] =
    useState<CompensationPreview | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);

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

  useEffect(() => {
    setCompensationPreview(null);
    setPreviewError(null);
    if (!annualCtc || Number(annualCtc) <= 0 || !effectiveDate) return;
    const timer = window.setTimeout(async () => {
      setPreviewLoading(true);
      try {
        setCompensationPreview(
          await apiFetch<CompensationPreview>(
            '/employees/onboard/compensation-preview',
            {
              method: 'POST',
              body: JSON.stringify({
                monthlyCtc: Number(annualCtc) / 12,
                effectiveDate,
              }),
            },
          ),
        );
      } catch (err) {
        setPreviewError(
          err instanceof ApiError
            ? err.message
            : 'Unable to calculate salary structure',
        );
      } finally {
        setPreviewLoading(false);
      }
    }, 300);
    return () => window.clearTimeout(timer);
  }, [annualCtc, effectiveDate]);

  function selectRequisition(id: string) {
    setCandidateRequisitionId(id);
    if (!id) return;
    const option = requisitionOptions.find((item) => item.id === id);
    if (!option) return;

    const [candidateFirstName = '', ...candidateLastNameParts] =
      option.selectedCandidateName.trim().split(/\s+/);
    setFirstName(candidateFirstName);
    setLastName(candidateLastNameParts.join(' '));

    // Every term comes from the offer letter the candidate accepted, so the
    // employee record and their first salary structure say exactly what they
    // agreed to. Reset first, so terms from a previously selected requisition
    // can never be carried over.
    setDesignation(option.designation ?? '');
    setEmploymentType(option.employmentType ?? 'FULL_TIME_PERMANENT');
    setVerticalId(option.vertical?.id ?? '');
    setDateOfJoining('');
    setWorkLocation('');
    setTerritory('');
    setAnnualCtc('');
    setEffectiveDate('');

    if (option.dateOfJoining)
      setDateOfJoining(option.dateOfJoining.slice(0, 10));
    if (option.workLocation) setWorkLocation(option.workLocation);
    if (option.territory) setTerritory(option.territory);
    // The offer-letter snapshot carries a monthly figure; the engine's annual is
    // monthly × 12, so prefill the annual field the same way.
    setAnnualCtc(
      option.compensation?.monthlyCtc
        ? String(Number(option.compensation.monthlyCtc) * 12)
        : '',
    );
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
      !!(annualCtc && effectiveDate && compensationPreview),
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
    annualCtc,
    effectiveDate,
    compensationPreview,
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
            monthlyCtc: Number(annualCtc) / 12,
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
      <SignalPage>
        <SignalHeader title="Employee onboarded" />
        <div className="px-5 pb-7 pt-[18px] lg:px-7">
          <SCard className="mx-auto w-full max-w-xl space-y-4 px-5 py-[18px]">
            <div className="flex items-center gap-3">
              <span className="flex size-9 items-center justify-center rounded-full bg-[#1E9E63]/15 text-[#1E9E63] dark:bg-[#3DD68C]/[.14] dark:text-[#3DD68C]">
                <Check className="size-5" />
              </span>
              <div>
                <div className="font-medium">
                  {created.employeeId} — {created.firstName} {created.lastName}
                </div>
                <div className={cn('text-sm', SIGNAL_MUTED)}>
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
            <p className="rounded-[9px] bg-[#3B6FB5]/[.07] p-3 text-sm text-black/60 dark:bg-[#6FA3E0]/[.09] dark:text-white/55">
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
          </SCard>
        </div>
      </SignalPage>
    );
  }

  const current = STEPS[step];

  return (
    <SignalPage>
      <SignalHeader
        title="Onboard Employee"
        description="Fill each section, then move to the next. Sensitive PII is stored encrypted."
      />

      <div className="px-5 pb-7 pt-[18px] lg:px-7">
        <div className="mx-auto w-full max-w-2xl">
      <SCard className="mb-6 px-5 py-[18px]">
          <Field label="Link to a Candidate Requisition (optional)">
            <Select
              value={candidateRequisitionId}
              onChange={(event) => selectRequisition(event.target.value)}
            >
              <option value="">No requisition — exception onboarding</option>
              {requisitionOptions.map((option) => (
                <option key={option.id} value={option.id}>
                  {option.requisitionNumber} — {option.selectedCandidateName} —{' '}
                  {option.designation ?? 'Role TBD'}
                  {option.offerReferenceNumber
                    ? ` (offer ${option.offerReferenceNumber})`
                    : ''}
                </option>
              ))}
            </Select>
            <p className={cn('mt-2 text-xs', SIGNAL_MUTED)}>
              Only requisitions whose candidate has accepted an approved Offer
              Letter appear here — the acceptance is what authorizes the hire. The
              name, designation, employment type, joining date, place of posting
              and compensation are all filled from the letter they accepted, and
              every field remains editable for HR review.
            </p>
          </Field>
      </SCard>

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
                      'border-[#3B6FB5] bg-[#3B6FB5] text-white dark:border-[#6FA3E0] dark:bg-[#6FA3E0] dark:text-[#1B1B1B]',
                    done &&
                      'border-[#1E9E63] bg-[#1E9E63] text-white dark:border-[#3DD68C] dark:bg-[#3DD68C] dark:text-[#1B1B1B]',
                    !active &&
                      !done &&
                      'border-black/15 text-black/45 dark:border-white/[.16] dark:text-white/40',
                  )}
                >
                  {done ? <Check className="size-4" /> : i + 1}
                </span>
                <span
                  className={cn(
                    'hidden sm:inline',
                    active
                      ? 'font-medium text-[#1B1B1B] dark:text-[#EDEDED]'
                      : SIGNAL_MUTED,
                  )}
                >
                  {s.title}
                </span>
              </button>
              {i < STEPS.length - 1 && (
                <span
                  className="h-px flex-1 bg-black/10 dark:bg-white/[.12]"
                  aria-hidden
                />
              )}
            </li>
          );
        })}
      </ol>

      <SCard className="px-5 py-[18px]">
          <div className="mb-4">
            <SCardTitle
              title={current.title}
              right={
                current.sensitive ? (
                  <ToneChip tone="warning" className="gap-1">
                    <ShieldAlert className="size-3.5" /> Sensitive — encrypted
                  </ToneChip>
                ) : undefined
              }
            />
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
                <p className={cn('mt-1 text-xs', SIGNAL_MUTED)}>
                  Suggested automatically from the employee name. HR can edit it
                  before onboarding.
                </p>
              </Field>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Vertical">
                  <Select
                    value={verticalId}
                    onChange={(e) => setVerticalId(e.target.value)}
                    disabled={!!candidateRequisitionId}
                  >
                    <option value="">Select a vertical…</option>
                    {verticals.map((v) => (
                      <option key={v.id} value={v.id}>
                        {v.name}
                      </option>
                    ))}
                  </Select>
                  {candidateRequisitionId && (
                    <p className={cn('mt-1 text-xs', SIGNAL_MUTED)}>
                      Assigned automatically from the approved candidate
                      requisition.
                    </p>
                  )}
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
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Annual CTC" hint="INR — monthly split is derived">
                  <Input
                    type="number"
                    min={1}
                    value={annualCtc}
                    onChange={(e) => setAnnualCtc(e.target.value)}
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

              {previewLoading && (
                <div
                  className={cn(
                    'rounded-[9px] border bg-black/[.02] p-4 text-sm dark:bg-white/[.02]',
                    SIGNAL_HAIRLINE,
                    SIGNAL_MUTED,
                  )}
                >
                  Calculating from effective Statutory Config…
                </div>
              )}
              {previewError && (
                <Callout variant="danger" className="mt-0">
                  {previewError}
                </Callout>
              )}
              {compensationPreview && (
                <div
                  className={cn(
                    'space-y-4 rounded-[9px] border bg-black/[.02] p-4 dark:bg-white/[.02]',
                    SIGNAL_HAIRLINE,
                  )}
                >
                  <div className="flex items-center justify-between">
                    <div className={SIGNAL_EYEBROW}>
                      System-calculated salary structure
                    </div>
                    <div className="font-semibold">
                      Annual CTC {formatINR(Number(compensationPreview.annualCtc), numberFormatStyle)}
                    </div>
                  </div>
                  <SalarySection
                    title="Monthly earnings"
                    rows={[
                      ['Basic', compensationPreview.basicMonthly],
                      ['HRA', compensationPreview.hraMonthly],
                      ['Conveyance', compensationPreview.conveyanceMonthly],
                      ['Other Allowance', compensationPreview.otherAllowanceMonthly],
                      ['Total Monthly Salary', compensationPreview.grossMonthly],
                    ]}
                    numberFormatStyle={numberFormatStyle}
                  />
                  <SalarySection
                    title="Monthly deductions"
                    rows={[
                      ['Professional Tax (PT)', compensationPreview.professionalTaxMonthly],
                      ['Employee PF', compensationPreview.employeePfMonthly],
                      ['Employee ESI', compensationPreview.employeeEsiMonthly],
                      ['Total Deductions', compensationPreview.totalDeductionsMonthly],
                      ['Net Salary', compensationPreview.netSalaryMonthly],
                    ]}
                    numberFormatStyle={numberFormatStyle}
                  />
                  <SalarySection
                    title="Annual company contributions"
                    rows={[
                      ['Total Annualised Salary', compensationPreview.totalAnnualisedSalary],
                      ['Employer PF', compensationPreview.employerPfAnnual],
                      ['Insurance (PA)', compensationPreview.insuranceAnnual],
                      ['Incentive', compensationPreview.incentiveAnnual],
                      ['Total Company Contributions', compensationPreview.totalCompanyContributionsAnnual],
                      ['Total Emoluments per Annum', compensationPreview.totalEmolumentsAnnual],
                    ]}
                    numberFormatStyle={numberFormatStyle}
                  />
                  <p className={cn('text-xs', SIGNAL_MUTED)}>
                    ESI is shown only when applicable. TDS remains “as applicable” and is calculated during payroll.
                  </p>
                </div>
              )}
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

          {error && (
            <p className="mt-4 text-sm text-[#C13438] dark:text-[#FF8A8D]">
              {error}
            </p>
          )}

          {/* Navigation */}
          <div
            className={cn(
              'mt-6 flex items-center justify-between border-t pt-4',
              SIGNAL_HAIRLINE,
            )}
          >
            <Button variant="outline" onClick={goBack} disabled={step === 0}>
              <ChevronLeft className="size-4" /> Back
            </Button>
            <span className={cn('text-xs', SIGNAL_MUTED)}>
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
      </SCard>
        </div>
      </div>
    </SignalPage>
  );
}
