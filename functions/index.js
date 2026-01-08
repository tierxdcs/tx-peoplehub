const { onRequest } = require('firebase-functions/v2/https');
const express = require('express');
const cors = require('cors');
const { getPool, secrets } = require('./db');

const app = express();
app.use(cors({ origin: true }));
app.use(express.json());

const getPoolInstance = () => getPool();

app.get('/api/health', async (_req, res) => {
  try {
    await getPoolInstance().query('SELECT 1');
    res.json({ ok: true, status: 'connected' });
  } catch (error) {
    res.status(500).json({ ok: false, error: 'Database connection failed' });
  }
});

app.get('/api/info', async (_req, res) => {
  try {
    const result = await getPoolInstance().query(
      "SELECT table_schema, table_name FROM information_schema.tables WHERE table_schema NOT IN ('pg_catalog', 'information_schema') ORDER BY table_schema, table_name"
    );
    res.json({ tables: result.rows });
  } catch (error) {
    res.status(500).json({ error: 'Unable to read schema' });
  }
});

app.get('/api/users', async (_req, res) => {
  try {
    const result = await getPoolInstance().query(
      'SELECT * FROM tx_users ORDER BY created_at DESC'
    );
    res.json(result.rows);
  } catch (error) {
    res.status(500).json({ error: 'Unable to load users' });
  }
});

app.post('/api/users', async (req, res) => {
  const { fullName, email, department, role, status, director } = req.body;
  try {
    const result = await getPoolInstance().query(
      `INSERT INTO tx_users (full_name, email, department, role, status, director)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (email) DO UPDATE
       SET full_name = EXCLUDED.full_name,
           department = EXCLUDED.department,
           status = EXCLUDED.status,
           director = EXCLUDED.director,
           updated_at = NOW()
       RETURNING *`,
      [fullName, email, department, role, status, director]
    );
    res.json(result.rows[0]);
  } catch (error) {
    res.status(500).json({ error: 'Unable to save user' });
  }
});

app.put('/api/users/:id', async (req, res) => {
  const { id } = req.params;
  const { fullName, email, department, status, director } = req.body;
  try {
    const result = await getPoolInstance().query(
      `UPDATE tx_users
       SET full_name = $1, email = $2, department = $3, status = $4, director = $5, updated_at = NOW()
       WHERE id = $6
       RETURNING *`,
      [fullName, email, department, status, director, id]
    );
    res.json(result.rows[0]);
  } catch (error) {
    res.status(500).json({ error: 'Unable to update user' });
  }
});

app.get('/api/departments', async (_req, res) => {
  try {
    const result = await getPoolInstance().query(
      'SELECT * FROM tx_departments ORDER BY name'
    );
    res.json(result.rows);
  } catch (error) {
    res.status(500).json({ error: 'Unable to load departments' });
  }
});

app.post('/api/departments', async (req, res) => {
  const { name, head } = req.body;
  try {
    const result = await getPoolInstance().query(
      `INSERT INTO tx_departments (name, head)
       VALUES ($1, $2)
       ON CONFLICT (name) DO UPDATE
       SET head = EXCLUDED.head
       RETURNING *`,
      [name, head]
    );
    res.json(result.rows[0]);
  } catch (error) {
    res.status(500).json({ error: 'Unable to save department' });
  }
});

app.delete('/api/departments/:id', async (req, res) => {
  const { id } = req.params;
  try {
    await getPoolInstance().query('DELETE FROM tx_departments WHERE id = $1', [id]);
    res.json({ ok: true });
  } catch (error) {
    res.status(500).json({ error: 'Unable to delete department' });
  }
});

app.get('/api/teams', async (_req, res) => {
  try {
    const result = await getPoolInstance().query(
      'SELECT * FROM tx_teams ORDER BY name'
    );
    res.json(result.rows);
  } catch (error) {
    res.status(500).json({ error: 'Unable to load teams' });
  }
});

app.post('/api/teams', async (req, res) => {
  const { name, head, summary, peopleCount, coverage, sites } = req.body;
  try {
    const result = await getPoolInstance().query(
      `INSERT INTO tx_teams (name, head, summary, people_count, coverage, sites)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (name) DO UPDATE
       SET head = EXCLUDED.head,
           summary = EXCLUDED.summary,
           people_count = EXCLUDED.people_count,
           coverage = EXCLUDED.coverage,
           sites = EXCLUDED.sites
       RETURNING *`,
      [name, head, summary, peopleCount, coverage, sites]
    );
    res.json(result.rows[0]);
  } catch (error) {
    res.status(500).json({ error: 'Unable to save team' });
  }
});

app.delete('/api/teams/:id', async (req, res) => {
  const { id } = req.params;
  try {
    await getPoolInstance().query('DELETE FROM tx_teams WHERE id = $1', [id]);
    res.json({ ok: true });
  } catch (error) {
    res.status(500).json({ error: 'Unable to delete team' });
  }
});

app.get('/api/employee-profiles', async (_req, res) => {
  try {
    const result = await getPoolInstance().query(
      'SELECT * FROM tx_employee_profiles ORDER BY updated_at DESC NULLS LAST LIMIT 1'
    );
    res.json(result.rows[0] ?? null);
  } catch (error) {
    res.status(500).json({ error: 'Unable to load employee profile' });
  }
});

app.post('/api/employee-profiles', async (req, res) => {
  const profile = req.body;
  try {
    const result = await getPoolInstance().query(
      `INSERT INTO tx_employee_profiles (
        full_name, employee_id, email, location, department, start_date, job_title, role,
        manager, manager_level2, manager_level3, manager_level4, ceo, director,
        employment_type, status, cost_center, base_salary, pay_schedule, bonus_eligible,
        equity_plan, benefits_tier, compensation_effective_date, offer_letter_name,
        offer_letter_data, comp_band, comp_positioning, annual_pto, sick_leave,
        floating_holidays, parental_leave, carryover_cap, policy_effective,
        certifications, background_check, safety_training, work_authorization, photo_url,
        compliance_document_name, next_audit_date, checklist_offer, checklist_equipment,
        checklist_badges, checklist_orientation, checklist_business_card, checklist_custom,
        checklist_offer_owner, checklist_equipment_owner, checklist_badges_owner,
        checklist_orientation_owner, checklist_business_card_owner, updated_at
      )
      VALUES (
        $1,$2,$3,$4,$5,$6,$7,$8,
        $9,$10,$11,$12,$13,$14,
        $15,$16,$17,$18,$19,$20,
        $21,$22,$23,$24,
        $25,$26,$27,$28,$29,
        $30,$31,$32,$33,
        $34,$35,$36,$37,$38,
        $39,$40,$41,$42,$43,
        $44,$45,$46,$47,$48,
        $49,$50,$51,NOW()
      )
      ON CONFLICT (email) DO UPDATE SET
        full_name = EXCLUDED.full_name,
        employee_id = EXCLUDED.employee_id,
        location = EXCLUDED.location,
        department = EXCLUDED.department,
        start_date = EXCLUDED.start_date,
        job_title = EXCLUDED.job_title,
        role = EXCLUDED.role,
        manager = EXCLUDED.manager,
        manager_level2 = EXCLUDED.manager_level2,
        manager_level3 = EXCLUDED.manager_level3,
        manager_level4 = EXCLUDED.manager_level4,
        ceo = EXCLUDED.ceo,
        director = EXCLUDED.director,
        employment_type = EXCLUDED.employment_type,
        status = EXCLUDED.status,
        cost_center = EXCLUDED.cost_center,
        base_salary = EXCLUDED.base_salary,
        pay_schedule = EXCLUDED.pay_schedule,
        bonus_eligible = EXCLUDED.bonus_eligible,
        equity_plan = EXCLUDED.equity_plan,
        benefits_tier = EXCLUDED.benefits_tier,
        compensation_effective_date = EXCLUDED.compensation_effective_date,
        offer_letter_name = EXCLUDED.offer_letter_name,
        offer_letter_data = EXCLUDED.offer_letter_data,
        comp_band = EXCLUDED.comp_band,
        comp_positioning = EXCLUDED.comp_positioning,
        annual_pto = EXCLUDED.annual_pto,
        sick_leave = EXCLUDED.sick_leave,
        floating_holidays = EXCLUDED.floating_holidays,
        parental_leave = EXCLUDED.parental_leave,
        carryover_cap = EXCLUDED.carryover_cap,
        policy_effective = EXCLUDED.policy_effective,
        certifications = EXCLUDED.certifications,
        background_check = EXCLUDED.background_check,
        safety_training = EXCLUDED.safety_training,
        work_authorization = EXCLUDED.work_authorization,
        photo_url = EXCLUDED.photo_url,
        compliance_document_name = EXCLUDED.compliance_document_name,
        next_audit_date = EXCLUDED.next_audit_date,
        checklist_offer = EXCLUDED.checklist_offer,
        checklist_equipment = EXCLUDED.checklist_equipment,
        checklist_badges = EXCLUDED.checklist_badges,
        checklist_orientation = EXCLUDED.checklist_orientation,
        checklist_business_card = EXCLUDED.checklist_business_card,
        checklist_custom = EXCLUDED.checklist_custom,
        checklist_offer_owner = EXCLUDED.checklist_offer_owner,
        checklist_equipment_owner = EXCLUDED.checklist_equipment_owner,
        checklist_badges_owner = EXCLUDED.checklist_badges_owner,
        checklist_orientation_owner = EXCLUDED.checklist_orientation_owner,
        checklist_business_card_owner = EXCLUDED.checklist_business_card_owner,
        updated_at = NOW()
      RETURNING *`,
      [
        profile.fullName,
        profile.employeeId,
        profile.email,
        profile.location,
        profile.department,
        profile.startDate,
        profile.jobTitle,
        profile.role,
        profile.manager,
        profile.managerLevel2,
        profile.managerLevel3,
        profile.managerLevel4,
        profile.ceo,
        profile.director,
        profile.employmentType,
        profile.status,
        profile.costCenter,
        profile.baseSalary,
        profile.paySchedule,
        profile.bonusEligible,
        profile.equityPlan,
        profile.benefitsTier,
        profile.compensationEffectiveDate,
        profile.offerLetterName,
        profile.offerLetterData,
        profile.compBand,
        profile.compPositioning,
        profile.annualPto,
        profile.sickLeave,
        profile.floatingHolidays,
        profile.parentalLeave,
        profile.carryoverCap,
        profile.policyEffective,
        profile.certifications,
        profile.backgroundCheck,
        profile.safetyTraining,
        profile.workAuthorization,
        profile.photoUrl,
        profile.complianceDocumentName,
        profile.nextAuditDate,
        profile.checklistOffer,
        profile.checklistEquipment,
        profile.checklistBadges,
        profile.checklistOrientation,
        profile.checklistBusinessCard,
        profile.checklistCustom ?? [],
        profile.checklistOfferOwner,
        profile.checklistEquipmentOwner,
        profile.checklistBadgesOwner,
        profile.checklistOrientationOwner,
        profile.checklistBusinessCardOwner
      ]
    );
    res.json(result.rows[0]);
  } catch (error) {
    res.status(500).json({ error: 'Unable to save employee profile' });
  }
});

app.get('/api/training-assignments', async (_req, res) => {
  try {
    const result = await getPoolInstance().query(
      'SELECT * FROM tx_training_assignments ORDER BY created_at DESC'
    );
    res.json(result.rows);
  } catch (error) {
    res.status(500).json({ error: 'Unable to load training assignments' });
  }
});

app.post('/api/training-assignments', async (req, res) => {
  const assignment = req.body;
  try {
    const result = await getPoolInstance().query(
      `INSERT INTO tx_training_assignments
       (title, audience, department, due_date, questions, completed, total, participants)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
       RETURNING *`,
      [
        assignment.title,
        assignment.audience,
        assignment.department,
        assignment.dueDate,
        assignment.questions ?? [],
        assignment.completed ?? 0,
        assignment.total ?? 0,
        assignment.participants ?? []
      ]
    );
    res.json(result.rows[0]);
  } catch (error) {
    res.status(500).json({ error: 'Unable to save training assignment' });
  }
});

app.put('/api/training-assignments/:id', async (req, res) => {
  const { id } = req.params;
  const assignment = req.body;
  try {
    const result = await getPoolInstance().query(
      `UPDATE tx_training_assignments
       SET questions = $1, participants = $2, completed = $3, total = $4
       WHERE id = $5
       RETURNING *`,
      [
        assignment.questions ?? [],
        assignment.participants ?? [],
        assignment.completed ?? 0,
        assignment.total ?? 0,
        id
      ]
    );
    res.json(result.rows[0]);
  } catch (error) {
    res.status(500).json({ error: 'Unable to update training assignment' });
  }
});

app.post('/api/training-responses', async (req, res) => {
  const { assignmentId, employee, responses, score, passed } = req.body;
  try {
    const result = await getPoolInstance().query(
      `INSERT INTO tx_training_responses (assignment_id, employee, responses, score, passed)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING *`,
      [assignmentId, employee, responses, score ?? null, passed ?? false]
    );
    res.json(result.rows[0]);
  } catch (error) {
    res.status(500).json({ error: 'Unable to save training responses' });
  }
});

app.get('/api/training-responses', async (req, res) => {
  const { assignmentId, employee } = req.query;
  try {
    const filters = [];
    const values = [];
    if (assignmentId) {
      values.push(assignmentId);
      filters.push(`assignment_id = $${values.length}`);
    }
    if (employee) {
      values.push(employee);
      filters.push(`employee = $${values.length}`);
    }
    const where = filters.length ? `WHERE ${filters.join(' AND ')}` : '';
    const result = await getPoolInstance().query(
      `SELECT * FROM tx_training_responses ${where} ORDER BY submitted_at DESC`,
      values
    );
    res.json(result.rows);
  } catch (error) {
    res.status(500).json({ error: 'Unable to load training responses' });
  }
});

app.get('/api/ideas', async (_req, res) => {
  try {
    const result = await getPoolInstance().query(
      'SELECT * FROM tx_ideas ORDER BY submitted_at DESC'
    );
    res.json(result.rows);
  } catch (error) {
    res.status(500).json({ error: 'Unable to load ideas' });
  }
});

app.post('/api/ideas', async (req, res) => {
  const idea = req.body;
  try {
    const result = await getPoolInstance().query(
      `INSERT INTO tx_ideas (title, type, summary, manager)
       VALUES ($1,$2,$3,$4)
       RETURNING *`,
      [idea.title, idea.type, idea.summary, idea.manager]
    );
    res.json(result.rows[0]);
  } catch (error) {
    res.status(500).json({ error: 'Unable to save idea' });
  }
});

app.get('/api/leaves', async (_req, res) => {
  try {
    const result = await getPoolInstance().query(
      'SELECT * FROM tx_leave_requests ORDER BY created_at DESC'
    );
    res.json(result.rows);
  } catch (error) {
    res.status(500).json({ error: 'Unable to load leave requests' });
  }
});

app.post('/api/leaves', async (req, res) => {
  const leave = req.body;
  try {
    const result = await getPoolInstance().query(
      `INSERT INTO tx_leave_requests
       (employee_name, type, start_date, end_date, range, status, notes)
       VALUES ($1,$2,$3,$4,$5,$6,$7)
       RETURNING *`,
      [
        leave.employeeName,
        leave.type,
        leave.startDate,
        leave.endDate,
        leave.range,
        leave.status,
        leave.notes
      ]
    );
    res.json(result.rows[0]);
  } catch (error) {
    res.status(500).json({ error: 'Unable to save leave request' });
  }
});

app.patch('/api/leaves/:id', async (req, res) => {
  const { id } = req.params;
  const { status } = req.body;
  try {
    const result = await getPoolInstance().query(
      `UPDATE tx_leave_requests SET status = $1 WHERE id = $2 RETURNING *`,
      [status, id]
    );
    res.json(result.rows[0]);
  } catch (error) {
    res.status(500).json({ error: 'Unable to update leave request' });
  }
});

app.get('/api/reimbursements', async (_req, res) => {
  try {
    const result = await getPoolInstance().query(
      'SELECT * FROM tx_reimbursements ORDER BY created_at DESC'
    );
    res.json(result.rows);
  } catch (error) {
    res.status(500).json({ error: 'Unable to load reimbursements' });
  }
});

app.post('/api/reimbursements', async (req, res) => {
  const item = req.body;
  try {
    const result = await getPoolInstance().query(
      `INSERT INTO tx_reimbursements
       (title, amount, category, date, notes, status, employee)
       VALUES ($1,$2,$3,$4,$5,$6,$7)
       RETURNING *`,
      [item.title, item.amount, item.category, item.date, item.notes, item.status, item.employee]
    );
    res.json(result.rows[0]);
  } catch (error) {
    res.status(500).json({ error: 'Unable to save reimbursement' });
  }
});

app.patch('/api/reimbursements/:id', async (req, res) => {
  const { id } = req.params;
  const { status } = req.body;
  try {
    const result = await getPoolInstance().query(
      `UPDATE tx_reimbursements SET status = $1 WHERE id = $2 RETURNING *`,
      [status, id]
    );
    res.json(result.rows[0]);
  } catch (error) {
    res.status(500).json({ error: 'Unable to update reimbursement' });
  }
});

app.get('/api/requisitions', async (_req, res) => {
  try {
    const result = await getPoolInstance().query(
      'SELECT * FROM tx_requisitions ORDER BY submitted_at DESC'
    );
    res.json(result.rows);
  } catch (error) {
    res.status(500).json({ error: 'Unable to load requisitions' });
  }
});

app.post('/api/requisitions', async (req, res) => {
  const item = req.body;
  try {
    const result = await getPoolInstance().query(
      `INSERT INTO tx_requisitions
       (title, department, location, headcount, level, hire_type, start_date, justification, budget_impact, manager, cost_center, approval)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
       RETURNING *`,
      [
        item.title,
        item.department,
        item.location,
        item.headcount,
        item.level,
        item.hireType,
        item.startDate,
        item.justification,
        item.budgetImpact,
        item.manager,
        item.costCenter,
        item.approval
      ]
    );
    res.json(result.rows[0]);
  } catch (error) {
    res.status(500).json({ error: 'Unable to save requisition' });
  }
});

app.patch('/api/requisitions/:id', async (req, res) => {
  const { id } = req.params;
  const { approval } = req.body;
  try {
    const result = await getPoolInstance().query(
      `UPDATE tx_requisitions SET approval = $1 WHERE id = $2 RETURNING *`,
      [approval, id]
    );
    res.json(result.rows[0]);
  } catch (error) {
    res.status(500).json({ error: 'Unable to update requisition' });
  }
});

app.get('/api/tasks', async (_req, res) => {
  try {
    const result = await getPoolInstance().query(
      'SELECT * FROM tx_tasks ORDER BY created_at DESC'
    );
    res.json(result.rows);
  } catch (error) {
    res.status(500).json({ error: 'Unable to load tasks' });
  }
});

app.post('/api/tasks', async (req, res) => {
  const item = req.body;
  try {
    const result = await getPoolInstance().query(
      `INSERT INTO tx_tasks (title, owner, due, source)
       VALUES ($1,$2,$3,$4)
       RETURNING *`,
      [item.title, item.owner, item.due, item.source]
    );
    res.json(result.rows[0]);
  } catch (error) {
    res.status(500).json({ error: 'Unable to save task' });
  }
});

app.delete('/api/tasks/:id', async (req, res) => {
  const { id } = req.params;
  try {
    await getPoolInstance().query('DELETE FROM tx_tasks WHERE id = $1', [id]);
    res.json({ ok: true });
  } catch (error) {
    res.status(500).json({ error: 'Unable to delete task' });
  }
});

app.get('/api/approvals/completed', async (_req, res) => {
  try {
    const result = await getPoolInstance().query(
      'SELECT * FROM tx_approvals_completed ORDER BY decided_at DESC'
    );
    res.json(result.rows);
  } catch (error) {
    res.status(500).json({ error: 'Unable to load completed approvals' });
  }
});

app.post('/api/approvals/completed', async (req, res) => {
  const item = req.body;
  try {
    const result = await getPoolInstance().query(
      `INSERT INTO tx_approvals_completed (source, source_id, title, submitted_by, summary, status, note)
       VALUES ($1,$2,$3,$4,$5,$6,$7)
       RETURNING *`,
      [item.source, item.sourceId, item.title, item.submittedBy, item.summary, item.status, item.note]
    );
    res.json(result.rows[0]);
  } catch (error) {
    res.status(500).json({ error: 'Unable to save completed approval' });
  }
});

exports.api = onRequest(
  {
    cors: true,
    invoker: 'public',
    secrets
  },
  app
);
