import { useState } from "react";
import { ArrowDownRight, ArrowUpRight, Send } from "lucide-react";
import { useAuth } from "../context/AuthContext";
import { money, qty } from "../lib/format";
import { placeAdvancedOrder, placeLimitOrder, placeOrder } from "../services/marketApi";
import { Button } from "./ui/Button";
import { Input } from "./ui/Input";
import { Badge } from "./ui/Badge";

const QUICK_QTY = ["1", "5", "10"];
const PCT_QTY = [25, 50, 100];

function TradePanel({ symbol, price, portfolio, onOrderPlaced }) {
  const { user } = useAuth();
  const [side, setSide] = useState("BUY");
  const [orderType, setOrderType] = useState("MARKET"); // "MARKET", "LIMIT", "STOP_LOSS", "TAKE_PROFIT", "TRAILING_STOP"
  const [quantity, setQuantity] = useState("1");
  const [targetPrice, setTargetPrice] = useState("");
  const [triggerPrice, setTriggerPrice] = useState("");
  const [trailType, setTrailType] = useState("AMOUNT"); // "AMOUNT" or "PERCENT"
  const [trailValue, setTrailValue] = useState("");
  const [timeInForce, setTimeInForce] = useState("DAY");
  const [status, setStatus] = useState(null);
  const [busy, setBusy] = useState(false);

  const isLimit = orderType === "LIMIT";
  const isAdvanced = ["STOP_LOSS", "TAKE_PROFIT", "TRAILING_STOP"].includes(orderType);
  const numericPrice = Number((isLimit && targetPrice) ? targetPrice : price);
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
    if (isLimit && !(Number(targetPrice) > 0)) {
      setStatus({ ok: false, message: "Limit price must be greater than 0." });
      return;
    }
    if ((orderType === "STOP_LOSS" || orderType === "TAKE_PROFIT") && !(Number(triggerPrice) > 0)) {
      setStatus({ ok: false, message: "Trigger price must be greater than 0." });
      return;
    }
    if (orderType === "TRAILING_STOP" && !(Number(trailValue) > 0)) {
      setStatus({ ok: false, message: "Trail amount/percent must be greater than 0." });
      return;
    }

    setBusy(true);
    setStatus(null);
    try {
      let result;
      if (isLimit) {
        result = await placeLimitOrder({ symbol, side, quantity: Number(quantity), targetPrice });
      } else if (isAdvanced) {
        result = await placeAdvancedOrder({
          symbol,
          side,
          quantity: Number(quantity),
          advancedType: orderType,
          triggerPrice: orderType !== "TRAILING_STOP" ? triggerPrice : undefined,
          trailAmount: orderType === "TRAILING_STOP" && trailType === "AMOUNT" ? trailValue : undefined,
          trailPercent: orderType === "TRAILING_STOP" && trailType === "PERCENT" ? trailValue : undefined,
          timeInForce,
        });
      } else {
        result = await placeOrder({ symbol, side, quantity: Number(quantity) });
      }

      let successMessage = "";
      if (isLimit) {
        successMessage = `${side} limit submitted for ${quantity} ${symbol} @ ${money(result.order.target_price)}`;
      } else if (isAdvanced) {
        successMessage = `${side} ${orderType.replace('_', ' ').toLowerCase()} submitted for ${quantity} ${symbol}`;
      } else {
        successMessage = `${side} ${quantity} ${symbol} filled @ ${money(result.executedPrice)}`;
      }

      const nextStatus = { ok: true, message: successMessage };
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
          <span className="text-sm font-semibold text-ink-secondary">{user?.full_name || user?.username}</span>
        </div>
        <div className="mt-3 flex items-end justify-between gap-3">
          <div>
            <div className="text-xs uppercase text-muted">{symbol}</div>
            <div className="tnum mt-0.5 text-2xl font-bold tracking-tight text-ink">{money(price)}</div>
          </div>
          <Badge variant="default" className="text-[11px] font-bold tracking-wide">
            Live
          </Badge>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <Button
          type="button"
          onClick={() => setSide("BUY")}
          variant={side === "BUY" ? "up" : "ghost"}
          className={`h-11 transition-all ${side === "BUY" ? "shadow-[0_0_12px_rgba(33,201,131,0.15)] ring-1 ring-gain/50" : "opacity-70 hover:opacity-100"}`}
        >
          <ArrowUpRight className={`h-4 w-4 ${side === "BUY" ? "" : "text-gain"}`} aria-hidden="true" />
          Buy
        </Button>
        <Button
          type="button"
          onClick={() => setSide("SELL")}
          variant={side === "SELL" ? "down" : "ghost"}
          className={`h-11 transition-all ${side === "SELL" ? "shadow-[0_0_12px_rgba(255,91,107,0.15)] ring-1 ring-loss/50" : "opacity-70 hover:opacity-100"}`}
        >
          <ArrowDownRight className={`h-4 w-4 ${side === "SELL" ? "" : "text-loss"}`} aria-hidden="true" />
          Sell
        </Button>
      </div>

      <label className="text-sm">
        <span className="mb-1.5 block font-medium text-ink-secondary">Order Type</span>
        <select
          className="field font-medium cursor-pointer"
          value={orderType}
          onChange={(e) => setOrderType(e.target.value)}
        >
          <option value="MARKET">Market</option>
          <option value="LIMIT">Limit</option>
          <option value="STOP_LOSS">Stop Loss</option>
          <option value="TAKE_PROFIT">Take Profit</option>
          <option value="TRAILING_STOP">Trailing Stop</option>
        </select>
      </label>

      <label className="text-sm">
        <span className="mb-1.5 block font-medium text-ink-secondary">Quantity</span>
        <Input
          className="tnum font-medium"
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

      {isLimit && (
        <label className="text-sm">
          <span className="mb-1.5 block font-medium text-ink-secondary">Limit Price</span>
          <Input
            className="tnum font-medium"
            type="number"
            min="0"
            step="any"
            placeholder={Number(price) ? Number(price).toFixed(2) : "0.00"}
            value={targetPrice}
            onChange={(e) => setTargetPrice(e.target.value)}
          />
        </label>
      )}

      {(orderType === "STOP_LOSS" || orderType === "TAKE_PROFIT") && (
        <label className="text-sm">
          <span className="mb-1.5 block font-medium text-ink-secondary">Trigger Price</span>
          <Input
            className="tnum font-medium"
            type="number"
            min="0"
            step="any"
            placeholder={Number(price) ? Number(price).toFixed(2) : "0.00"}
            value={triggerPrice}
            onChange={(e) => setTriggerPrice(e.target.value)}
          />
        </label>
      )}

      {orderType === "TRAILING_STOP" && (
        <div className="grid grid-cols-2 gap-3">
          <label className="text-sm">
            <span className="mb-1.5 block font-medium text-ink-secondary">Trail Type</span>
            <select
              className="field font-medium cursor-pointer"
              value={trailType}
              onChange={(e) => setTrailType(e.target.value)}
            >
              <option value="AMOUNT">Amount ($)</option>
              <option value="PERCENT">Percent (%)</option>
            </select>
          </label>
          <label className="text-sm">
            <span className="mb-1.5 block font-medium text-ink-secondary">
              Trail {trailType === "AMOUNT" ? "Amount" : "Percent"}
            </span>
            <Input
              className="tnum font-medium"
              type="number"
              min="0"
              step="any"
              placeholder="0.00"
              value={trailValue}
              onChange={(e) => setTrailValue(e.target.value)}
            />
          </label>
        </div>
      )}

      {(isLimit || isAdvanced) && (
        <div className="inline-flex rounded-md border border-line bg-surface-2 p-1">
          {["DAY", "GTC"].map((value) => (
            <button
              key={value}
              type="button"
              onClick={() => setTimeInForce(value)}
              className={`flex-1 rounded px-3 py-1.5 text-xs font-semibold uppercase tracking-wider transition-all ${
                timeInForce === value
                  ? "bg-surface-hover text-ink shadow-sm"
                  : "text-muted hover:bg-surface-3 hover:text-ink"
              }`}
            >
              {value === "DAY" ? "Day" : "GTC"}
            </button>
          ))}
        </div>
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

      <div className="fixed bottom-[60px] left-0 z-40 w-full border-t border-line bg-surface p-4 shadow-2xl lg:static lg:border-none lg:bg-transparent lg:p-0 lg:shadow-none">
        <Button
          type="button"
          onClick={submit}
          variant={side === "BUY" ? "up" : "down"}
          className={`group h-12 w-full text-base shadow-sm transition-all ${side === "BUY" ? "hover:shadow-[0_4px_12px_rgba(33,201,131,0.2)]" : "hover:shadow-[0_4px_12px_rgba(255,91,107,0.2)]"}`}
          disabled={busy}
        >
          <Send className="h-4 w-4 transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5" aria-hidden="true" />
          {busy ? "Submitting..." : `${side} ${symbol}`}
        </Button>
      </div>

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
