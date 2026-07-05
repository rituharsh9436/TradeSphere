// Browser WebSocket client for the backend market feed. One connection fans
// every tick out to all subscribers. Reconnects automatically unless closed by
// the caller. WebSocketImpl is injectable so the parsing/dispatch logic is
// unit-testable without a real socket.
export function createMarketSocket(url, { WebSocketImpl = WebSocket, reconnectMs = 2000, onStatus = () => {} } = {}) {
  const listeners = new Set();
  let ws = null;
  let stopped = false;
  let retryTimer = null;

  function connect() {
    if (stopped) return;
    onStatus("connecting");
    ws = new WebSocketImpl(url);

    ws.onopen = () => {
      onStatus("live");
    };
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
      onStatus("reconnecting");
      retryTimer = setTimeout(connect, reconnectMs);
    };
    ws.onerror = () => {
      onStatus("reconnecting");
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
      onStatus("closed");
      if (retryTimer) clearTimeout(retryTimer);
      if (ws) ws.close();
    },
  };
}
