import { Clock3 } from "lucide-react";
import { money } from "../lib/format";

// Live latest-price rows. `prices` is the map from useMarketData; each row shows
// the current price and is clickable to select that symbol for the chart.
function PriceList({ prices, selected, onSelect }) {
  const symbols = Object.keys(prices).sort();

  if (symbols.length === 0) {
    return (
      <div className="rounded-md border border-line p-3 text-sm text-muted">
        Waiting for prices...
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-1.5">
      {symbols.map((symbol) => (
        <button
          key={symbol}
          type="button"
          onClick={() => onSelect(symbol)}
          className={`group flex items-center justify-between gap-4 rounded-md border px-3 py-2.5 text-left transition-colors ${
            symbol === selected
              ? "border-accent bg-surface-2 text-ink"
              : "border-transparent bg-plane text-ink-secondary hover:border-line hover:bg-surface-hover hover:text-ink"
          }`}
        >
          <span>
            <span className="block font-semibold">{symbol}</span>
            {prices[symbol].ts && (
              <span className={`mt-0.5 flex items-center gap-1 text-xs transition-colors ${symbol === selected ? "text-ink-secondary" : "text-muted group-hover:text-ink-secondary"}`}>
                <Clock3 className="h-3 w-3" aria-hidden="true" />
                {new Date(prices[symbol].ts).toLocaleTimeString()}
              </span>
            )}
          </span>
          <span className="tnum text-sm font-semibold">{money(prices[symbol].price)}</span>
        </button>
      ))}
    </div>
  );
}

export default PriceList;
