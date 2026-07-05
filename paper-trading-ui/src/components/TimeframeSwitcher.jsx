/* eslint-disable react-refresh/only-export-components */
// TIMEFRAMES is small config co-located with the switcher that owns it; exporting
// it alongside the component trips react-refresh's dev-HMR heuristic, opted out here.

// Timeframe options map UI labels to the backend /candles `interval` (seconds).
export const TIMEFRAMES = [
  { label: "15s", seconds: 15 },
  { label: "1m", seconds: 60 },
  { label: "5m", seconds: 300 },
  { label: "1h", seconds: 3600 },
];

function TimeframeSwitcher({ value, onChange }) {
  return (
    <div className="inline-flex rounded-md border border-line bg-plane p-1">
      {TIMEFRAMES.map((tf) => (
        <button
          key={tf.seconds}
          type="button"
          onClick={() => onChange(tf.seconds)}
          className={`rounded px-3 py-1 text-sm font-semibold transition-colors ${
            value === tf.seconds
              ? "bg-accent text-plane"
              : "text-muted hover:bg-surface-2 hover:text-ink"
          }`}
        >
          {tf.label}
        </button>
      ))}
    </div>
  );
}

export default TimeframeSwitcher;
