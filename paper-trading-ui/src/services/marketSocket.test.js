import { test, expect, vi } from 'vitest';
import { createMarketSocket } from './marketSocket';

// Minimal fake WebSocket capturing handlers so we can drive events by hand.
class FakeWS {
  constructor(url) { this.url = url; FakeWS.last = this; this.onmessage = null; this.onclose = null; this.onopen = null; this.closed = false; }
  close() { this.closed = true; if (this.onclose) this.onclose(); }
}

test('createMarketSocket dispatches tick frames to subscribers', () => {
  const sock = createMarketSocket('ws://x/ws/market', { WebSocketImpl: FakeWS });
  const ticks = [];
  sock.subscribe((t) => ticks.push(t));

  FakeWS.last.onmessage({ data: JSON.stringify({ type: 'tick', symbol: 'AAPL', price: '195.0000', ts: 't1' }) });
  FakeWS.last.onmessage({ data: JSON.stringify({ type: 'ping' }) }); // ignored
  FakeWS.last.onmessage({ data: 'not json' });                       // ignored

  expect(ticks).toEqual([{ type: 'tick', symbol: 'AAPL', price: '195.0000', ts: 't1' }]);
  sock.close();
  expect(FakeWS.last.closed).toBe(true);
});

test('unsubscribe stops delivery; close prevents reconnect', () => {
  vi.useFakeTimers();
  const sock = createMarketSocket('ws://x/ws/market', { WebSocketImpl: FakeWS, reconnectMs: 1000 });
  const seen = [];
  const off = sock.subscribe((t) => seen.push(t));
  off();
  FakeWS.last.onmessage({ data: JSON.stringify({ type: 'tick', symbol: 'AAPL', price: '1', ts: 't' }) });
  expect(seen).toHaveLength(0);

  sock.close();
  const before = FakeWS.last;
  vi.advanceTimersByTime(5000); // no reconnect after explicit close
  expect(FakeWS.last).toBe(before);
  vi.useRealTimers();
});
