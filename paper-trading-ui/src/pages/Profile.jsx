import { useEffect, useState } from "react";
import { useAuth } from "../context/AuthContext";
import { cancelOrder, getOrders, getPortfolio, resetAccount } from "../services/marketApi";
import { money, qty } from "../lib/format";

function Profile() {
  const { user } = useAuth();
  const [portfolio, setPortfolio] = useState(null);
  const [orders, setOrders] = useState([]);
  const [message, setMessage] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  async function refresh() {
    const [nextPortfolio, nextOrders] = await Promise.all([getPortfolio(), getOrders()]);
    setPortfolio(nextPortfolio);
    setOrders(nextOrders);
  }

  useEffect(() => {
    let active = true;
    Promise.all([getPortfolio(), getOrders()])
      .then(([nextPortfolio, nextOrders]) => {
        if (!active) return;
        setPortfolio(nextPortfolio);
        setOrders(nextOrders);
      })
      .catch(() => {
        if (active) setError("Couldn't load profile");
      });
    return () => {
      active = false;
    };
  }, []);

  async function onCancel(orderId) {
    setBusy(true);
    setMessage(null);
    setError(null);
    try {
      await cancelOrder(orderId);
      await refresh();
      setMessage("Order cancelled.");
    } catch (err) {
      setError(err.response?.data?.message || "Cancel failed");
    } finally {
      setBusy(false);
    }
  }

  async function onReset() {
    const ok = window.confirm("Reset this paper account to $100,000 and cancel pending orders?");
    if (!ok) return;
    setBusy(true);
    setMessage(null);
    setError(null);
    try {
      const summary = await resetAccount();
      await refresh();
      setMessage(`Reset complete: ${summary.positionsLiquidated} positions liquidated, ${summary.ordersCancelled} orders cancelled.`);
    } catch (err) {
      setError(err.response?.data?.message || "Reset failed");
    } finally {
      setBusy(false);
    }
  }

  const pending = orders.filter((o) => o.status === "PENDING");

  return (
    <main className="mx-auto max-w-7xl px-4 py-6">
      <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Profile</h1>
          <p className="text-sm text-muted">{user?.email}</p>
        </div>
        <button type="button" className="btn btn-ghost border-loss/70 text-loss" onClick={onReset} disabled={busy}>
          Reset Account
        </button>
      </div>

      {message && <div className="mb-4 rounded-md border border-gain/50 p-3 text-sm text-gain">{message}</div>}
      {error && <div className="mb-4 rounded-md border border-loss/50 p-3 text-sm text-loss">{error}</div>}

      <section className="grid gap-4 md:grid-cols-3">
        <div className="card p-4">
          <div className="text-xs uppercase text-muted">Username</div>
          <div className="mt-2 font-semibold text-ink">{user?.username}</div>
        </div>
        <div className="card p-4">
          <div className="text-xs uppercase text-muted">Cash</div>
          <div className="tnum mt-2 text-xl font-semibold">{money(portfolio?.cashBalance)}</div>
        </div>
        <div className="card p-4">
          <div className="text-xs uppercase text-muted">Pending Orders</div>
          <div className="tnum mt-2 text-xl font-semibold">{pending.length}</div>
        </div>
      </section>

      <section className="card mt-6 p-4">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="font-semibold">Order History</h2>
          <span className="text-sm text-muted">{orders.length} total</span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[860px] border-collapse text-sm">
            <thead>
              <tr className="border-b border-line text-left text-xs uppercase text-muted">
                <th className="py-2 pr-4 font-semibold">Symbol</th>
                <th className="py-2 pr-4 font-semibold">Type</th>
                <th className="py-2 pr-4 font-semibold">Side</th>
                <th className="py-2 pr-4 text-right font-semibold">Qty</th>
                <th className="py-2 pr-4 text-right font-semibold">Target</th>
                <th className="py-2 pr-4 font-semibold">Status</th>
                <th className="py-2 pr-4 font-semibold">Created</th>
                <th className="py-2 text-right font-semibold">Action</th>
              </tr>
            </thead>
            <tbody>
              {orders.map((order) => (
                <tr key={order.id} className="border-b border-line/70 last:border-0">
                  <td className="py-3 pr-4 font-semibold">{order.symbol}</td>
                  <td className="py-3 pr-4 text-ink-secondary">{order.order_type}</td>
                  <td className={order.side === "BUY" ? "py-3 pr-4 text-gain" : "py-3 pr-4 text-loss"}>
                    {order.side}
                  </td>
                  <td className="tnum py-3 pr-4 text-right text-ink-secondary">{qty(order.quantity)}</td>
                  <td className="tnum py-3 pr-4 text-right text-ink-secondary">{money(order.target_price)}</td>
                  <td className="py-3 pr-4 text-ink-secondary">{order.status}</td>
                  <td className="py-3 pr-4 text-muted">{new Date(order.created_at).toLocaleString()}</td>
                  <td className="py-3 text-right">
                    {order.status === "PENDING" ? (
                      <button
                        type="button"
                        className="btn btn-ghost px-3 py-1 text-xs"
                        disabled={busy}
                        onClick={() => onCancel(order.id)}
                      >
                        Cancel
                      </button>
                    ) : (
                      <span className="text-muted">-</span>
                    )}
                  </td>
                </tr>
              ))}
              {orders.length === 0 && (
                <tr>
                  <td className="py-6 text-center text-muted" colSpan={8}>
                    No orders yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </main>
  );
}

export default Profile;
