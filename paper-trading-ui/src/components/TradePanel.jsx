import { useState } from "react";
import { useAuth } from "../context/AuthContext";
import { money } from "../lib/format";
import { placeLimitOrder, placeOrder } from "../services/marketApi";

// Buy/Sell for the selected symbol as the authenticated user. Market orders
// fill immediately; limit orders rest until the backend matcher sees a cross.
function TradePanel({ symbol, price }) {
  const { user } = useAuth();
  const [side, setSide] = useState("BUY");
  const [orderType, setOrderType] = useState("MARKET");
  const [quantity, setQuantity] = useState("1");
  const [targetPrice, setTargetPrice] = useState("");
  const [status, setStatus] = useState(null);
  const [busy, setBusy] = useState(false);

  async function submit(e) {
    e.preventDefault();
    if (!(Number(quantity) > 0)) {
      setStatus({ ok: false, message: "Quantity must be greater than 0." });
      return;
    }
    if (orderType === "LIMIT" && !(Number(targetPrice) > 0)) {
      setStatus({ ok: false, message: "Limit price must be greater than 0." });
      return;
    }

    setBusy(true);
    setStatus(null);
    try {
      const result =
        orderType === "LIMIT"
          ? await placeLimitOrder({ symbol, side, quantity: Number(quantity), targetPrice })
          : await placeOrder({ symbol, side, quantity: Number(quantity) });

      if (orderType === "LIMIT") {
        setStatus({
          ok: true,
          message: `${side} limit submitted for ${quantity} ${symbol} @ ${money(result.order.target_price)}`,
        });
      } else {
        setStatus({
          ok: true,
          message: `${side} ${quantity} ${symbol} filled @ ${money(result.executedPrice)}`,
        });
      }
    } catch (err) {
      setStatus({ ok: false, message: err.response?.data?.message || "Order failed" });
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="flex flex-col gap-4" onSubmit={submit}>
      <div>
        <div className="text-xs uppercase text-muted">Trading as</div>
        <div className="mt-1 font-semibold text-ink">{user?.username}</div>
      </div>

      <div className="rounded-md border border-line bg-plane p-3">
        <div className="text-xs uppercase text-muted">{symbol} live</div>
        <div className="tnum mt-1 text-xl font-semibold">{money(price)}</div>
      </div>

      <div className="grid grid-cols-2 gap-2">
        {["BUY", "SELL"].map((value) => (
          <button
            key={value}
            type="button"
            onClick={() => setSide(value)}
            className={`btn ${side === value ? "btn-primary" : "btn-ghost"} ${
              value === "SELL" && side === value ? "bg-loss hover:bg-loss" : ""
            }`}
          >
            {value}
          </button>
        ))}
      </div>

      <div className="inline-flex rounded-md border border-line bg-plane p-1">
        {["MARKET", "LIMIT"].map((value) => (
          <button
            key={value}
            type="button"
            onClick={() => setOrderType(value)}
            className={`flex-1 rounded px-3 py-1 text-sm font-semibold transition-colors ${
              orderType === value
                ? "bg-surface-2 text-ink"
                : "text-muted hover:bg-surface-2 hover:text-ink"
            }`}
          >
            {value}
          </button>
        ))}
      </div>

      <label className="text-sm">
        <span className="mb-1 block text-muted">Quantity</span>
        <input
          className="field"
          type="number"
          min="0"
          step="any"
          value={quantity}
          onChange={(e) => setQuantity(e.target.value)}
        />
      </label>

      {orderType === "LIMIT" && (
        <label className="text-sm">
          <span className="mb-1 block text-muted">Limit price</span>
          <input
            className="field"
            type="number"
            min="0"
            step="any"
            placeholder={Number(price) ? Number(price).toFixed(2) : "0.00"}
            value={targetPrice}
            onChange={(e) => setTargetPrice(e.target.value)}
          />
        </label>
      )}

      <button type="submit" className="btn btn-primary" disabled={busy}>
        {busy ? "Submitting..." : `${side} ${orderType}`}
      </button>

      {status && (
        <div className={`rounded-md border p-3 text-sm ${
          status.ok ? "border-gain/50 text-gain" : "border-loss/50 text-loss"
        }`}>
          {status.message}
        </div>
      )}
    </form>
  );
}

export default TradePanel;
