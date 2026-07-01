// Browser WebSocket client for the backend market feed. One connection fans
// every tick out to all subscribers. Reconnects automatically unless closed by
// the caller. WebSocketImpl is injectable so the parsing/dispatch logic is
// unit-testable without a real socket.
export function createMarketSocket(url, { WebSocketImpl = WebSocket, reconnectMs = 2000 } = {}) {
  const listeners = new Set();
  let ws = null;
  let stopped = false;
  let retryTimer = null;

  function connect() {
    if (stopped) return;
    ws = new WebSocketImpl(url);

    ws.onmessage = (evt) => {
      let msg;
      try {
        msg = JSON.parse(evt.data);
      } catch {
        return;
      }
      if (!msg || msg.type !== 'tick') return;
      for (const cb of listeners) cb(msg);
    };
    ws.onclose = () => {
      if (stopped) return;
      retryTimer = setTimeout(connect, reconnectMs);
    };
  }

  connect();

  return {
    subscribe(cb) {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    close() {
      stopped = true;
      if (retryTimer) clearTimeout(retryTimer);
      if (ws) ws.close();
    },
  };
}
