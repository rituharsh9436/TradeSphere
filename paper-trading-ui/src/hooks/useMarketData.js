import { useEffect, useRef, useState, useCallback } from "react";
import { createMarketSocket } from "../services/marketSocket";

const WS_URL = "ws://localhost:5000/ws/market";

// Opens one shared market socket and exposes (a) a live latest-price map for the
// price list and (b) a raw tick subscription for the selected-symbol candle.
export function useMarketData() {
  const [prices, setPrices] = useState({});
  const listenersRef = useRef(new Set());

  const subscribeTick = useCallback((cb) => {
    listenersRef.current.add(cb);
    return () => listenersRef.current.delete(cb);
  }, []);

  useEffect(() => {
    const sock = createMarketSocket(WS_URL);
    const off = sock.subscribe((tick) => {
      setPrices((prev) => ({ ...prev, [tick.symbol]: { price: tick.price, ts: tick.ts } }));
      for (const cb of listenersRef.current) cb(tick);
    });
    return () => {
      off();
      sock.close();
    };
  }, []);

  return { prices, subscribeTick };
}
