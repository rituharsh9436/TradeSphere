'use strict';

// Pure unit tests for the marketdata subsystem — no DB, no network. Sources and
// the worker take injected deps so behavior is deterministic.

const { test } = require('node:test');
const assert = require('node:assert/strict');

const createSimulatedTickSource = require('../src/marketdata/simulatedTickSource');

test('simulatedTickSource: tickOnce emits one 4dp tick per seed via rng', () => {
  const fixedNow = new Date('2020-05-01T12:00:00.000Z');
  const src = createSimulatedTickSource({
    seeds: [{ symbol: 'AAPL', price: '100' }, { symbol: 'MSFT', price: '200' }],
    volatility: 0.01,
    rng: () => 1, // delta = (1*2 - 1) * 0.01 = +0.01 -> +1%
    now: () => fixedNow,
  });

  const ticks = [];
  src.onTick((t) => ticks.push(t));
  src.tickOnce();

  assert.equal(ticks.length, 2);
  const aapl = ticks.find((t) => t.symbol === 'AAPL');
  assert.equal(aapl.price, '101.0000'); // 100 * 1.01
  assert.equal(aapl.ts, fixedNow.toISOString());
  const msft = ticks.find((t) => t.symbol === 'MSFT');
  assert.equal(msft.price, '202.0000'); // 200 * 1.01
});

test('simulatedTickSource: price never goes negative', () => {
  const src = createSimulatedTickSource({
    seeds: [{ symbol: 'AAPL', price: '0.01' }],
    volatility: 1, // huge swings
    rng: () => 0, // delta = (0*2 - 1) * 1 = -1 -> -100%
  });
  let last;
  src.onTick((t) => { last = t; });
  src.tickOnce();
  assert.equal(last.price, '0.0000');
});
