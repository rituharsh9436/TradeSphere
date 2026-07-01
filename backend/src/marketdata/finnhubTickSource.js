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
    return msg.data.map((d) => ({
      symbol: d.s,
      price: new Decimal(d.p).toFixed(4),
      ts: new Date(d.t).toISOString(),
    }));
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
