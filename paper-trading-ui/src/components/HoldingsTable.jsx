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
    <>
      <div className="grid gap-3 md:hidden">
        {positions.map((p) => (
          <article key={p.symbol} className="rounded-md border border-line bg-plane p-3">
            <div className="mb-3 flex items-center justify-between">
              <span className="font-semibold text-ink">{p.symbol}</span>
              <span className={`tnum font-semibold ${deltaClass(p.unrealizedPnlPct)}`}>{percent(p.unrealizedPnlPct)}</span>
            </div>
            <div className="grid grid-cols-2 gap-3 text-sm">
              <div>
                <div className="text-xs uppercase text-muted">Qty</div>
                <div className="tnum mt-1 text-ink-secondary">{qty(p.quantity)}</div>
              </div>
              <div>
                <div className="text-xs uppercase text-muted">Value</div>
                <div className="tnum mt-1 text-ink-secondary">{money(p.marketValue)}</div>
              </div>
              <div>
                <div className="text-xs uppercase text-muted">Price</div>
                <div className="tnum mt-1 text-ink-secondary">{money(p.currentPrice)}</div>
              </div>
              <div>
                <div className="text-xs uppercase text-muted">P/L</div>
                <div className={`tnum mt-1 font-semibold ${deltaClass(p.unrealizedPnl)}`}>{money(p.unrealizedPnl)}</div>
              </div>
            </div>
          </article>
        ))}
      </div>

      <div className="hidden overflow-x-auto md:block">
        <table className="w-full min-w-[760px] border-collapse text-sm">
          <thead className="sticky top-0 bg-surface">
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
              <tr key={p.symbol} className="table-row border-b border-line/70 last:border-0">
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
    </>
  );
}

export default HoldingsTable;
