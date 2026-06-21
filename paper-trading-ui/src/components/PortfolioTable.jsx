import {
  formatMoney,
  formatQty,
  formatSignedMoney,
  formatPct,
  pnlColor,
} from "../utils/format";

// Holdings table driven by portfolio.positions (or GET /users/:id/positions).
// Each row: symbol, qty, avg buy, current price, market value, P/L.
function PortfolioTable({ positions = [] }) {
  if (!positions.length) {
    return (
      <div className="rounded-2xl border border-dashed border-slate-800 bg-slate-900/40 p-10 text-center">
        <p className="text-slate-400">No holdings yet.</p>
        <p className="mt-1 text-sm text-slate-600">
          Head to the Market to place your first trade.
        </p>
      </div>
    );
  }

  return (
    <div className="overflow-x-auto rounded-2xl border border-slate-800 bg-slate-900/60">
      <table className="w-full min-w-[640px] text-left text-sm">
        <thead>
          <tr className="border-b border-slate-800 text-xs uppercase tracking-wide text-slate-400">
            <th className="px-5 py-3 font-medium">Symbol</th>
            <th className="px-5 py-3 text-right font-medium">Qty</th>
            <th className="px-5 py-3 text-right font-medium">Avg Buy</th>
            <th className="px-5 py-3 text-right font-medium">Current</th>
            <th className="px-5 py-3 text-right font-medium">Market Value</th>
            <th className="px-5 py-3 text-right font-medium">Unrealized P/L</th>
          </tr>
        </thead>
        <tbody>
          {positions.map((p) => (
            <tr
              key={p.symbol}
              className="border-b border-slate-800/60 last:border-0 hover:bg-slate-800/30"
            >
              <td className="px-5 py-3 font-semibold text-white">{p.symbol}</td>
              <td className="px-5 py-3 text-right text-slate-300">{formatQty(p.quantity)}</td>
              <td className="px-5 py-3 text-right text-slate-300">
                {formatMoney(p.averageBuyPrice)}
              </td>
              <td className="px-5 py-3 text-right text-slate-300">
                {p.currentPrice === null ? (
                  <span className="text-amber-400" title="No market price available">
                    unpriced
                  </span>
                ) : (
                  formatMoney(p.currentPrice)
                )}
              </td>
              <td className="px-5 py-3 text-right text-slate-200">
                {formatMoney(p.marketValue)}
              </td>
              <td className={`px-5 py-3 text-right font-medium ${pnlColor(p.unrealizedPnl)}`}>
                {formatSignedMoney(p.unrealizedPnl)}
                {p.unrealizedPnlPct !== null && (
                  <span className="ml-1 text-xs opacity-80">
                    ({formatPct(p.unrealizedPnlPct)})
                  </span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default PortfolioTable;
