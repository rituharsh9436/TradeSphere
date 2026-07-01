const { WebSocketServer, WebSocket } = require('ws');

// Our browser-facing WebSocket. The ingestion worker calls broadcast() on every
// tick; connected chart clients receive { type: 'tick', symbol, price, ts }.
// Subscription filtering is intentionally minimal for Step 6a (clients get all
// symbols); a per-symbol filter can be added when the chart needs it.
function createMarketSocket() {
  let wss = null;

  return {
    attach(httpServer, path = '/ws/market') {
      wss = new WebSocketServer({ server: httpServer, path });
    },
    broadcast(obj) {
      if (!wss) return;
      const payload = JSON.stringify(obj);
      for (const client of wss.clients) {
        if (client.readyState === WebSocket.OPEN) client.send(payload);
      }
    },
    close() {
      if (wss) wss.close();
      wss = null;
    },
  };
}

module.exports = createMarketSocket;
