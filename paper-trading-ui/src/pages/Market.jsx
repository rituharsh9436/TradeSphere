import { useEffect, useState } from "react";
import { Activity, Radio, WifiOff } from "lucide-react";
import CandlestickChart from "../components/CandlestickChart";
import PriceList from "../components/PriceList";
import Skeleton from "../components/Skeleton";
import StatusBadge from "../components/StatusBadge";
import TimeframeSwitcher from "../components/TimeframeSwitcher";
import Toast from "../components/Toast";
import TradePanel from "../components/TradePanel";
import { useMarketData } from "../hooks/useMarketData";
import { applyTickToCandles, toChartCandles } from "../lib/candles";
import { money } from "../lib/format";
import { getCandles, getPortfolio } from "../services/marketApi";

function Market() {
  const { prices, subscribeTick, connectionStatus } = useMarketData();
  const [symbol, setSymbol] = useState("AAPL");
  const [interval, setIntervalSec] = useState(60);
  const [candles, setCandles] = useState([]);
  const [loadId, setLoadId] = useState(0);
  const [portfolio, setPortfolio] = useState(null);
  const [error, setError] = useState(null);
  const [toast, setToast] = useState(null);

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
    let active = true;
    getPortfolio()
      .then((data) => {
        if (active) setPortfolio(data);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    return subscribeTick((tick) => {
      if (tick.symbol !== symbol) return;
      setCandles((prev) => applyTickToCandles(prev, tick, interval));
    });
  }, [subscribeTick, symbol, interval]);

  const seriesKey = `${symbol}:${interval}:${loadId}`;
  const livePrice = prices[symbol]?.price ?? "0";
  const liveTick = prices[symbol];
  const loadingCandles = candles.length === 0 && !error;
  const isLive = connectionStatus === "live";

  async function refreshPortfolio(status) {
    setToast(status);
    try {
      setPortfolio(await getPortfolio());
    } catch {
      // Keep the order result visible even if the follow-up portfolio refresh fails.
    }
  }

  return (
    <main className="mx-auto max-w-7xl px-4 pb-24 pt-6 md:pb-6">
      <Toast message={toast?.message} type={toast?.ok ? "success" : "error"} onClose={() => setToast(null)} />
      <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Market</h1>
          <p className="text-sm text-muted">Live prices, candles, and order entry.</p>
        </div>
        <div className="grid gap-2 rounded-md border border-line bg-surface-2 px-4 py-3 sm:min-w-72 shadow-sm">
          <div className="flex items-center justify-between gap-4">
            <span className="text-sm font-medium text-muted uppercase tracking-wider">{symbol}</span>
            <StatusBadge tone={isLive ? "LIVE" : "PENDING"}>{isLive ? "Live" : "Reconnecting"}</StatusBadge>
          </div>
          <div className="flex items-end justify-between gap-4">
            <span className="tnum text-3xl font-bold tracking-tight text-ink">{money(livePrice)}</span>
            <span className="text-xs text-muted mb-1">{liveTick?.ts ? new Date(liveTick.ts).toLocaleTimeString() : "Awaiting tick"}</span>
          </div>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-[220px_minmax(0,1fr)_300px]">
        <aside className="card p-4">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="font-semibold text-ink-secondary">Symbols</h2>
            {isLive ? <Radio className="h-4 w-4 text-gain" aria-hidden="true" /> : <WifiOff className="h-4 w-4 text-warning" aria-hidden="true" />}
          </div>
          <PriceList prices={prices} selected={symbol} onSelect={setSymbol} />
        </aside>

        <section className="card overflow-hidden">
          <div className="flex flex-col gap-3 border-b border-line p-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <div className="flex items-center gap-2">
                <Activity className="h-4 w-4 text-accent" aria-hidden="true" />
                <h2 className="font-semibold text-ink-secondary">{symbol} Candles</h2>
              </div>
              <p className="mt-1 text-sm text-muted">{candles.length} bars loaded</p>
            </div>
            <TimeframeSwitcher value={interval} onChange={setIntervalSec} />
          </div>
          {error && <div className="m-4 rounded-md border border-loss/50 p-3 text-sm text-loss">{error}</div>}
          {loadingCandles ? <div className="p-4"><Skeleton className="h-[428px] w-full" /></div> : <CandlestickChart candles={candles} seriesKey={seriesKey} />}
        </section>

        <aside className="card p-4 lg:sticky lg:top-20 lg:self-start">
          <h2 className="mb-4 font-semibold text-ink-secondary">Trade</h2>
          <TradePanel symbol={symbol} price={livePrice} portfolio={portfolio} onOrderPlaced={refreshPortfolio} />
        </aside>
      </div>
    </main>
  );
}

export default Market;
