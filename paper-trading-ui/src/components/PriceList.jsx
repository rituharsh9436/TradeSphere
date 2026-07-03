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
    <div className="flex flex-col gap-2">
      {symbols.map((symbol) => (
        <button
          key={symbol}
          type="button"
          onClick={() => onSelect(symbol)}
          className={`flex items-center justify-between gap-4 rounded-md border px-3 py-2 text-left transition-colors ${
            symbol === selected
              ? "border-accent bg-surface-2 text-ink"
              : "border-line bg-plane text-ink-secondary hover:border-muted hover:text-ink"
          }`}
        >
          <span className="font-semibold">{symbol}</span>
          <span className="tnum text-sm">{money(prices[symbol].price)}</span>
        </button>
      ))}
    </div>
  );
}

export default PriceList;
