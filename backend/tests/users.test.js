'use strict';

// Step 6b — GET /api/users list endpoint (powers the frontend dev user picker).
// Registers a user via the API, then asserts it appears in the list.

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const pool = require('../src/config/database');
const app = require('../src/app');

let server;
let base;
before(async () => {
  server = http.createServer(app);
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(async () => {
  if (server) await new Promise((r) => server.close(r));
  await pool.end();
});

async function apiJson(method, path, body) {
  const res = await fetch(base + path, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  let json = null;
  try { json = await res.json(); } catch { /* empty */ }
  return { status: res.status, body: json };
}

test('GET /api/users lists registered users (no sensitive fields)', async () => {
  const tag = `${process.pid}_${process.hrtime.bigint().toString(36)}`;
  const email = `picker_${tag}@test.com`;
  const username = `picker_${tag}`; // username is UNIQUE — keep it per-run to stay rerunnable
  const created = await apiJson('POST', '/api/users', { username, email });
  assert.equal(created.status, 201);

  const list = await apiJson('GET', '/api/users');
  assert.equal(list.status, 200);
  assert.equal(list.body.status, 'success');
  assert.equal(typeof list.body.results, 'number');
  const found = list.body.data.find((u) => u.email === email);
  assert.ok(found, 'registered user appears in list');
  assert.equal(found.username, username);
  // Assert the exact shape so a future `SELECT *` can't silently leak new columns.
  assert.deepEqual(Object.keys(found).sort(), ['created_at', 'email', 'id', 'username']);
});
