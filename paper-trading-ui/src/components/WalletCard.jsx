import { formatMoney, formatSignedMoney, formatPct, pnlColor } from "../utils/format";

// A single summary stat tile. Used across the dashboard header.
function StatTile({ label, value, sub, valueClass = "text-white", icon }) {
  return (
    <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-5">
      <div className="flex items-center justify-between">
        <p className="text-xs font-medium uppercase tracking-wide text-slate-400">{label}</p>
        {icon && <span className="text-lg">{icon}</span>}
      </div>
      <p className={`mt-2 text-2xl font-bold ${valueClass}`}>{value}</p>
      {sub && <p className="mt-1 text-xs text-slate-500">{sub}</p>}
    </div>
  );
}

// Portfolio summary cards driven by GET /users/:id/portfolio.
function WalletCard({ portfolio }) {
  const pnl = portfolio?.totalUnrealizedPnl;
  const roi = portfolio?.roiPct;

  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
      <StatTile
        label="Total Equity"
        value={formatMoney(portfolio?.totalEquity)}
        sub="Cash + holdings"
        icon="💼"
      />
      <StatTile
        label="Cash Balance"
        value={formatMoney(portfolio?.cashBalance)}
        sub="Available to trade"
        icon="💰"
      />
      <StatTile
        label="Holdings Value"
        value={formatMoney(portfolio?.holdingsValue)}
        sub={`Cost ${formatMoney(portfolio?.totalCostBasis)}`}
        icon="📦"
      />
      <StatTile
        label="Unrealized P/L"
        value={formatSignedMoney(pnl)}
        sub={`ROI ${formatPct(roi)}`}
        valueClass={pnlColor(pnl)}
        icon="📊"
      />
    </div>
  );
}

export default WalletCard;
