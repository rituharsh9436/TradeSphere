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
    <div style={{ display: "flex", gap: "4px" }}>
      {TIMEFRAMES.map((tf) => (
        <button
          key={tf.seconds}
          type="button"
          onClick={() => onChange(tf.seconds)}
          style={{ fontWeight: value === tf.seconds ? "bold" : "normal" }}
        >
          {tf.label}
        </button>
      ))}
    </div>
  );
}

export default TimeframeSwitcher;
