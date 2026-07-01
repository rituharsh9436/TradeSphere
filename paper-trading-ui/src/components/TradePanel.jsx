import { useState } from "react";
import { placeOrder } from "../services/marketApi";
import { useActiveUser } from "../context/ActiveUserContext";

// Buy/Sell for the selected symbol using the dev active user. Thin adapter over
// POST /api/orders; surfaces the backend's fill result or error message.
function TradePanel({ symbol, price }) {
  const { activeUser } = useActiveUser();
  const [quantity, setQuantity] = useState("1");
  const [status, setStatus] = useState(null); // { ok, message }
  const [busy, setBusy] = useState(false);

  async function submit(side) {
    setBusy(true);
    setStatus(null);
    try {
      const result = await placeOrder({
        userId: activeUser.id,
        symbol,
        side,
        quantity: Number(quantity),
      });
      setStatus({ ok: true, message: `${side} ${quantity} ${symbol} @ $${Number(result.executedPrice).toFixed(2)}` });
    } catch (err) {
      setStatus({ ok: false, message: err.response?.data?.message || "Order failed" });
    } finally {
      setBusy(false);
    }
  }

  if (!activeUser) {
    return <div>Select a user (top-right) to trade.</div>;
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
      <div>Trading as <strong>{activeUser.username}</strong></div>
      <div>{symbol} @ ${Number(price).toFixed(2)}</div>
      <input
        type="number" min="0" step="any" value={quantity}
        onChange={(e) => setQuantity(e.target.value)}
      />
      <div style={{ display: "flex", gap: "8px" }}>
        <button type="button" disabled={busy} onClick={() => submit("BUY")}>Buy</button>
        <button type="button" disabled={busy} onClick={() => submit("SELL")}>Sell</button>
      </div>
      {status && (
        <div style={{ color: status.ok ? "green" : "crimson" }}>{status.message}</div>
      )}
    </div>
  );
}

export default TradePanel;
