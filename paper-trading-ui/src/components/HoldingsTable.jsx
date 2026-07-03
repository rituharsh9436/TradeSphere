import { deltaClass, money, percent, qty } from "../lib/format";

function HoldingsTable({ positions }) {
  if (!positions?.length) {
    return (
      <div className="rounded-md border border-line p-4 text-sm text-muted">
        No open positions.
      </div>
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[760px] border-collapse text-sm">
        <thead>
          <tr className="border-b border-line text-left text-xs uppercase text-muted">
            <th className="py-2 pr-4 font-semibold">Symbol</th>
            <th className="py-2 pr-4 text-right font-semibold">Qty</th>
            <th className="py-2 pr-4 text-right font-semibold">Avg Buy</th>
            <th className="py-2 pr-4 text-right font-semibold">Price</th>
            <th className="py-2 pr-4 text-right font-semibold">Value</th>
            <th className="py-2 pr-4 text-right font-semibold">P/L</th>
            <th className="py-2 text-right font-semibold">P/L %</th>
          </tr>
        </thead>
        <tbody>
          {positions.map((p) => (
            <tr key={p.symbol} className="border-b border-line/70 last:border-0">
              <td className="py-3 pr-4 font-semibold text-ink">{p.symbol}</td>
              <td className="tnum py-3 pr-4 text-right text-ink-secondary">{qty(p.quantity)}</td>
              <td className="tnum py-3 pr-4 text-right text-ink-secondary">{money(p.averageBuyPrice)}</td>
              <td className="tnum py-3 pr-4 text-right text-ink-secondary">{money(p.currentPrice)}</td>
              <td className="tnum py-3 pr-4 text-right text-ink-secondary">{money(p.marketValue)}</td>
              <td className={`tnum py-3 pr-4 text-right font-semibold ${deltaClass(p.unrealizedPnl)}`}>
                {money(p.unrealizedPnl)}
              </td>
              <td className={`tnum py-3 text-right font-semibold ${deltaClass(p.unrealizedPnlPct)}`}>
                {percent(p.unrealizedPnlPct)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default HoldingsTable;
