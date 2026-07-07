// Presentation helpers for the money/percent strings the backend returns (4dp
// strings backed by DECIMAL(15,4)). Pure and dependency-free so they can be used
// anywhere and unit-tested. Everything is USD.

const USD = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

// "98050.0000" -> "$98,050.00". Nullish / non-numeric -> dash.
export function money(value) {
  const n = Number(value);
  if (value == null || Number.isNaN(n)) return "-";
  return USD.format(n);
}

// A plain number with thousands separators (e.g. share quantities). Trims the
// trailing zeros the backend pads to 4dp.
export function qty(value) {
  const n = Number(value);
  if (value == null || Number.isNaN(n)) return "-";
  return n.toLocaleString("en-US", { maximumFractionDigits: 4 });
}

// "1.0500" -> "+1.05%"; "-1.30" -> "-1.30%". Signed so gains read clearly.
export function percent(value, { signed = true } = {}) {
  const n = Number(value);
  if (value == null || Number.isNaN(n)) return "-";
  const sign = signed && n > 0 ? "+" : "";
  return `${sign}${n.toFixed(2)}%`;
}

// Signed money for gain/loss figures: "+$390.00" / "-$12.50" / "$0.00". The
// explicit "+" is a non-colour cue so a P/L reads as a gain even in greyscale
// (Intl already renders negatives with "-"). Use this — not money() — wherever a
// value's sign carries meaning, so direction never depends on colour alone.
export function signedMoney(value) {
  const n = Number(value);
  if (value == null || Number.isNaN(n)) return "-";
  const sign = n > 0 ? "+" : "";
  return `${sign}${money(value)}`;
}

// Tailwind text-colour class for a signed number: gain / loss / neutral ink.
export function deltaClass(value) {
  const n = Number(value);
  if (!n) return "text-ink-secondary";
  return n > 0 ? "text-gain" : "text-loss";
}
