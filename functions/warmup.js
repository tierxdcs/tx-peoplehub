const { onSchedule } = require('firebase-functions/v2/scheduler');
const { getPool } = require('./db');

const warmup = onSchedule('every 5 minutes', async () => {
  try {
    await getPool().query('SELECT 1');
  } catch (error) {
    console.error('warmup', error);
  }
});

module.exports = { warmup };
