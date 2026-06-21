import { formatMoney, formatQty, formatSignedMoney, pnlColor } from "../utils/format";

// Compact holdings list used in side panels (e.g. the Trade page). For the full
// holdings table with all columns, use PortfolioTable.
function HoldingsTable({ positions = [] }) {
  if (!positions.length) {
    return <p className="text-sm text-slate-500">No open positions.</p>;
  }

  return (
    <ul className="divide-y divide-slate-800">
      {positions.map((p) => (
        <li key={p.symbol} className="flex items-center justify-between py-3">
          <div>
            <p className="font-semibold text-white">{p.symbol}</p>
            <p className="text-xs text-slate-500">
              {formatQty(p.quantity)} @ {formatMoney(p.averageBuyPrice)}
            </p>
          </div>
          <div className="text-right">
            <p className="text-sm text-slate-200">{formatMoney(p.marketValue)}</p>
            <p className={`text-xs ${pnlColor(p.unrealizedPnl)}`}>
              {formatSignedMoney(p.unrealizedPnl)}
            </p>
          </div>
        </li>
      ))}
    </ul>
  );
}

export default HoldingsTable;
