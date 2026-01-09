const { onRequest } = require('firebase-functions/v2/https');
const express = require('express');
const cors = require('cors');
const compression = require('compression');
const { getPool, secrets } = require('./db');

const app = express();
app.use(cors({ origin: true }));
app.use(compression());
app.use(express.json({ limit: '5mb' }));
app.use(express.urlencoded({ extended: true, limit: '5mb' }));

const getPoolInstance = () => getPool();
const cache = {
  homeDashboard: { expiresAt: 0, data: null }
};
const setCacheHeader = (res, seconds) => {
  res.set('Cache-Control', `public, max-age=${seconds}`);
};

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
      `SELECT id, full_name, email, department, role, status, director
       FROM tx_users
       ORDER BY created_at DESC`
    );
    setCacheHeader(res, 10);
    res.json(result.rows);
  } catch (error) {
    res.status(500).json({ error: 'Unable to load users' });
  }
});

app.post('/api/users', async (req, res) => {
  const { fullName, email, department, role, status, director, password } = req.body;
  try {
    const result = await getPoolInstance().query(
      `INSERT INTO tx_users (full_name, email, department, role, status, director, password)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (email) DO UPDATE
       SET full_name = EXCLUDED.full_name,
           department = EXCLUDED.department,
           status = EXCLUDED.status,
           director = EXCLUDED.director,
           password = COALESCE(EXCLUDED.password, tx_users.password),
           updated_at = NOW()
       RETURNING id, full_name, email, department, role, status, director`,
      [fullName, email, department, role, status, director, password ?? null]
    );
    res.json(result.rows[0]);
  } catch (error) {
    res.status(500).json({ error: 'Unable to save user' });
  }
});

app.put('/api/users/:id', async (req, res) => {
  const { id } = req.params;
  const { fullName, email, department, status, director, password } = req.body;
  try {
    const result = await getPoolInstance().query(
      `UPDATE tx_users
       SET full_name = $1,
           email = $2,
           department = $3,
           status = $4,
           director = $5,
           password = COALESCE($6, password),
           updated_at = NOW()
       WHERE id = $7
       RETURNING id, full_name, email, department, role, status, director`,
      [fullName, email, department, status, director, password ?? null, id]
    );
    res.json(result.rows[0]);
  } catch (error) {
    res.status(500).json({ error: 'Unable to update user' });
  }
});

app.post('/api/login', async (req, res) => {
  const { email, password } = req.body ?? {};
  const normalizedEmail = String(email ?? '').trim().toLowerCase();
  const inputPassword = String(password ?? '');
  if (!normalizedEmail || !inputPassword) {
    res.status(400).json({ error: 'Email and password required' });
    return;
  }
  try {
    const result = await getPoolInstance().query(
      `SELECT id, full_name, email, role, department, director, status, password
       FROM tx_users
       WHERE LOWER(email) = $1
       LIMIT 1`,
      [normalizedEmail]
    );
    const user = result.rows[0];
    if (!user || user.status !== 'Active') {
      res.status(401).json({ error: 'Invalid credentials' });
      return;
    }
    const storedPassword = user.password ?? '';
    if (!storedPassword) {
      await getPoolInstance().query(
        'UPDATE tx_users SET password = $1, updated_at = NOW() WHERE id = $2',
        [inputPassword, user.id]
      );
    } else if (storedPassword !== inputPassword) {
      res.status(401).json({ error: 'Invalid credentials' });
      return;
    }
    res.json({
      id: user.id,
      fullName: user.full_name,
      email: user.email,
      role: user.role,
      department: user.department,
      director: user.director
    });
  } catch (error) {
    res.status(500).json({ error: 'Unable to authenticate' });
  }
});

app.get('/api/departments', async (_req, res) => {
  try {
    const result = await getPoolInstance().query(
      'SELECT id, name, head FROM tx_departments ORDER BY name'
    );
    setCacheHeader(res, 30);
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
      `SELECT id, name, head, summary, people_count, coverage, sites
       FROM tx_teams
       ORDER BY name`
    );
    setCacheHeader(res, 30);
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
    setCacheHeader(res, 10);
    res.json(result.rows[0] ?? null);
  } catch (error) {
    res.status(500).json({ error: 'Unable to load employee profile' });
  }
});

app.get('/api/employee-spotlight', async (_req, res) => {
  try {
    const result = await getPoolInstance().query(
      `SELECT full_name, employee_id, email, location, department, job_title, status,
              manager, photo_url, survey_score, checkins_score, participation_score,
              risk_adjusted_score
       FROM tx_employee_profiles
       ORDER BY updated_at DESC NULLS LAST
       LIMIT 1`
    );
    setCacheHeader(res, 10);
    res.json(result.rows[0] ?? null);
  } catch (error) {
    res.status(500).json({ error: 'Unable to load employee spotlight' });
  }
});

app.get('/api/home-dashboard', async (_req, res) => {
  const now = Date.now();
  if (cache.homeDashboard.data && cache.homeDashboard.expiresAt > now) {
    setCacheHeader(res, 15);
    res.json(cache.homeDashboard.data);
    return;
  }
  try {
    const pool = getPoolInstance();
    const [
      activeUsersResult,
      profileResult,
      tasksResult,
      leavesResult,
      ideasResult,
      assignmentsResult
    ] = await Promise.all([
      pool.query('SELECT COUNT(*) AS count FROM tx_users WHERE status = $1', ['Active']),
      pool.query(
        `SELECT full_name, employee_id, email, location, department, job_title, status,
                manager, photo_url, survey_score, checkins_score, participation_score,
                risk_adjusted_score
         FROM tx_employee_profiles
         ORDER BY updated_at DESC NULLS LAST
         LIMIT 1`
      ),
      pool.query('SELECT title FROM tx_tasks ORDER BY created_at DESC LIMIT 3'),
      pool.query(
        `SELECT id, employee_name, type, start_date, end_date, range, status, notes
         FROM tx_leave_requests
         WHERE LOWER(status) LIKE '%pending%'
         ORDER BY created_at DESC
         LIMIT 6`
      ),
      pool.query(
        `SELECT id, title, type, summary, manager, submitted_at
         FROM tx_ideas
         ORDER BY submitted_at DESC
         LIMIT 6`
      ),
      pool.query('SELECT COUNT(*) AS count FROM tx_training_assignments')
    ]);

    const profile = profileResult.rows[0] ?? null;
    let completed = 0;
    if (profile?.full_name) {
      const responsesResult = await pool.query(
        'SELECT COUNT(*) AS count FROM tx_training_responses WHERE employee = $1',
        [profile.full_name]
      );
      completed = Number(responsesResult.rows[0]?.count ?? 0);
    }
    const total = Number(assignmentsResult.rows[0]?.count ?? 0);
    const coverage = total ? Math.round((completed / total) * 100) : 0;

    const payload = {
      activeUserCount: Number(activeUsersResult.rows[0]?.count ?? 0),
      profile,
      tasks: tasksResult.rows ?? [],
      pendingLeaves: leavesResult.rows ?? [],
      ideas: ideasResult.rows ?? [],
      training: { completed, total, coverage }
    };
    cache.homeDashboard = { data: payload, expiresAt: now + 15000 };
    setCacheHeader(res, 15);
    res.json(payload);
  } catch (error) {
    res.status(500).json({ error: 'Unable to load home dashboard' });
  }
});

app.post('/api/employee-profiles', async (req, res) => {
  const profile = req.body;
  const normalizeNumber = (value) => {
    if (value === '' || value === null || value === undefined) {
      return null;
    }
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  };
  const normalizeInt = (value) => {
    if (value === '' || value === null || value === undefined) {
      return null;
    }
    const parsed = Number.parseInt(value, 10);
    return Number.isFinite(parsed) ? parsed : null;
  };
  const normalizeDate = (value) => {
    if (value === '' || value === null || value === undefined) {
      return null;
    }
    return value;
  };
  const cleaned = {
    ...profile,
    startDate: normalizeDate(profile.startDate),
    compensationEffectiveDate: normalizeDate(profile.compensationEffectiveDate),
    policyEffective: normalizeDate(profile.policyEffective),
    nextAuditDate: normalizeDate(profile.nextAuditDate),
    baseSalary: normalizeNumber(profile.baseSalary),
    annualPto: normalizeInt(profile.annualPto),
    sickLeave: normalizeInt(profile.sickLeave),
    floatingHolidays: normalizeInt(profile.floatingHolidays),
    parentalLeave: normalizeInt(profile.parentalLeave),
    carryoverCap: normalizeInt(profile.carryoverCap),
    surveyScore: normalizeNumber(profile.surveyScore),
    checkinsScore: normalizeNumber(profile.checkinsScore),
    participationScore: normalizeNumber(profile.participationScore),
    riskAdjustedScore: normalizeNumber(profile.riskAdjustedScore)
  };
  try {
    const result = await getPoolInstance().query(
      `INSERT INTO tx_employee_profiles (
        full_name, employee_id, email, location, department, start_date, job_title, role,
        manager, manager_level2, manager_level3, manager_level4, ceo, director,
        employment_type, status, cost_center, base_salary, pay_schedule, bonus_eligible,
        equity_plan, benefits_tier, compensation_effective_date, offer_letter_name,
        offer_letter_data, comp_band, comp_positioning, annual_pto, sick_leave,
        floating_holidays, parental_leave, carryover_cap, policy_effective,
        certifications, background_check, safety_training, work_authorization,
        survey_score, checkins_score, participation_score, risk_adjusted_score, photo_url,
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
        $49,$50,$51,$52,$53,
        $54,$55,NOW()
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
        survey_score = EXCLUDED.survey_score,
        checkins_score = EXCLUDED.checkins_score,
        participation_score = EXCLUDED.participation_score,
        risk_adjusted_score = EXCLUDED.risk_adjusted_score,
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
        cleaned.fullName,
        cleaned.employeeId,
        cleaned.email,
        cleaned.location,
        cleaned.department,
        cleaned.startDate,
        cleaned.jobTitle,
        cleaned.role,
        cleaned.manager,
        cleaned.managerLevel2,
        cleaned.managerLevel3,
        cleaned.managerLevel4,
        cleaned.ceo,
        cleaned.director,
        cleaned.employmentType,
        cleaned.status,
        cleaned.costCenter,
        cleaned.baseSalary,
        cleaned.paySchedule,
        cleaned.bonusEligible,
        cleaned.equityPlan,
        cleaned.benefitsTier,
        cleaned.compensationEffectiveDate,
        cleaned.offerLetterName,
        cleaned.offerLetterData,
        cleaned.compBand,
        cleaned.compPositioning,
        cleaned.annualPto,
        cleaned.sickLeave,
        cleaned.floatingHolidays,
        cleaned.parentalLeave,
        cleaned.carryoverCap,
        cleaned.policyEffective,
        cleaned.certifications,
        cleaned.backgroundCheck,
        cleaned.safetyTraining,
        cleaned.workAuthorization,
        cleaned.surveyScore,
        cleaned.checkinsScore,
        cleaned.participationScore,
        cleaned.riskAdjustedScore,
        cleaned.photoUrl,
        cleaned.complianceDocumentName,
        cleaned.nextAuditDate,
        cleaned.checklistOffer,
        cleaned.checklistEquipment,
        cleaned.checklistBadges,
        cleaned.checklistOrientation,
        cleaned.checklistBusinessCard,
        cleaned.checklistCustom ?? [],
        cleaned.checklistOfferOwner,
        cleaned.checklistEquipmentOwner,
        cleaned.checklistBadgesOwner,
        cleaned.checklistOrientationOwner,
        cleaned.checklistBusinessCardOwner
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
    setCacheHeader(res, 10);
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
    setCacheHeader(res, 10);
    res.json(result.rows);
  } catch (error) {
    res.status(500).json({ error: 'Unable to load training responses' });
  }
});

app.get('/api/ideas', async (_req, res) => {
  try {
    const result = await getPoolInstance().query(
      `SELECT id, title, type, summary, manager, submitted_at
       FROM tx_ideas
       ORDER BY submitted_at DESC`
    );
    setCacheHeader(res, 10);
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
      `SELECT id, employee_name, type, start_date, end_date, range, status, notes
       FROM tx_leave_requests
       ORDER BY created_at DESC`
    );
    setCacheHeader(res, 10);
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
      `SELECT id, title, amount, category, date, notes, status, employee
       FROM tx_reimbursements
       ORDER BY created_at DESC`
    );
    setCacheHeader(res, 10);
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
      `SELECT id, title, department, location, headcount, level, hire_type, start_date,
              justification, budget_impact, manager, cost_center, approval, submitted_at
       FROM tx_requisitions
       ORDER BY submitted_at DESC`
    );
    setCacheHeader(res, 10);
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
      'SELECT id, title, owner, due, source FROM tx_tasks ORDER BY created_at DESC'
    );
    setCacheHeader(res, 5);
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
      `SELECT id, source, source_id, title, submitted_by, summary, status, note, decided_at
       FROM tx_approvals_completed
       ORDER BY decided_at DESC`
    );
    setCacheHeader(res, 10);
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
