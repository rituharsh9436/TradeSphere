import { useEffect, useRef, useState, useCallback } from "react";
import { createMarketSocket } from "../services/marketSocket";
import { getPrices } from "../services/marketApi";

const WS_URL = "ws://localhost:5000/ws/market";

// Opens one shared market socket and exposes (a) a live latest-price map for the
// price list and (b) a raw tick subscription for the selected-symbol candle.
export function useMarketData() {
  const [prices, setPrices] = useState({});
  const [connectionStatus, setConnectionStatus] = useState("connecting");
  const listenersRef = useRef(new Set());

  const subscribeTick = useCallback((cb) => {
    listenersRef.current.add(cb);
    return () => listenersRef.current.delete(cb);
  }, []);

  useEffect(() => {
    let active = true;
    getPrices()
      .then((snapshot) => {
        if (!active) return;
        setPrices(
          Object.fromEntries(
            snapshot.map((p) => [p.symbol, { price: p.price, ts: p.updatedAt }])
          )
        );
      })
      .catch(() => {
        // The WebSocket can still populate prices; keep startup resilient.
      });

    const sock = createMarketSocket(WS_URL, { onStatus: setConnectionStatus });
    const off = sock.subscribe((tick) => {
      setPrices((prev) => ({ ...prev, [tick.symbol]: { price: tick.price, ts: tick.ts } }));
      for (const cb of listenersRef.current) cb(tick);
    });
    return () => {
      active = false;
      off();
      sock.close();
    };
  }, []);

  return { prices, subscribeTick, connectionStatus };
}
