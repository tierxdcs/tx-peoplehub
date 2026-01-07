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

exports.api = onRequest(
  {
    cors: true,
    secrets
  },
  app
);
