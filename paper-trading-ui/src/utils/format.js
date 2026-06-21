// Formatting helpers. Backend returns monetary values as decimal strings
// (e.g. "100000.0000"); these coerce safely and present them in INR.

const toNum = (v) => {
  const n = typeof v === "number" ? v : parseFloat(v);
  return Number.isFinite(n) ? n : null;
};

// ₹ with thousands separators and 2 dp. Returns "—" for null/undefined.
export const formatMoney = (v, { decimals = 2 } = {}) => {
  const n = toNum(v);
  if (n === null) return "—";
  return `₹${n.toLocaleString("en-IN", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  })}`;
};

// Plain number with separators (e.g. share quantities).
export const formatQty = (v) => {
  const n = toNum(v);
  if (n === null) return "—";
  // Trim trailing zeros so 10.0000 -> 10, 1.5000 -> 1.5
  return n.toLocaleString("en-IN", { maximumFractionDigits: 4 });
};

// Signed percentage, e.g. "+12.34%" / "-3.10%".
export const formatPct = (v) => {
  const n = toNum(v);
  if (n === null) return "—";
  const sign = n > 0 ? "+" : "";
  return `${sign}${n.toFixed(2)}%`;
};

// Signed money for P/L, e.g. "+₹1,234.00".
export const formatSignedMoney = (v) => {
  const n = toNum(v);
  if (n === null) return "—";
  const sign = n > 0 ? "+" : n < 0 ? "-" : "";
  return `${sign}${formatMoney(Math.abs(n))}`;
};

// Tailwind text colour class for a gain/loss value.
export const pnlColor = (v) => {
  const n = toNum(v);
  if (n === null || n === 0) return "text-slate-300";
  return n > 0 ? "text-emerald-400" : "text-rose-400";
};

export const formatDate = (v) => {
  if (!v) return "—";
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
};
