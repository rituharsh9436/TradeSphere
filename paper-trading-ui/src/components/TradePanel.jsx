import { useState } from "react";
import { ArrowDownRight, ArrowUpRight, Send } from "lucide-react";
import { useAuth } from "../context/AuthContext";
import { money, qty } from "../lib/format";
import { placeLimitOrder, placeOrder } from "../services/marketApi";

const QUICK_QTY = ["1", "5", "10"];
const PCT_QTY = [25, 50, 100];

function TradePanel({ symbol, price, portfolio, onOrderPlaced }) {
  const { user } = useAuth();
  const [side, setSide] = useState("BUY");
  const [orderType, setOrderType] = useState("MARKET");
  const [quantity, setQuantity] = useState("1");
  const [targetPrice, setTargetPrice] = useState("");
  const [status, setStatus] = useState(null);
  const [busy, setBusy] = useState(false);

  const numericPrice = Number(orderType === "LIMIT" && targetPrice ? targetPrice : price);
  const numericQuantity = Number(quantity);
  const estimatedValue = numericPrice > 0 && numericQuantity > 0 ? numericPrice * numericQuantity : 0;
  const owned = portfolio?.positions?.find((p) => p.symbol === symbol)?.quantity || 0;
  const cash = Number(portfolio?.cashBalance || 0);

  function setPercentQuantity(percent) {
    if (side === "BUY") {
      const shares = numericPrice > 0 ? (cash * (percent / 100)) / numericPrice : 0;
      setQuantity(shares ? shares.toFixed(4).replace(/\.?0+$/, "") : "0");
      return;
    }
    const shares = Number(owned || 0) * (percent / 100);
    setQuantity(shares ? shares.toFixed(4).replace(/\.?0+$/, "") : "0");
  }

  async function submit() {
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

      const nextStatus =
        orderType === "LIMIT"
          ? {
              ok: true,
              message: `${side} limit submitted for ${quantity} ${symbol} @ ${money(result.order.target_price)}`,
            }
          : {
              ok: true,
              message: `${side} ${quantity} ${symbol} filled @ ${money(result.executedPrice)}`,
            };
      setStatus(nextStatus);
      onOrderPlaced?.(nextStatus);
    } catch (err) {
      const nextStatus = { ok: false, message: err.response?.data?.message || "Order failed" };
      setStatus(nextStatus);
      onOrderPlaced?.(nextStatus);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="flex flex-col gap-5" onSubmit={(e) => e.preventDefault()}>
      <div className="rounded-md border border-line bg-surface-2 p-3">
        <div className="flex items-center justify-between gap-3">
          <span className="text-xs uppercase text-muted">Demo account</span>
          <span className="text-sm font-semibold text-ink-secondary">{user?.username}</span>
        </div>
        <div className="mt-3 flex items-end justify-between gap-3">
          <div>
            <div className="text-xs uppercase text-muted">{symbol}</div>
            <div className="tnum mt-0.5 text-2xl font-bold tracking-tight text-ink">{money(price)}</div>
          </div>
          <span className="rounded-md bg-accent/10 border border-accent/20 px-2 py-1 text-[11px] font-bold uppercase tracking-wide text-accent">
            Live
          </span>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <button
          type="button"
          onClick={() => setSide("BUY")}
          className={`btn h-11 transition-all ${side === "BUY" ? "btn-up shadow-[0_0_12px_rgba(33,201,131,0.15)] ring-1 ring-gain/50" : "btn-ghost opacity-70 hover:opacity-100"}`}
        >
          <ArrowUpRight className={`h-4 w-4 ${side === "BUY" ? "" : "text-gain"}`} aria-hidden="true" />
          Buy
        </button>
        <button
          type="button"
          onClick={() => setSide("SELL")}
          className={`btn h-11 transition-all ${side === "SELL" ? "btn-down shadow-[0_0_12px_rgba(255,91,107,0.15)] ring-1 ring-loss/50" : "btn-ghost opacity-70 hover:opacity-100"}`}
        >
          <ArrowDownRight className={`h-4 w-4 ${side === "SELL" ? "" : "text-loss"}`} aria-hidden="true" />
          Sell
        </button>
      </div>

      <div className="inline-flex rounded-md border border-line bg-surface-2 p-1">
        {["MARKET", "LIMIT"].map((value) => (
          <button
            key={value}
            type="button"
            onClick={() => setOrderType(value)}
            className={`flex-1 rounded px-3 py-1.5 text-xs font-semibold uppercase tracking-wider transition-all ${
              orderType === value
                ? "bg-surface-hover text-ink shadow-sm"
                : "text-muted hover:bg-surface-3 hover:text-ink"
            }`}
          >
            {value}
          </button>
        ))}
      </div>

      <label className="text-sm">
        <span className="mb-1.5 block font-medium text-ink-secondary">Quantity</span>
        <input
          className="field tnum font-medium"
          type="number"
          min="0"
          step="any"
          value={quantity}
          onChange={(e) => setQuantity(e.target.value)}
        />
      </label>

      <div className="grid grid-cols-6 gap-1.5">
        {QUICK_QTY.map((value) => (
          <button key={value} type="button" className="rounded border border-line bg-surface-2 px-2 py-1.5 text-xs font-semibold text-muted transition-colors hover:bg-surface-hover hover:text-ink" onClick={() => setQuantity(value)}>
            {value}
          </button>
        ))}
        {PCT_QTY.map((value) => (
          <button key={value} type="button" className="rounded border border-line bg-surface-2 px-2 py-1.5 text-xs font-semibold text-muted transition-colors hover:bg-surface-hover hover:text-ink" onClick={() => setPercentQuantity(value)}>
            {value === 100 ? "Max" : `${value}%`}
          </button>
        ))}
      </div>

      {orderType === "LIMIT" && (
        <label className="text-sm">
          <span className="mb-1.5 block font-medium text-ink-secondary">Limit price</span>
          <input
            className="field tnum font-medium"
            type="number"
            min="0"
            step="any"
            placeholder={Number(price) ? Number(price).toFixed(2) : "0.00"}
            value={targetPrice}
            onChange={(e) => setTargetPrice(e.target.value)}
          />
        </label>
      )}

      <div className="rounded-md border border-line bg-surface-2 p-3 text-sm">
        <div className="flex justify-between gap-3">
          <span className="text-muted">Estimated value</span>
          <span className="tnum font-semibold text-ink-secondary">{money(estimatedValue)}</span>
        </div>
        <div className="mt-2.5 flex justify-between gap-3">
          <span className="text-muted">Available cash</span>
          <span className="tnum text-ink-secondary">{money(portfolio?.cashBalance)}</span>
        </div>
        <div className="mt-2.5 flex justify-between gap-3">
          <span className="text-muted">Owned {symbol}</span>
          <span className="tnum text-ink-secondary">{qty(owned)}</span>
        </div>
      </div>

      <button
        type="button"
        onClick={submit}
        className={`btn group h-12 text-base shadow-sm transition-all ${side === "BUY" ? "btn-up hover:shadow-[0_4px_12px_rgba(33,201,131,0.2)]" : "btn-down hover:shadow-[0_4px_12px_rgba(255,91,107,0.2)]"}`}
        disabled={busy}
      >
        <Send className="h-4 w-4 transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5" aria-hidden="true" />
        {busy ? "Submitting..." : `${side} ${symbol}`}
      </button>

      {status && (
        <div role="status" className={`rounded-md border p-3 text-sm ${
          status.ok ? "border-gain/50 bg-gain/10 text-gain" : "border-loss/50 bg-loss/10 text-loss"
        }`}>
          {status.message}
        </div>
      )}
    </form>
  );
}

export default TradePanel;
