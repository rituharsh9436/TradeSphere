import { useEffect, useState } from "react";
import { useMarketData } from "../hooks/useMarketData";
import { getCandles } from "../services/marketApi";
import { toChartCandles, applyTickToCandles } from "../lib/candles";
import PriceList from "../components/PriceList";
import TimeframeSwitcher from "../components/TimeframeSwitcher";
import CandlestickChart from "../components/CandlestickChart";
import TradePanel from "../components/TradePanel";

// Live trading view: price list (left), candlestick chart + timeframe (center),
// trade panel (right). The page owns selection, interval and candle state; the
// chart is a thin renderer and lib/candles owns the tick math.
function Market() {
  const { prices, subscribeTick } = useMarketData();
  const [symbol, setSymbol] = useState("AAPL");
  const [interval, setIntervalSec] = useState(60); // default 1m
  const [candles, setCandles] = useState([]);
  const [loadId, setLoadId] = useState(0);
  const [error, setError] = useState(null);

  // Load candle history whenever symbol/timeframe changes; bump loadId so the
  // chart does a full setData rather than a per-tick update.
  useEffect(() => {
    let cancelled = false;
    getCandles({ symbol, interval })
      .then((data) => {
        if (cancelled) return;
        setCandles(toChartCandles(data.candles));
        setLoadId((n) => n + 1);
        setError(null);
      })
      .catch(() => { if (!cancelled) setError("Couldn't load candles"); });
    return () => { cancelled = true; };
  }, [symbol, interval]);

  // Fold live ticks for the selected symbol into the current candle. Re-binds
  // when symbol/interval change so the callback always closes over current
  // values (re-registering a listener is cheap — no refs needed).
  useEffect(() => {
    return subscribeTick((tick) => {
      if (tick.symbol !== symbol) return;
      setCandles((prev) => applyTickToCandles(prev, tick, interval));
    });
  }, [subscribeTick, symbol, interval]);

  const seriesKey = `${symbol}:${interval}:${loadId}`;
  const livePrice = prices[symbol]?.price ?? "0";

  return (
    <div style={{ padding: "16px" }}>
      <h1>Market</h1>
      <div style={{ display: "flex", gap: "24px", alignItems: "flex-start" }}>
        <div style={{ minWidth: "160px" }}>
          <h3>Symbols</h3>
          <PriceList prices={prices} selected={symbol} onSelect={setSymbol} />
        </div>

        <div style={{ flex: 1 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <h3>{symbol}</h3>
            <TimeframeSwitcher value={interval} onChange={setIntervalSec} />
          </div>
          {error && <div style={{ color: "crimson" }}>{error}</div>}
          <CandlestickChart candles={candles} seriesKey={seriesKey} />
        </div>

        <div style={{ minWidth: "220px" }}>
          <h3>Trade</h3>
          <TradePanel symbol={symbol} price={livePrice} />
        </div>
      </div>
    </div>
  );
}

export default Market;
