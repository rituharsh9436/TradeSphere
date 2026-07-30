import { useEffect, useRef, useState, useCallback } from "react";
import { createMarketSocket } from "../services/marketSocket";
import { getPrices } from "../services/marketApi";
import { getWsUrl } from "../services/api";

const WS_URL = getWsUrl();

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
    let pendingPrices = null;
    let throttleTimer = null;

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
      // Synchronously notify listeners for immediate chart updates
      for (const cb of listenersRef.current) cb(tick);

      // Throttle React state updates for the price list
      if (!pendingPrices) pendingPrices = {};
      pendingPrices[tick.symbol] = { price: tick.price, ts: tick.ts };

      if (!throttleTimer) {
        throttleTimer = setTimeout(() => {
          if (active) setPrices((prev) => ({ ...prev, ...pendingPrices }));
          pendingPrices = null;
          throttleTimer = null;
        }, 200);
      }
    });
    
    return () => {
      active = false;
      off();
      sock.close();
      if (throttleTimer) clearTimeout(throttleTimer);
    };
  }, []);

  return { prices, subscribeTick, connectionStatus };
}
