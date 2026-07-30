import { useRef } from "react";
import { Clock3 } from "lucide-react";
import { money } from "../lib/format";

// Live latest-price rows. `prices` is the map from useMarketData; each row shows
// the current price and is clickable to select that symbol for the chart.
function PriceList({ prices, selected, onSelect }) {
  const symbols = Object.keys(prices).sort();
  const buttonRefs = useRef([]);

  if (symbols.length === 0) {
    return (
      <div className="rounded-md border border-line p-3 text-sm text-muted">
        Waiting for prices...
      </div>
    );
  }

  function handleKeyDown(e, index) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      const next = buttonRefs.current[index + 1] || buttonRefs.current[0];
      next?.focus();
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      const prev = buttonRefs.current[index - 1] || buttonRefs.current[symbols.length - 1];
      prev?.focus();
    }
  }

  return (
    <div className="flex flex-col gap-1.5" role="listbox" aria-label="Symbols">
      {symbols.map((symbol, i) => (
        <button
          key={symbol}
          ref={(el) => (buttonRefs.current[i] = el)}
          type="button"
          role="option"
          aria-selected={symbol === selected}
          onClick={() => onSelect(symbol)}
          onKeyDown={(e) => handleKeyDown(e, i)}
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
