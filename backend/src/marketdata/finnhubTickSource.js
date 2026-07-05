const Decimal = require('decimal.js');

// Live tick source backed by Finnhub's real-time trades WebSocket
// (wss://ws.finnhub.io). Subscribes to each symbol on open and emits ticks for
// every trade. Reconnects with a fixed delay; only streams during US market
// hours (the selector decides when to use this source). `WebSocketImpl` is
// injectable so the parsing/subscribe logic is testable without a network.
function createFinnhubTickSource({
  apiKey,
  symbols,
  WebSocketImpl = require('ws'),
  now = () => new Date(),
  reconnectMs = 3000,
}) {
  const listeners = [];
  let ws = null;
  let stopped = false;
  let retryTimer = null;

  function emit(tick) {
    for (const cb of listeners) cb(tick);
  }

  function parseTradeMessage(raw) {
    let msg;
    try {
      msg = JSON.parse(raw);
    } catch {
      return [];
    }
    if (!msg || msg.type !== 'trade' || !Array.isArray(msg.data)) return [];
    // Parse each trade defensively: a single malformed element (null/non-numeric
    // price, bad timestamp) must not throw out of the ws 'message' handler and
    // crash the process — skip it and keep the rest of the batch.
    const ticks = [];
    for (const d of msg.data) {
      try {
        ticks.push({
          symbol: d.s,
          price: new Decimal(d.p).toFixed(4),
          ts: new Date(d.t).toISOString(),
        });
      } catch {
        // drop the bad trade
      }
    }
    return ticks;
  }

  function connect() {
    if (stopped) return;
    ws = new WebSocketImpl(`wss://ws.finnhub.io?token=${apiKey}`);

    ws.on('open', () => {
      for (const symbol of symbols) {
        ws.send(JSON.stringify({ type: 'subscribe', symbol }));
      }
    });
    ws.on('message', (raw) => {
      for (const tick of parseTradeMessage(raw.toString())) emit(tick);
    });
    ws.on('error', (err) => {
      console.error('Finnhub WS error:', err.message);
    });
    ws.on('close', () => {
      if (stopped) return;
      retryTimer = setTimeout(connect, reconnectMs);
      if (retryTimer.unref) retryTimer.unref();
    });
  }

  return {
    onTick(cb) {
      listeners.push(cb);
    },
    start() {
      stopped = false;
      connect();
    },
    stop() {
      stopped = true;
      if (retryTimer) clearTimeout(retryTimer);
      if (ws) ws.close();
      ws = null;
    },
    parseTradeMessage,
  };
}

module.exports = createFinnhubTickSource;
