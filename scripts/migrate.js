const fs = require('fs');
const path = require('path');
const { Client } = require('../functions/node_modules/pg');

const schemaPath = path.join(__dirname, '../db/schema.sql');
const sql = fs.readFileSync(schemaPath, 'utf8');

const client = new Client({
  host: process.env.PGHOST,
  port: Number(process.env.PGPORT || 5432),
  user: process.env.PGUSER,
  password: process.env.PGPASSWORD,
  database: process.env.PGDATABASE,
  ssl: process.env.PGSSLMODE === 'require' ? { rejectUnauthorized: false } : false
});

(async () => {
  try {
    await client.connect();
    await client.query(sql);
    console.log('Schema applied');
  } catch (error) {
    console.error('Migration failed', error);
    process.exitCode = 1;
  } finally {
    await client.end();
  }
})();
