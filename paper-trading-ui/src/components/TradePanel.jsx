import { useState } from "react";
import { useAuth } from "../context/AuthContext";
import { money } from "../lib/format";
import { placeLimitOrder, placeOrder } from "../services/marketApi";

function TradePanel({ symbol, price }) {
  const { user } = useAuth();
  const [orderType, setOrderType] = useState("MARKET");
  const [quantity, setQuantity] = useState("1");
  const [targetPrice, setTargetPrice] = useState("");
  const [status, setStatus] = useState(null);
  const [busy, setBusy] = useState(false);

  async function submit(side) {
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

      setStatus(
        orderType === "LIMIT"
          ? {
              ok: true,
              message: `${side} limit submitted for ${quantity} ${symbol} @ ${money(result.order.target_price)}`,
            }
          : {
              ok: true,
              message: `${side} ${quantity} ${symbol} filled @ ${money(result.executedPrice)}`,
            }
      );
    } catch (err) {
      setStatus({ ok: false, message: err.response?.data?.message || "Order failed" });
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="flex flex-col gap-4" onSubmit={(e) => e.preventDefault()}>
      <div className="rounded-md border border-line bg-plane p-3">
        <div className="flex items-center justify-between gap-3">
          <span className="text-xs uppercase text-muted">Demo account</span>
          <span className="text-sm font-semibold text-ink-secondary">{user?.username}</span>
        </div>
        <div className="mt-3 flex items-end justify-between gap-3">
          <div>
            <div className="text-xs uppercase text-muted">{symbol}</div>
            <div className="tnum mt-1 text-2xl font-semibold">{money(price)}</div>
          </div>
          <span className="rounded-md bg-surface-3 px-2 py-1 text-xs font-semibold text-accent">
            Live
          </span>
        </div>
      </div>

      <div className="inline-flex rounded-md border border-line bg-plane p-1">
        {["MARKET", "LIMIT"].map((value) => (
          <button
            key={value}
            type="button"
            onClick={() => setOrderType(value)}
            className={`flex-1 rounded px-3 py-1 text-sm font-semibold transition-colors ${
              orderType === value
                ? "bg-surface-3 text-ink"
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
          className="field tnum"
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
            className="field tnum"
            type="number"
            min="0"
            step="any"
            placeholder={Number(price) ? Number(price).toFixed(2) : "0.00"}
            value={targetPrice}
            onChange={(e) => setTargetPrice(e.target.value)}
          />
        </label>
      )}

      <div className="grid gap-2">
        <button
          type="button"
          onClick={() => submit("BUY")}
          className="btn btn-up h-12 text-base"
          disabled={busy}
        >
          Buy
        </button>
        <button
          type="button"
          onClick={() => submit("SELL")}
          className="btn btn-down h-12 text-base"
          disabled={busy}
        >
          Sell
        </button>
      </div>

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
