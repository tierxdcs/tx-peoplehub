const { onRequest } = require('firebase-functions/v2/https');
const { defineSecret } = require('firebase-functions/params');
const express = require('express');
const cors = require('cors');
const { Pool } = require('pg');

const app = express();
app.use(cors({ origin: true }));
app.use(express.json());

const PGHOST = defineSecret('PGHOST');
const PGPORT = defineSecret('PGPORT');
const PGUSER = defineSecret('PGUSER');
const PGPASSWORD = defineSecret('PGPASSWORD');
const PGDATABASE = defineSecret('PGDATABASE');
const PGSSLMODE = defineSecret('PGSSLMODE');

const pool = new Pool({
  host: PGHOST.value(),
  port: Number(PGPORT.value() || 5432),
  user: PGUSER.value(),
  password: PGPASSWORD.value(),
  database: PGDATABASE.value(),
  ssl: PGSSLMODE.value() === 'require' ? { rejectUnauthorized: false } : false
});

app.get('/api/health', async (_req, res) => {
  try {
    await pool.query('SELECT 1');
    res.json({ ok: true, status: 'connected' });
  } catch (error) {
    res.status(500).json({ ok: false, error: 'Database connection failed' });
  }
});

app.get('/api/info', async (_req, res) => {
  try {
    const result = await pool.query(
      "SELECT table_schema, table_name FROM information_schema.tables WHERE table_schema NOT IN ('pg_catalog', 'information_schema') ORDER BY table_schema, table_name"
    );
    res.json({ tables: result.rows });
  } catch (error) {
    res.status(500).json({ error: 'Unable to read schema' });
  }
});

exports.api = onRequest(
  {
    cors: true,
    secrets: [PGHOST, PGPORT, PGUSER, PGPASSWORD, PGDATABASE, PGSSLMODE]
  },
  app
);
