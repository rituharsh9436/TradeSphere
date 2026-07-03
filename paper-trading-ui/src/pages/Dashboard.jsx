import { useEffect, useState } from "react";
import HoldingsTable from "../components/HoldingsTable";
import { getPortfolio } from "../services/marketApi";
import { deltaClass, money, percent } from "../lib/format";

function Stat({ label, value, tone }) {
  return (
    <div className="card p-4">
      <div className="text-xs uppercase text-muted">{label}</div>
      <div className={`tnum mt-2 text-2xl font-semibold ${tone || "text-ink"}`}>{value}</div>
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

  return (
    <main className="mx-auto max-w-7xl px-4 py-6">
      <div className="mb-6 flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Dashboard</h1>
          <p className="text-sm text-muted">Portfolio, cash, and open-position performance.</p>
        </div>
        {portfolio?.unpricedSymbols?.length > 0 && (
          <span className="rounded-md border border-warning/60 px-3 py-1 text-sm text-warning">
            Unpriced: {portfolio.unpricedSymbols.join(", ")}
          </span>
        )}
      </div>

      {error && <div className="mb-4 rounded-md border border-loss/50 p-3 text-sm text-loss">{error}</div>}

      <section className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <Stat label="Total Equity" value={money(portfolio?.totalEquity)} />
        <Stat label="Cash" value={money(portfolio?.cashBalance)} />
        <Stat label="Holdings" value={money(portfolio?.holdingsValue)} />
        <Stat label="ROI" value={percent(portfolio?.roiPct)} tone={deltaClass(portfolio?.roiPct)} />
      </section>

      <section className="mt-6 grid gap-4 lg:grid-cols-[1fr_320px]">
        <div className="card p-4">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="font-semibold">Holdings</h2>
            <span className="text-sm text-muted">{positions.length} open</span>
          </div>
          <HoldingsTable positions={positions} />
        </div>

        <div className="card p-4">
          <h2 className="font-semibold">Performance</h2>
          <div className="mt-4 space-y-3 text-sm">
            <div className="flex justify-between gap-4">
              <span className="text-muted">Cost basis</span>
              <span className="tnum text-ink-secondary">{money(portfolio?.totalCostBasis)}</span>
            </div>
            <div className="flex justify-between gap-4">
              <span className="text-muted">Unrealized P/L</span>
              <span className={`tnum font-semibold ${deltaClass(portfolio?.totalUnrealizedPnl)}`}>
                {money(portfolio?.totalUnrealizedPnl)}
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
          </div>
        </div>
      </section>
    </main>
  );
}

export default Dashboard;
