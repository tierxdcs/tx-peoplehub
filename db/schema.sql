CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS tx_users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  full_name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  department TEXT,
  role TEXT NOT NULL,
  status TEXT NOT NULL,
  director TEXT DEFAULT 'No',
  password TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE tx_users
  ADD COLUMN IF NOT EXISTS password TEXT;

CREATE TABLE IF NOT EXISTS tx_departments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL UNIQUE,
  head TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS tx_teams (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL UNIQUE,
  head TEXT,
  summary TEXT,
  people_count INT DEFAULT 0,
  coverage TEXT,
  sites TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS tx_employee_profiles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  full_name TEXT,
  employee_id TEXT,
  email TEXT UNIQUE,
  location TEXT,
  department TEXT,
  start_date DATE,
  job_title TEXT,
  role TEXT,
  manager TEXT,
  manager_level2 TEXT,
  manager_level3 TEXT,
  manager_level4 TEXT,
  ceo TEXT,
  director TEXT,
  employment_type TEXT,
  status TEXT,
  cost_center TEXT,
  base_salary NUMERIC,
  variable_pay_percent NUMERIC,
  pay_schedule TEXT,
  bonus_eligible TEXT,
  equity_plan TEXT,
  benefits_tier TEXT,
  compensation_effective_date DATE,
  offer_letter_name TEXT,
  offer_letter_data TEXT,
  comp_band TEXT,
  comp_positioning TEXT,
  annual_pto INT,
  sick_leave INT,
  floating_holidays INT,
  parental_leave INT,
  carryover_cap INT,
  policy_effective DATE,
  certifications TEXT,
  background_check TEXT,
  safety_training TEXT,
  work_authorization TEXT,
  survey_score NUMERIC,
  checkins_score NUMERIC,
  participation_score NUMERIC,
  risk_adjusted_score NUMERIC,
  photo_url TEXT,
  compliance_document_name TEXT,
  next_audit_date DATE,
  checklist_offer BOOLEAN DEFAULT FALSE,
  checklist_equipment BOOLEAN DEFAULT FALSE,
  checklist_badges BOOLEAN DEFAULT FALSE,
  checklist_orientation BOOLEAN DEFAULT FALSE,
  checklist_business_card BOOLEAN DEFAULT FALSE,
  checklist_offer_owner TEXT,
  checklist_equipment_owner TEXT,
  checklist_badges_owner TEXT,
  checklist_orientation_owner TEXT,
  checklist_business_card_owner TEXT,
  checklist_custom JSONB DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE tx_employee_profiles
  ADD COLUMN IF NOT EXISTS role TEXT;
ALTER TABLE tx_employee_profiles
  ADD COLUMN IF NOT EXISTS variable_pay_percent NUMERIC;
ALTER TABLE tx_employee_profiles
  ADD COLUMN IF NOT EXISTS checklist_custom JSONB DEFAULT '[]'::jsonb;
ALTER TABLE tx_employee_profiles
  ADD COLUMN IF NOT EXISTS photo_url TEXT;
ALTER TABLE tx_employee_profiles
  ADD COLUMN IF NOT EXISTS survey_score NUMERIC;
ALTER TABLE tx_employee_profiles
  ADD COLUMN IF NOT EXISTS checkins_score NUMERIC;
ALTER TABLE tx_employee_profiles
  ADD COLUMN IF NOT EXISTS participation_score NUMERIC;
ALTER TABLE tx_employee_profiles
  ADD COLUMN IF NOT EXISTS risk_adjusted_score NUMERIC;

CREATE TABLE IF NOT EXISTS tx_training_assignments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title TEXT NOT NULL,
  audience TEXT,
  department TEXT,
  due_date DATE,
  questions JSONB DEFAULT '[]'::jsonb,
  completed INT DEFAULT 0,
  total INT DEFAULT 0,
  participants JSONB DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS tx_training_responses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  assignment_id UUID REFERENCES tx_training_assignments(id) ON DELETE CASCADE,
  employee TEXT,
  responses JSONB DEFAULT '{}'::jsonb,
  score NUMERIC,
  passed BOOLEAN DEFAULT FALSE,
  submitted_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE tx_training_responses
  ADD COLUMN IF NOT EXISTS score NUMERIC;
ALTER TABLE tx_training_responses
  ADD COLUMN IF NOT EXISTS passed BOOLEAN DEFAULT FALSE;

CREATE TABLE IF NOT EXISTS tx_ideas (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title TEXT NOT NULL,
  type TEXT,
  summary TEXT,
  manager TEXT,
  submitted_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS tx_leave_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_name TEXT,
  type TEXT,
  start_date DATE,
  end_date DATE,
  range TEXT,
  status TEXT,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS tx_reimbursements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title TEXT,
  amount TEXT,
  category TEXT,
  date DATE,
  notes TEXT,
  status TEXT,
  employee TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS tx_requisitions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title TEXT,
  department TEXT,
  location TEXT,
  headcount INT,
  level TEXT,
  hire_type TEXT,
  start_date DATE,
  justification TEXT,
  budget_impact TEXT,
  manager TEXT,
  cost_center TEXT,
  approval TEXT,
  submitted_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS tx_tasks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title TEXT NOT NULL,
  owner TEXT,
  due TEXT,
  source TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS tx_approvals_completed (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source TEXT,
  source_id UUID,
  title TEXT,
  submitted_by TEXT,
  summary TEXT,
  status TEXT,
  note TEXT,
  decided_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_tx_users_status ON tx_users (status);
CREATE INDEX IF NOT EXISTS idx_tx_users_created_at ON tx_users (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_tx_teams_name ON tx_teams (name);
CREATE INDEX IF NOT EXISTS idx_tx_departments_name ON tx_departments (name);
CREATE INDEX IF NOT EXISTS idx_tx_employee_profiles_updated_at ON tx_employee_profiles (updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_tx_tasks_created_at ON tx_tasks (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_tx_leave_requests_status ON tx_leave_requests (status);
CREATE INDEX IF NOT EXISTS idx_tx_leave_requests_created_at ON tx_leave_requests (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_tx_ideas_submitted_at ON tx_ideas (submitted_at DESC);
CREATE INDEX IF NOT EXISTS idx_tx_training_assignments_created_at ON tx_training_assignments (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_tx_training_responses_employee ON tx_training_responses (employee);
CREATE INDEX IF NOT EXISTS idx_tx_reimbursements_created_at ON tx_reimbursements (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_tx_requisitions_submitted_at ON tx_requisitions (submitted_at DESC);
CREATE INDEX IF NOT EXISTS idx_tx_approvals_completed_decided_at ON tx_approvals_completed (decided_at DESC);
