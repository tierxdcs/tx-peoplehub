const { Pool } = require('pg');
const { defineSecret } = require('firebase-functions/params');

const PGHOST = defineSecret('PGHOST');
const PGPORT = defineSecret('PGPORT');
const PGUSER = defineSecret('PGUSER');
const PGPASSWORD = defineSecret('PGPASSWORD');
const PGDATABASE = defineSecret('PGDATABASE');
const PGSSLMODE = defineSecret('PGSSLMODE');

let pool;

const getPool = () => {
  if (!pool) {
    pool = new Pool({
      host: PGHOST.value(),
      port: Number(PGPORT.value() || 5432),
      user: PGUSER.value(),
      password: PGPASSWORD.value(),
      database: PGDATABASE.value(),
      ssl: PGSSLMODE.value() === 'require' ? { rejectUnauthorized: false } : false
    });
  }
  return pool;
};

module.exports = {
  getPool,
  secrets: [PGHOST, PGPORT, PGUSER, PGPASSWORD, PGDATABASE, PGSSLMODE]
};
