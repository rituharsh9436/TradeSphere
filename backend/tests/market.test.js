'use strict';

// Step 6a — price ingestion & streaming. Boots the app in-process and exercises
// the schema, repositories, candle aggregation, REST endpoints and WS broadcast.
// Assumes schema initialized via `npm run db:reset` (seed AAPL=195, MSFT=430,
// TSLA=250). Isolated by unique time windows so it is order-independent.

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const pool = require('../src/config/database');

after(async () => {
  await pool.end();
});

test('price_history table exists with expected columns', async () => {
  const { rows } = await pool.query(
    `SELECT column_name, data_type
     FROM information_schema.columns
     WHERE table_name = 'price_history'
     ORDER BY column_name`
  );
  const cols = Object.fromEntries(rows.map((r) => [r.column_name, r.data_type]));
  assert.ok(cols.id, 'id column present');
  assert.ok(cols.asset_id, 'asset_id column present');
  assert.equal(cols.price, 'numeric');
  assert.match(cols.ts, /timestamp/);
});
