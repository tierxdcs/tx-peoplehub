const { onRequest } = require('firebase-functions/v2/https');
const express = require('express');
const cors = require('cors');
const compression = require('compression');
const { getPool, secrets } = require('./db');
const { warmup } = require('./warmup');

const app = express();
app.use(cors({ origin: true }));
app.use(compression());
app.use(express.json({ limit: '5mb' }));
app.use(express.urlencoded({ extended: true, limit: '5mb' }));

const getPoolInstance = () => getPool();
const cache = {
  homeDashboard: { dataByEmail: {} }
};
const setCacheHeader = (res, seconds) => {
  res.set('Cache-Control', `public, max-age=${seconds}`);
};
const parseLimit = (value, max = 200) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return null;
  }
  return Math.min(Math.floor(parsed), max);
};
const parseOffset = (value) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) {
    return 0;
  }
  return Math.floor(parsed);
};
const buildLimitClause = (params, limit, offset) => {
  if (!limit) {
    return '';
  }
  params.push(limit, offset);
  return ` LIMIT $${params.length - 1} OFFSET $${params.length}`;
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

app.get('/api/users', async (req, res) => {
  const limit = parseLimit(req.query.limit, 300);
  const offset = parseOffset(req.query.offset);
  const status = String(req.query.status ?? '').trim();
  const director = String(req.query.director ?? '').trim();
  const search = String(req.query.search ?? '').trim().toLowerCase();
  try {
    const filters = [];
    const values = [];
    if (status) {
      values.push(status);
      filters.push(`u.status = $${values.length}`);
    }
    if (director) {
      values.push(director);
      filters.push(`u.director = $${values.length}`);
    }
    if (search) {
      values.push(`%${search}%`);
      const idx = values.length;
      filters.push(
        `(LOWER(u.full_name) LIKE $${idx} OR LOWER(u.email) LIKE $${idx} OR LOWER(u.department) LIKE $${idx} OR LOWER(u.role) LIKE $${idx})`
      );
    }
    const where = filters.length ? `WHERE ${filters.join(' AND ')}` : '';
    let limitClause = '';
    if (limit) {
      values.push(limit, offset);
      limitClause = ` LIMIT $${values.length - 1} OFFSET $${values.length}`;
    }
    const result = await getPoolInstance().query(
      `SELECT u.id, u.full_name, u.email, u.department, u.role, u.status, u.director,
              p.employee_id
       FROM tx_users u
       LEFT JOIN tx_employee_profiles p ON LOWER(p.email) = LOWER(u.email)
       ${where}
       ORDER BY u.created_at DESC${limitClause}`,
      values
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
         AND LOWER(status) = 'active'
       LIMIT 1`,
      [normalizedEmail]
    );
    const user = result.rows[0];
    if (!user) {
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

app.post('/api/change-password', async (req, res) => {
  const { email, currentPassword, newPassword } = req.body ?? {};
  const normalizedEmail = String(email ?? '').trim().toLowerCase();
  const current = String(currentPassword ?? '');
  const next = String(newPassword ?? '');
  if (!normalizedEmail || !current || !next) {
    res.status(400).json({ error: 'Email, current password, and new password are required.' });
    return;
  }
  try {
    const result = await getPoolInstance().query(
      `SELECT id, password
       FROM tx_users
       WHERE LOWER(email) = $1
         AND LOWER(status) = 'active'
       LIMIT 1`,
      [normalizedEmail]
    );
    const user = result.rows[0];
    if (!user) {
      res.status(401).json({ error: 'Invalid credentials' });
      return;
    }
    const storedPassword = user.password ?? '';
    if (storedPassword && storedPassword !== current) {
      res.status(401).json({ error: 'Invalid credentials' });
      return;
    }
    await getPoolInstance().query(
      'UPDATE tx_users SET password = $1, updated_at = NOW() WHERE id = $2',
      [next, user.id]
    );
    res.json({ ok: true });
  } catch (error) {
    res.status(500).json({ error: 'Unable to update password' });
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

app.get('/api/employee-profiles', async (req, res) => {
  const email = String(req.query.email ?? '').trim().toLowerCase();
  const employeeId = String(req.query.employeeId ?? '').trim();
  try {
    const result = email
      ? await getPoolInstance().query(
          `SELECT * FROM tx_employee_profiles
           WHERE LOWER(email) = $1
           ORDER BY updated_at DESC NULLS LAST
           LIMIT 1`,
          [email]
        )
      : employeeId
      ? await getPoolInstance().query(
          `SELECT * FROM tx_employee_profiles
           WHERE employee_id = $1
           ORDER BY updated_at DESC NULLS LAST
           LIMIT 1`,
          [employeeId]
        )
      : await getPoolInstance().query(
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

app.get('/api/home-dashboard', async (req, res) => {
  const now = Date.now();
  const emailKey = String(req.query.employeeEmail ?? '')
    .trim()
    .toLowerCase() || 'all';
  const light = String(req.query.light ?? '').trim() === '1';
  const cached = cache.homeDashboard.dataByEmail[emailKey];
  if (cached && cached.expiresAt > now) {
    setCacheHeader(res, 60);
    res.json(cached.data);
    return;
  }
  try {
    const pool = getPoolInstance();
    const userResult = emailKey !== 'all'
      ? await pool.query(
          `SELECT full_name, director
           FROM tx_users
           WHERE LOWER(email) = $1
           LIMIT 1`,
          [emailKey]
        )
      : { rows: [] };
    const user = userResult.rows[0];
    const isDirector = user?.director === 'Yes';
    const profileResult = emailKey !== 'all'
      ? await pool.query(
          `SELECT full_name, employee_id, email, location, department, job_title, status,
                  manager, photo_url, survey_score, checkins_score, participation_score,
                  risk_adjusted_score, annual_pto, sick_leave, floating_holidays,
                  parental_leave, carryover_cap
           FROM tx_employee_profiles
           WHERE LOWER(email) = $1
           ORDER BY updated_at DESC NULLS LAST
           LIMIT 1`,
          [emailKey]
        )
      : await pool.query(
          `SELECT full_name, employee_id, email, location, department, job_title, status,
                  manager, photo_url, survey_score, checkins_score, participation_score,
                  risk_adjusted_score, annual_pto, sick_leave, floating_holidays,
                  parental_leave, carryover_cap
           FROM tx_employee_profiles
           ORDER BY updated_at DESC NULLS LAST
           LIMIT 1`
        );
    const profile = profileResult.rows[0] ?? null;
    const displayName = user?.full_name ?? profile?.full_name ?? '';

    const [
      activeUsersResult,
      tasksResult,
      leavesResult,
      ideasResult,
      reimbursementsResult,
      assignmentsResult,
      approvalsLeavesResult,
      approvalsReimbursementsResult,
      approvalsRequisitionsResult
    ] = await Promise.all([
      pool.query('SELECT COUNT(*) AS count FROM tx_users WHERE status = $1', ['Active']),
      emailKey !== 'all'
        ? pool.query(
            `SELECT title FROM tx_tasks
             WHERE owner_email = $1 OR owner = $2
             ORDER BY created_at DESC
             LIMIT 3`,
            [emailKey, displayName]
          )
        : pool.query('SELECT title FROM tx_tasks ORDER BY created_at DESC LIMIT 3'),
      !light
        ? emailKey !== 'all'
          ? pool.query(
              `SELECT id, employee_name, employee_email, type, start_date, end_date, range, status, notes
               FROM tx_leave_requests
               WHERE LOWER(status) LIKE 'pending%'
                 AND (employee_email = $1 OR employee_name = $2)
               ORDER BY created_at DESC
               LIMIT 6`,
              [emailKey, profile?.full_name ?? '']
            )
          : pool.query(
              `SELECT id, employee_name, employee_email, type, start_date, end_date, range, status, notes
               FROM tx_leave_requests
               WHERE LOWER(status) LIKE 'pending%'
               ORDER BY created_at DESC
               LIMIT 6`
            )
        : Promise.resolve({ rows: [] }),
      !light
        ? emailKey !== 'all'
          ? pool.query(
              `SELECT id, title, type, summary, manager, employee_email, submitted_at
               FROM tx_ideas
               WHERE employee_email = $1
               ORDER BY submitted_at DESC
               LIMIT 6`,
              [emailKey]
            )
          : pool.query(
              `SELECT id, title, type, summary, manager, employee_email, submitted_at
               FROM tx_ideas
               ORDER BY submitted_at DESC
               LIMIT 6`
            )
        : Promise.resolve({ rows: [] }),
      emailKey !== 'all'
        ? pool.query(
            `SELECT COUNT(*) AS count
             FROM tx_reimbursements
             WHERE LOWER(status) LIKE 'pending%'
               AND (
                 employee_email = $1
                 OR ((employee_email IS NULL OR employee_email = '') AND employee = $2)
               )`,
            [emailKey, displayName]
          )
        : pool.query(
            `SELECT COUNT(*) AS count
             FROM tx_reimbursements
             WHERE LOWER(status) LIKE 'pending%'`
          ),
      pool.query('SELECT COUNT(*) AS count FROM tx_training_assignments')
      ,
      !light && isDirector
        ? pool.query(
            `SELECT id, type, range
             FROM tx_leave_requests
             WHERE LOWER(status) LIKE 'pending%'
             ORDER BY created_at DESC
             LIMIT 3`
          )
        : Promise.resolve({ rows: [] }),
      !light && isDirector
        ? pool.query(
            `SELECT id, category, amount
             FROM tx_reimbursements
             WHERE LOWER(status) LIKE 'pending%'
             ORDER BY created_at DESC
             LIMIT 3`
          )
        : Promise.resolve({ rows: [] }),
      !light && isDirector
        ? pool.query(
            `SELECT id, title, headcount
             FROM tx_requisitions
             WHERE LOWER(approval) LIKE 'pending%'
             ORDER BY submitted_at DESC
             LIMIT 3`
          )
        : Promise.resolve({ rows: [] })
    ]);

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
    const approvals = !light && isDirector
      ? [
          ...(approvalsLeavesResult.rows ?? []).map((row) => ({
            title: `Leave request · ${row.type ?? 'Leave'}`
          })),
          ...(approvalsReimbursementsResult.rows ?? []).map((row) => ({
            title: `Reimbursement · ${row.category ?? 'Expense'}`
          })),
          ...(approvalsRequisitionsResult.rows ?? []).map((row) => ({
            title: `Resource requisition · ${row.title ?? 'Request'}`
          }))
        ]
      : [];
    const dashboardTasks = [
      ...(tasksResult.rows ?? []),
      ...approvals
    ].slice(0, 3);

    const payload = {
      activeUserCount: Number(activeUsersResult.rows[0]?.count ?? 0),
      profile,
      tasks: dashboardTasks,
      pendingLeaves: leavesResult.rows ?? [],
      ideas: ideasResult.rows ?? [],
      reimbursements: { pending: Number(reimbursementsResult.rows[0]?.count ?? 0) },
      training: { completed, total, coverage }
    };
    cache.homeDashboard.dataByEmail[emailKey] = { data: payload, expiresAt: now + 60000 };
    setCacheHeader(res, 60);
    res.json(payload);
  } catch (error) {
    res.status(500).json({ error: 'Unable to load home dashboard' });
  }
});

app.get('/api/home-dashboard-lite', async (req, res) => {
  const now = Date.now();
  const emailKey = String(req.query.employeeEmail ?? '')
    .trim()
    .toLowerCase() || 'all';
  const cacheKey = `lite:${emailKey}`;
  const cached = cache.homeDashboard.dataByEmail[cacheKey];
  if (cached && cached.expiresAt > now) {
    setCacheHeader(res, 60);
    res.json(cached.data);
    return;
  }
  try {
    const pool = getPoolInstance();
    const profileResult = emailKey !== 'all'
      ? await pool.query(
          `SELECT full_name, employee_id, email, location, department, job_title, status,
                  manager, photo_url, survey_score, checkins_score, participation_score,
                  risk_adjusted_score, annual_pto, sick_leave, floating_holidays,
                  parental_leave, carryover_cap
           FROM tx_employee_profiles
           WHERE LOWER(email) = $1
           ORDER BY updated_at DESC NULLS LAST
           LIMIT 1`,
          [emailKey]
        )
      : await pool.query(
          `SELECT full_name, employee_id, email, location, department, job_title, status,
                  manager, photo_url, survey_score, checkins_score, participation_score,
                  risk_adjusted_score, annual_pto, sick_leave, floating_holidays,
                  parental_leave, carryover_cap
           FROM tx_employee_profiles
           ORDER BY updated_at DESC NULLS LAST
           LIMIT 1`
        );
    const profile = profileResult.rows[0] ?? null;
    const activeUsersResult = await pool.query(
      'SELECT COUNT(*) AS count FROM tx_users WHERE status = $1',
      ['Active']
    );
    let completed = 0;
    if (profile?.full_name) {
      const responsesResult = await pool.query(
        'SELECT COUNT(*) AS count FROM tx_training_responses WHERE employee = $1',
        [profile.full_name]
      );
      completed = Number(responsesResult.rows[0]?.count ?? 0);
    }
    const assignmentsResult = await pool.query('SELECT COUNT(*) AS count FROM tx_training_assignments');
    const total = Number(assignmentsResult.rows[0]?.count ?? 0);
    const coverage = total ? Math.round((completed / total) * 100) : 0;

    const payload = {
      activeUserCount: Number(activeUsersResult.rows[0]?.count ?? 0),
      profile,
      tasks: [],
      pendingLeaves: [],
      ideas: [],
      reimbursements: { pending: 0 },
      training: { completed, total, coverage }
    };
    cache.homeDashboard.dataByEmail[cacheKey] = { data: payload, expiresAt: now + 60000 };
    setCacheHeader(res, 60);
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
    if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
      return value;
    }
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) {
      return null;
    }
    return parsed.toISOString().slice(0, 10);
  };
  const normalizeText = (value) => {
    if (value === '' || value === null || value === undefined) {
      return null;
    }
    return String(value);
  };
  const cleaned = {
    ...profile,
    startDate: normalizeDate(profile.startDate),
    compensationEffectiveDate: normalizeDate(profile.compensationEffectiveDate),
    policyEffective: normalizeDate(profile.policyEffective),
    nextAuditDate: normalizeDate(profile.nextAuditDate),
    baseSalary: normalizeNumber(profile.baseSalary),
    variablePayPercent: normalizeNumber(profile.variablePayPercent),
    annualPto: normalizeInt(profile.annualPto),
    sickLeave: normalizeInt(profile.sickLeave),
    floatingHolidays: normalizeInt(profile.floatingHolidays),
    parentalLeave: normalizeInt(profile.parentalLeave),
    carryoverCap: normalizeInt(profile.carryoverCap),
    surveyScore: normalizeNumber(profile.surveyScore),
    checkinsScore: normalizeNumber(profile.checkinsScore),
    participationScore: normalizeNumber(profile.participationScore),
    riskAdjustedScore: normalizeNumber(profile.riskAdjustedScore),
    offerLetterData: normalizeText(profile.offerLetterData),
    photoUrl: normalizeText(profile.photoUrl),
    checklistCustom: Array.isArray(profile.checklistCustom) ? profile.checklistCustom : []
  };
  try {
    const result = await getPoolInstance().query(
      `INSERT INTO tx_employee_profiles (
        full_name, employee_id, email, location, department, start_date, job_title, role,
        manager, manager_level2, manager_level3, manager_level4, ceo, director,
        employment_type, status, cost_center, base_salary, pay_schedule, bonus_eligible,
        variable_pay_percent, equity_plan, benefits_tier, medical_status, dental_status,
        vision_status, compensation_effective_date, offer_letter_name, offer_letter_data,
        comp_band, comp_positioning, annual_pto, sick_leave,
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
        $21,$22,$23,$24,$25,
        $26,$27,$28,$29,$30,
        $31,$32,$33,$34,
        $35,$36,$37,$38,$39,
        $40,$41,$42,$43,$44,
        $45,$46,$47,$48,$49,
        $50,$51,$52,$53,$54,
        $55,$56,$57,$58,$59,NOW()
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
        variable_pay_percent = EXCLUDED.variable_pay_percent,
        pay_schedule = EXCLUDED.pay_schedule,
        bonus_eligible = EXCLUDED.bonus_eligible,
        equity_plan = EXCLUDED.equity_plan,
        benefits_tier = EXCLUDED.benefits_tier,
        medical_status = EXCLUDED.medical_status,
        dental_status = EXCLUDED.dental_status,
        vision_status = EXCLUDED.vision_status,
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
        cleaned.variablePayPercent,
        cleaned.equityPlan,
        cleaned.benefitsTier,
        cleaned.medicalStatus ?? 'N/A',
        cleaned.dentalStatus ?? 'N/A',
        cleaned.visionStatus ?? 'N/A',
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
    res.status(500).json({
      error: 'Unable to save employee profile',
      detail: error?.message ?? 'Unknown error'
    });
  }
});

app.get('/api/training-assignments', async (req, res) => {
  const limit = parseLimit(req.query.limit, 200);
  const offset = parseOffset(req.query.offset);
  try {
    const values = [];
    let limitClause = '';
    if (limit) {
      values.push(limit, offset);
      limitClause = ` LIMIT $1 OFFSET $2`;
    }
    const result = await getPoolInstance().query(
      `SELECT * FROM tx_training_assignments ORDER BY created_at DESC${limitClause}`,
      values
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
    const title = String(assignment.title ?? '').trim();
    const rawDueDate = assignment.dueDate ? String(assignment.dueDate) : '';
    const dueDate = rawDueDate.length > 10 ? rawDueDate.slice(0, 10) : rawDueDate;
    const validDate = /^\d{4}-\d{2}-\d{2}$/.test(dueDate);
    if (!title || !dueDate || !validDate) {
      res.status(400).json({ error: 'Title and valid due date are required' });
      return;
    }
    const audience = String(assignment.audience ?? 'All employees');
    const department = String(assignment.department ?? 'All departments');
    const questions = Array.isArray(assignment.questions) ? assignment.questions : [];
    const participants = Array.isArray(assignment.participants) ? assignment.participants : [];
    const questionsJson = JSON.stringify(questions);
    const participantsJson = JSON.stringify(participants);
    const result = await getPoolInstance().query(
      `INSERT INTO tx_training_assignments
       (title, audience, department, due_date, questions, completed, total, participants)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
       RETURNING *`,
      [
        title,
        audience,
        department,
        dueDate,
        questionsJson,
        Number(assignment.completed ?? 0),
        Number(assignment.total ?? 0),
        participantsJson
      ]
    );
    res.json(result.rows[0]);
  } catch (error) {
    console.error('training-assignments', error);
    res.status(500).json({
      error: 'Unable to save training assignment',
      details: error?.message ?? 'Unknown error'
    });
  }
});

app.put('/api/training-assignments/:id', async (req, res) => {
  const { id } = req.params;
  const assignment = req.body;
  try {
    const questions = Array.isArray(assignment.questions) ? assignment.questions : [];
    const participants = Array.isArray(assignment.participants) ? assignment.participants : [];
    const result = await getPoolInstance().query(
      `UPDATE tx_training_assignments
       SET questions = $1, participants = $2, completed = $3, total = $4
       WHERE id = $5
       RETURNING *`,
      [
        JSON.stringify(questions),
        JSON.stringify(participants),
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
    const responsesJson = JSON.stringify(responses ?? {});
    const result = await getPoolInstance().query(
      `INSERT INTO tx_training_responses (assignment_id, employee, responses, score, passed)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING *`,
      [assignmentId, employee, responsesJson, score ?? null, passed ?? false]
    );
    res.json(result.rows[0]);
  } catch (error) {
    console.error('training-responses', error);
    res.status(500).json({
      error: 'Unable to save training responses',
      details: error?.message ?? 'Unknown error'
    });
  }
});

app.get('/api/training-responses', async (req, res) => {
  const { assignmentId, employee } = req.query;
  const limit = parseLimit(req.query.limit, 200);
  const offset = parseOffset(req.query.offset);
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
    let limitClause = '';
    if (limit) {
      values.push(limit, offset);
      limitClause = ` LIMIT $${values.length - 1} OFFSET $${values.length}`;
    }
    const result = await getPoolInstance().query(
      `SELECT * FROM tx_training_responses ${where} ORDER BY submitted_at DESC${limitClause}`,
      values
    );
    setCacheHeader(res, 10);
    res.json(result.rows);
  } catch (error) {
    res.status(500).json({ error: 'Unable to load training responses' });
  }
});

app.get('/api/ideas', async (req, res) => {
  const employeeEmail = String(req.query.employeeEmail ?? '').trim().toLowerCase();
  const limit = parseLimit(req.query.limit, 200);
  const offset = parseOffset(req.query.offset);
  try {
    const result = employeeEmail
      ? await getPoolInstance().query(
          `SELECT id, title, type, summary, manager, employee_email, submitted_at
           FROM tx_ideas
           WHERE employee_email = $1
           ORDER BY submitted_at DESC${buildLimitClause([employeeEmail], limit, offset)}`,
          [employeeEmail, ...(limit ? [limit, offset] : [])]
        )
      : await getPoolInstance().query(
          `SELECT id, title, type, summary, manager, employee_email, submitted_at
           FROM tx_ideas
           ORDER BY submitted_at DESC${buildLimitClause([], limit, offset)}`,
          limit ? [limit, offset] : []
        );
    setCacheHeader(res, 10);
    res.json(result.rows);
  } catch (error) {
    res.status(500).json({ error: 'Unable to load ideas' });
  }
});

app.post('/api/ideas', async (req, res) => {
  const idea = req.body;
  const employeeEmail = String(idea.employeeEmail ?? '').trim().toLowerCase() || null;
  try {
    const result = await getPoolInstance().query(
      `INSERT INTO tx_ideas (title, type, summary, manager, employee_email)
       VALUES ($1,$2,$3,$4,$5)
       RETURNING *`,
      [idea.title, idea.type, idea.summary, idea.manager, employeeEmail]
    );
    res.json(result.rows[0]);
  } catch (error) {
    res.status(500).json({ error: 'Unable to save idea' });
  }
});

app.get('/api/leaves', async (req, res) => {
  const employeeEmail = String(req.query.employeeEmail ?? '').trim().toLowerCase();
  const employeeName = String(req.query.employeeName ?? '').trim();
  const managerName = String(req.query.managerName ?? '').trim();
  const limit = parseLimit(req.query.limit, 200);
  const offset = parseOffset(req.query.offset);
  try {
    let result;
    if (managerName) {
      const params = [managerName.toLowerCase()];
      result = await getPoolInstance().query(
        `SELECT l.id, l.employee_name, l.employee_email, l.type, l.start_date, l.end_date, l.range, l.status, l.notes
         FROM tx_leave_requests l
         LEFT JOIN tx_employee_profiles p ON LOWER(p.email) = LOWER(l.employee_email)
         WHERE LOWER(p.manager) = $1
         ORDER BY l.created_at DESC${buildLimitClause(params, limit, offset)}`,
        [...params, ...(limit ? [limit, offset] : [])]
      );
    } else if (employeeEmail || employeeName) {
      result = await getPoolInstance().query(
        `SELECT id, employee_name, employee_email, type, start_date, end_date, range, status, notes
         FROM tx_leave_requests
         WHERE (${employeeEmail ? 'employee_email = $1' : '$1 = \'\' OR employee_email = $1'})
           AND (${employeeName ? 'employee_name = $2' : '$2 = \'\' OR employee_name = $2'})
         ORDER BY created_at DESC${buildLimitClause([employeeEmail, employeeName], limit, offset)}`,
        [employeeEmail, employeeName, ...(limit ? [limit, offset] : [])]
      );
    } else {
      result = await getPoolInstance().query(
        `SELECT id, employee_name, employee_email, type, start_date, end_date, range, status, notes
         FROM tx_leave_requests
         ORDER BY created_at DESC${buildLimitClause([], limit, offset)}`,
        limit ? [limit, offset] : []
      );
    }
    setCacheHeader(res, 10);
    res.json(result.rows);
  } catch (error) {
    res.status(500).json({ error: 'Unable to load leave requests' });
  }
});

app.post('/api/leaves', async (req, res) => {
  const leave = req.body;
  const employeeEmail = String(leave.employeeEmail ?? '').trim().toLowerCase() || null;
  const status = leave.status || 'Pending manager approval';
  try {
    const result = await getPoolInstance().query(
      `INSERT INTO tx_leave_requests
       (employee_name, employee_email, type, start_date, end_date, range, status, notes)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
       RETURNING *`,
      [
        leave.employeeName,
        employeeEmail,
        leave.type,
        leave.startDate,
        leave.endDate,
        leave.range,
        status,
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
    const pool = getPoolInstance();
    const existing = await pool.query(
      `SELECT id, employee_email, type, start_date, end_date, status
       FROM tx_leave_requests
       WHERE id = $1`,
      [id]
    );
    const row = existing.rows[0];
    if (!row) {
      res.status(404).json({ error: 'Leave request not found' });
      return;
    }
    const updateResult = await pool.query(
      `UPDATE tx_leave_requests SET status = $1 WHERE id = $2 RETURNING *`,
      [status, id]
    );
    const nextStatus = String(status || '').toLowerCase();
    const previousStatus = String(row.status || '').toLowerCase();
    if (
      nextStatus === 'approved' &&
      previousStatus !== 'approved' &&
      row.employee_email
    ) {
      const start = new Date(row.start_date);
      const end = new Date(row.end_date);
      const msPerDay = 1000 * 60 * 60 * 24;
      const diff = Math.floor((end.getTime() - start.getTime()) / msPerDay);
      const days = Math.max(1, diff + 1);
      let column = '';
      if (row.type === 'PTO') {
        column = 'annual_pto';
      } else if (row.type === 'Sick') {
        column = 'sick_leave';
      } else if (row.type === 'Floating holidays') {
        column = 'floating_holidays';
      } else if (row.type === 'Parental leave') {
        column = 'parental_leave';
      }
      if (column) {
        await pool.query(
          `UPDATE tx_employee_profiles
           SET ${column} = GREATEST(COALESCE(${column}, 0) - $1, 0),
               updated_at = NOW()
           WHERE LOWER(email) = $2`,
          [days, String(row.employee_email).toLowerCase()]
        );
      }
    }
    res.json(updateResult.rows[0]);
  } catch (error) {
    res.status(500).json({ error: 'Unable to update leave request' });
  }
});

app.get('/api/reimbursements', async (req, res) => {
  const employeeEmail = String(req.query.employeeEmail ?? '').trim().toLowerCase();
  const employeeName = String(req.query.employeeName ?? '').trim();
  const scope = String(req.query.scope ?? '').trim().toLowerCase();
  const includeEmpty = String(req.query.includeEmpty ?? '').trim().toLowerCase() === 'true';
  const limit = parseLimit(req.query.limit, 200);
  const offset = parseOffset(req.query.offset);
  try {
    const result = scope === 'all'
      ? await getPoolInstance().query(
          `SELECT id, title, amount, category, date, notes, status, employee, employee_email
           FROM tx_reimbursements
           ${includeEmpty ? '' : 'WHERE status IS NOT NULL'}
           ORDER BY created_at DESC${buildLimitClause([], limit, offset)}`,
          limit ? [limit, offset] : []
        )
      : employeeEmail
      ? await getPoolInstance().query(
          `SELECT id, title, amount, category, date, notes, status, employee, employee_email
           FROM tx_reimbursements
           WHERE ${
             includeEmpty
               ? '(employee_email = $1 OR ((employee_email IS NULL OR employee_email = \'\') AND employee = $2))'
               : '(status IS NOT NULL AND (employee_email = $1 OR ((employee_email IS NULL OR employee_email = \'\') AND employee = $2)))'
           }
           ORDER BY created_at DESC${buildLimitClause([employeeEmail, employeeName], limit, offset)}`,
          [employeeEmail, employeeName, ...(limit ? [limit, offset] : [])]
        )
      : { rows: [] };
    setCacheHeader(res, 10);
    res.json(result.rows);
  } catch (error) {
    res.status(500).json({ error: 'Unable to load reimbursements' });
  }
});

app.post('/api/reimbursements', async (req, res) => {
  const item = req.body;
  try {
    const status = item.status || 'Pending CFO approval';
    const result = await getPoolInstance().query(
      `INSERT INTO tx_reimbursements
       (title, amount, category, date, notes, status, employee, employee_email)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
       RETURNING *`,
      [
        item.title,
        item.amount,
        item.category,
        item.date,
        item.notes,
        status,
        item.employee,
        item.employeeEmail ?? null
      ]
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

app.get('/api/requisitions', async (req, res) => {
  const requesterEmail = String(req.query.requesterEmail ?? '').trim().toLowerCase();
  const scope = String(req.query.scope ?? '').trim().toLowerCase();
  const limit = parseLimit(req.query.limit, 200);
  const offset = parseOffset(req.query.offset);
  try {
    const result = scope === 'all'
      ? await getPoolInstance().query(
          `SELECT id, title, department, location, headcount, level, hire_type, start_date,
                  justification, budget_impact, manager, cost_center, approval, requester_email, submitted_at
           FROM tx_requisitions
           ORDER BY submitted_at DESC${buildLimitClause([], limit, offset)}`,
          limit ? [limit, offset] : []
        )
      : requesterEmail
      ? await getPoolInstance().query(
          `SELECT id, title, department, location, headcount, level, hire_type, start_date,
                  justification, budget_impact, manager, cost_center, approval, requester_email, submitted_at
           FROM tx_requisitions
           WHERE requester_email = $1
           ORDER BY submitted_at DESC${buildLimitClause([requesterEmail], limit, offset)}`,
          [requesterEmail, ...(limit ? [limit, offset] : [])]
        )
      : { rows: [] };
    setCacheHeader(res, 10);
    res.json(result.rows);
  } catch (error) {
    res.status(500).json({ error: 'Unable to load requisitions' });
  }
});

app.post('/api/requisitions', async (req, res) => {
  const item = req.body;
  const requesterEmail = String(item.requesterEmail ?? '').trim().toLowerCase() || null;
  try {
    const approval = item.approval || 'Pending Board Directors approval';
    const result = await getPoolInstance().query(
      `INSERT INTO tx_requisitions
       (title, department, location, headcount, level, hire_type, start_date, justification, budget_impact, manager, cost_center, approval, requester_email)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
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
        approval,
        requesterEmail
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

app.get('/api/tasks', async (req, res) => {
  const ownerEmail = String(req.query.ownerEmail ?? '').trim().toLowerCase();
  const ownerName = String(req.query.ownerName ?? '').trim();
  const limit = parseLimit(req.query.limit, 200);
  const offset = parseOffset(req.query.offset);
  try {
    const filters = [];
    const values = [];
    if (ownerEmail) {
      values.push(ownerEmail);
      filters.push(`owner_email = $${values.length}`);
    }
    if (ownerName) {
      values.push(ownerName);
      filters.push(`owner = $${values.length}`);
    }
    const where = filters.length ? `WHERE ${filters.join(' OR ')}` : '';
    let limitClause = '';
    if (limit) {
      values.push(limit, offset);
      limitClause = ` LIMIT $${values.length - 1} OFFSET $${values.length}`;
    }
    const result = await getPoolInstance().query(
      `SELECT id, title, owner, owner_email, due, source
       FROM tx_tasks
       ${where}
       ORDER BY created_at DESC${limitClause}`,
      values
    );
    setCacheHeader(res, 5);
    res.json(result.rows);
  } catch (error) {
    res.status(500).json({ error: 'Unable to load tasks' });
  }
});

app.post('/api/tasks', async (req, res) => {
  const item = req.body;
  const ownerEmail = String(item.ownerEmail ?? '').trim().toLowerCase() || null;
  try {
    const result = await getPoolInstance().query(
      `INSERT INTO tx_tasks (title, owner, owner_email, due, source)
       VALUES ($1,$2,$3,$4,$5)
       RETURNING *`,
      [item.title, item.owner, ownerEmail, item.due, item.source]
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

app.get('/api/approvals/completed', async (req, res) => {
  const limit = parseLimit(req.query.limit, 200);
  const offset = parseOffset(req.query.offset);
  try {
    const values = [];
    let limitClause = '';
    if (limit) {
      values.push(limit, offset);
      limitClause = ` LIMIT $1 OFFSET $2`;
    }
    const result = await getPoolInstance().query(
      `SELECT id, source, source_id, title, submitted_by, summary, status, note, decided_at
       FROM tx_approvals_completed
       ORDER BY decided_at DESC${limitClause}`,
      values
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
    invoker: ['public'],
    secrets,
    region: 'asia-south1',
    minInstances: 1
  },
  app
);

exports.warmup = warmup;
