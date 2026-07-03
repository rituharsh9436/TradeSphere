import { useEffect, useState } from "react";
import CandlestickChart from "../components/CandlestickChart";
import PriceList from "../components/PriceList";
import TimeframeSwitcher from "../components/TimeframeSwitcher";
import TradePanel from "../components/TradePanel";
import { useMarketData } from "../hooks/useMarketData";
import { applyTickToCandles, toChartCandles } from "../lib/candles";
import { money } from "../lib/format";
import { getCandles } from "../services/marketApi";

function Market() {
  const { prices, subscribeTick } = useMarketData();
  const [symbol, setSymbol] = useState("AAPL");
  const [interval, setIntervalSec] = useState(60);
  const [candles, setCandles] = useState([]);
  const [loadId, setLoadId] = useState(0);
  const [error, setError] = useState(null);

  useEffect(() => {
    let cancelled = false;
    getCandles({ symbol, interval })
      .then((data) => {
        if (cancelled) return;
        setCandles(toChartCandles(data.candles));
        setLoadId((n) => n + 1);
        setError(null);
      })
      .catch(() => {
        if (!cancelled) setError("Couldn't load candles");
      });
    return () => {
      cancelled = true;
    };
  }, [symbol, interval]);

  useEffect(() => {
    return subscribeTick((tick) => {
      if (tick.symbol !== symbol) return;
      setCandles((prev) => applyTickToCandles(prev, tick, interval));
    });
  }, [subscribeTick, symbol, interval]);

  const seriesKey = `${symbol}:${interval}:${loadId}`;
  const livePrice = prices[symbol]?.price ?? "0";

  return (
    <main className="mx-auto max-w-7xl px-4 py-6">
      <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Market</h1>
          <p className="text-sm text-muted">Live prices, candles, and order entry.</p>
        </div>
        <div className="rounded-md border border-line bg-surface px-4 py-2">
          <span className="mr-3 text-sm text-muted">{symbol}</span>
          <span className="tnum text-lg font-semibold">{money(livePrice)}</span>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-[220px_minmax(0,1fr)_300px]">
        <aside className="card p-4">
          <h2 className="mb-3 font-semibold">Symbols</h2>
          <PriceList prices={prices} selected={symbol} onSelect={setSymbol} />
        </aside>

        <section className="card overflow-hidden">
          <div className="flex flex-col gap-3 border-b border-line p-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h2 className="font-semibold">{symbol} Candles</h2>
              <p className="text-sm text-muted">{candles.length} bars loaded</p>
            </div>
            <TimeframeSwitcher value={interval} onChange={setIntervalSec} />
          </div>
          {error && <div className="m-4 rounded-md border border-loss/50 p-3 text-sm text-loss">{error}</div>}
          <CandlestickChart candles={candles} seriesKey={seriesKey} />
        </section>

        <aside className="card p-4">
          <h2 className="mb-3 font-semibold">Trade</h2>
          <TradePanel symbol={symbol} price={livePrice} />
        </aside>
      </div>
    </main>
  );
}

export default Market;
