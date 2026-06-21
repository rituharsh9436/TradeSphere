import { useMemo, useState } from "react";
import { placeOrder, errorMessage } from "../services/api";
import { useUser } from "../context/UserContext";
import { formatMoney } from "../utils/format";

// Reusable MARKET order form. `assets` powers the symbol dropdown and the live
// cost estimate; `lockedSymbol` (optional) pins the form to one symbol (used by
// the trade modal). Calls onPlaced(result) after a successful fill.
function OrderForm({ assets = [], lockedSymbol, onPlaced }) {
  const { userId } = useUser();

  const [picked, setPicked] = useState("");
  const [side, setSide] = useState("BUY");
  const [quantity, setQuantity] = useState("1");

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);
  const [success, setSuccess] = useState(null);

  // Effective symbol is derived so it stays valid as assets load, without an
  // effect: locked symbol wins, else the user's pick, else the first asset.
  const symbol = lockedSymbol || picked || assets[0]?.symbol || "";

  const selected = useMemo(
    () => assets.find((a) => a.symbol === symbol),
    [assets, symbol]
  );

  const qtyNum = parseFloat(quantity);
  const price = selected ? parseFloat(selected.currentPrice) : NaN;
  const estimate =
    Number.isFinite(qtyNum) && Number.isFinite(price) ? qtyNum * price : null;

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError(null);
    setSuccess(null);

    if (!symbol) return setError("Please choose a symbol.");
    if (!Number.isFinite(qtyNum) || qtyNum <= 0)
      return setError("Quantity must be greater than zero.");

    setSubmitting(true);
    try {
      const result = await placeOrder({ userId, symbol, side, quantity: qtyNum });
      setSuccess(
        `${side} ${qtyNum} ${symbol} filled at ${formatMoney(result.executedPrice)} ` +
          `(total ${formatMoney(result.totalAmount)}).`
      );
      setQuantity("1");
      onPlaced?.(result);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setSubmitting(false);
    }
  };

  const inputCls =
    "w-full rounded-lg border border-slate-700 bg-slate-950/70 px-3 py-2 text-sm text-slate-100 outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500";

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      {/* Buy / Sell toggle */}
      <div className="grid grid-cols-2 gap-2 rounded-lg bg-slate-950/60 p-1">
        {["BUY", "SELL"].map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => setSide(s)}
            className={`rounded-md py-2 text-sm font-semibold transition ${
              side === s
                ? s === "BUY"
                  ? "bg-emerald-600 text-white"
                  : "bg-rose-600 text-white"
                : "text-slate-400 hover:text-slate-200"
            }`}
          >
            {s}
          </button>
        ))}
      </div>

      <div>
        <label className="mb-1 block text-xs font-medium text-slate-400">Symbol</label>
        {lockedSymbol ? (
          <div className="rounded-lg border border-slate-700 bg-slate-950/40 px-3 py-2 text-sm font-semibold text-white">
            {lockedSymbol}
            {selected && (
              <span className="ml-2 font-normal text-slate-400">
                {formatMoney(selected.currentPrice)}
              </span>
            )}
          </div>
        ) : (
          <select
            className={inputCls}
            value={symbol}
            onChange={(e) => setPicked(e.target.value)}
          >
            {assets.map((a) => (
              <option key={a.symbol} value={a.symbol}>
                {a.symbol} — {formatMoney(a.currentPrice)}
              </option>
            ))}
          </select>
        )}
      </div>

      <div>
        <label className="mb-1 block text-xs font-medium text-slate-400">Quantity</label>
        <input
          type="number"
          min="0"
          step="any"
          className={inputCls}
          value={quantity}
          onChange={(e) => setQuantity(e.target.value)}
        />
      </div>

      <div className="flex items-center justify-between rounded-lg border border-slate-800 bg-slate-950/40 px-3 py-2.5 text-sm">
        <span className="text-slate-400">Estimated {side === "BUY" ? "cost" : "proceeds"}</span>
        <span className="font-semibold text-white">
          {estimate === null ? "—" : formatMoney(estimate)}
        </span>
      </div>

      {error && (
        <p className="rounded-lg border border-rose-900/60 bg-rose-950/40 px-3 py-2 text-sm text-rose-300">
          {error}
        </p>
      )}
      {success && (
        <p className="rounded-lg border border-emerald-900/60 bg-emerald-950/40 px-3 py-2 text-sm text-emerald-300">
          {success}
        </p>
      )}

      <button
        type="submit"
        disabled={submitting}
        className={`w-full rounded-lg px-4 py-2.5 text-sm font-semibold text-white transition disabled:cursor-not-allowed disabled:opacity-60 ${
          side === "BUY" ? "bg-emerald-600 hover:bg-emerald-500" : "bg-rose-600 hover:bg-rose-500"
        }`}
      >
        {submitting ? "Placing order…" : `Place ${side} order`}
      </button>
    </form>
  );
}

export default OrderForm;
