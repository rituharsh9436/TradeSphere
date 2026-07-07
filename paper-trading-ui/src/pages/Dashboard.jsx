import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { AlertTriangle, ArrowUpRight, BarChart3, PlayCircle } from "lucide-react";
import HoldingsTable from "../components/HoldingsTable";
import Skeleton, { StatSkeleton } from "../components/Skeleton";
import { getPortfolio } from "../services/marketApi";
import { deltaClass, money, percent, signedMoney } from "../lib/format";

function Stat({ label, value, tone }) {
  return (
    <div className="card p-4">
      <div className="text-xs uppercase text-muted">{label}</div>
      <div className={`tnum mt-2 text-2xl font-semibold ${tone || "text-ink"}`}>{value}</div>
    </div>
  );
}

function AllocationBar({ label, value, total, tone = "bg-accent" }) {
  const pct = total > 0 ? Math.max(0, Math.min(100, (Number(value || 0) / total) * 100)) : 0;
  return (
    <div>
      <div className="mb-1 flex justify-between gap-3 text-sm">
        <span className="text-muted">{label}</span>
        <span className="tnum text-ink-secondary">{money(value)}</span>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-plane">
        <div className={`h-full rounded-full ${tone}`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

function FirstRunCard() {
  return (
    <div className="card-elevated mt-6 flex flex-col gap-4 p-4 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex gap-3">
        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-md border border-accent/60 bg-accent/10 text-accent">
          <PlayCircle className="h-5 w-5" aria-hidden="true" />
        </span>
        <div>
          <h2 className="font-semibold">Start your first paper trade</h2>
          <p className="mt-1 text-sm text-muted">Pick a symbol, compare the live candle, and place a small market or limit order.</p>
        </div>
      </div>
      <Link to="/market" className="btn btn-primary shrink-0">
        Open Market
        <ArrowUpRight className="h-4 w-4" aria-hidden="true" />
      </Link>
    </div>
  );
}

function Dashboard() {
  const [portfolio, setPortfolio] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    getPortfolio()
      .then((data) => {
        setPortfolio(data);
        setError(null);
      })
      .catch(() => setError("Couldn't load portfolio"));
  }, []);

  const positions = portfolio?.positions || [];
  const loading = !portfolio && !error;
  const totalEquity = Number(portfolio?.totalEquity || 0);
  const hasActivity = positions.length > 0 || Number(portfolio?.totalUnrealizedPnl || 0) !== 0;

  return (
    <main className="mx-auto max-w-7xl px-4 pb-24 pt-6 md:pb-6">
      <div className="mb-6 flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Dashboard</h1>
          <p className="text-sm text-muted">Portfolio, cash, and open-position performance.</p>
        </div>
        {portfolio?.unpricedSymbols?.length > 0 && (
          <span
            role="status"
            className="inline-flex items-center gap-1.5 rounded-md border border-warning/60 px-3 py-1 text-sm text-warning"
          >
            <AlertTriangle className="h-3.5 w-3.5" aria-hidden="true" />
            Unpriced: {portfolio.unpricedSymbols.join(", ")}
          </span>
        )}
      </div>

      {error && (
        <div role="alert" className="mb-4 flex items-center gap-2 rounded-md border border-loss/50 p-3 text-sm text-loss">
          <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden="true" />
          {error}
        </div>
      )}

      <section className="grid gap-4 md:grid-cols-2 lg:grid-cols-4" aria-busy={loading}>
        {loading ? (
          <>
            <span className="sr-only" role="status">Loading portfolio…</span>
            <StatSkeleton />
            <StatSkeleton />
            <StatSkeleton />
            <StatSkeleton />
          </>
        ) : (
          <>
            <Stat label="Total Equity" value={money(portfolio?.totalEquity)} />
            <Stat label="Cash" value={money(portfolio?.cashBalance)} />
            <Stat label="Holdings" value={money(portfolio?.holdingsValue)} />
            <Stat label="ROI" value={percent(portfolio?.roiPct)} tone={deltaClass(portfolio?.roiPct)} />
          </>
        )}
      </section>

      {!loading && !hasActivity && <FirstRunCard />}

      <section className="mt-6 grid gap-4 lg:grid-cols-[1fr_320px]">
        <div className="card p-4">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="font-semibold">Holdings</h2>
            <span className="text-sm text-muted">{positions.length} open</span>
          </div>
          {loading ? <Skeleton className="h-48 w-full" /> : <HoldingsTable positions={positions} />}
        </div>

        <div className="card p-4">
          <div className="flex items-center gap-2">
            <BarChart3 className="h-4 w-4 text-accent" aria-hidden="true" />
            <h2 className="font-semibold">Performance</h2>
          </div>
          <div className="mt-4 space-y-3 text-sm">
            {loading ? (
              <Skeleton className="h-44 w-full" />
            ) : (
              <>
                <AllocationBar label="Cash" value={portfolio?.cashBalance} total={totalEquity} tone="bg-accent" />
                <AllocationBar label="Holdings" value={portfolio?.holdingsValue} total={totalEquity} tone="bg-gain" />
                <div className="flex justify-between gap-4 border-t border-line pt-3">
                  <span className="text-muted">Cost basis</span>
                  <span className="tnum text-ink-secondary">{money(portfolio?.totalCostBasis)}</span>
                </div>
                <div className="flex justify-between gap-4">
                  <span className="text-muted">Unrealized P/L</span>
                  <span className={`tnum font-semibold ${deltaClass(portfolio?.totalUnrealizedPnl)}`}>
                    {signedMoney(portfolio?.totalUnrealizedPnl)}
                  </span>
                </div>
                <div className="flex justify-between gap-4">
                  <span className="text-muted">Unrealized P/L %</span>
                  <span className={`tnum font-semibold ${deltaClass(portfolio?.totalUnrealizedPnlPct)}`}>
                    {percent(portfolio?.totalUnrealizedPnlPct)}
                  </span>
                </div>
                <div className="flex justify-between gap-4 border-t border-line pt-3">
                  <span className="text-muted">Starting capital</span>
                  <span className="tnum text-ink-secondary">{money(portfolio?.startingCapital)}</span>
                </div>
              </>
            )}
          </div>
        </div>
      </section>
    </main>
  );
}

export default Dashboard;
