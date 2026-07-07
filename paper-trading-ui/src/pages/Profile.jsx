import { useEffect, useState } from "react";
import { RotateCcw, XCircle } from "lucide-react";
import ConfirmResetModal from "../components/ConfirmResetModal";
import Skeleton from "../components/Skeleton";
import StatusBadge from "../components/StatusBadge";
import Toast from "../components/Toast";
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
  const [loading, setLoading] = useState(true);
  const [resetOpen, setResetOpen] = useState(false);
  const [confirmText, setConfirmText] = useState("");

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
      })
      .finally(() => {
        if (active) setLoading(false);
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
    setBusy(true);
    setMessage(null);
    setError(null);
    try {
      const summary = await resetAccount();
      await refresh();
      setMessage(`Reset complete: ${summary.positionsLiquidated} positions liquidated, ${summary.ordersCancelled} orders cancelled.`);
      setResetOpen(false);
      setConfirmText("");
    } catch (err) {
      setError(err.response?.data?.message || "Reset failed");
    } finally {
      setBusy(false);
    }
  }

  const pending = orders.filter((o) => o.status === "PENDING");

  return (
    <main className="mx-auto max-w-7xl px-4 pb-24 pt-6 md:pb-6">
      <Toast message={message || error} type={message ? "success" : "error"} onClose={() => { setMessage(null); setError(null); }} />
      <ConfirmResetModal
        open={resetOpen}
        portfolio={portfolio}
        pendingCount={pending.length}
        busy={busy}
        confirmText={confirmText}
        onConfirmText={setConfirmText}
        onCancel={() => { setResetOpen(false); setConfirmText(""); }}
        onConfirm={onReset}
      />
      <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Profile</h1>
          <p className="text-sm text-muted">{user?.email}</p>
        </div>
        <button type="button" className="btn btn-ghost border-loss/70 text-loss" onClick={() => setResetOpen(true)} disabled={busy}>
          <RotateCcw className="h-4 w-4" aria-hidden="true" />
          Reset Account
        </button>
      </div>

      <section className="grid gap-4 md:grid-cols-3">
        {loading ? (
          <>
            <Skeleton className="h-24" />
            <Skeleton className="h-24" />
            <Skeleton className="h-24" />
          </>
        ) : (
          <>
            <div className="card p-4">
              <div className="text-xs uppercase text-muted">Username</div>
              <div className="mt-2 text-2xl font-semibold text-ink">{user?.username}</div>
            </div>
            <div className="card p-4">
              <div className="text-xs uppercase text-muted">Cash</div>
              <div className="tnum mt-2 text-2xl font-semibold">{money(portfolio?.cashBalance)}</div>
            </div>
            <div className="card p-4">
              <div className="text-xs uppercase text-muted">Pending Orders</div>
              <div className="tnum mt-2 text-2xl font-semibold">{pending.length}</div>
            </div>
          </>
        )}
      </section>

      <section className="card mt-6 p-4">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="font-semibold">Order History</h2>
          <span className="text-sm text-muted">{orders.length} total</span>
        </div>
        {loading ? (
          <div className="space-y-3">
            {Array.from({ length: 6 }).map((_, index) => <Skeleton key={index} className="h-9 w-full" />)}
          </div>
        ) : (
        <>
        <div className="grid gap-3 md:hidden">
          {orders.map((order) => (
            <article key={order.id} className="rounded-md border border-line bg-plane p-3">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <div className="font-semibold">{order.symbol}</div>
                  <div className="mt-1 text-xs text-muted">{new Date(order.created_at).toLocaleString()}</div>
                </div>
                <StatusBadge>{order.status}</StatusBadge>
              </div>
              <div className="mt-3 grid grid-cols-2 gap-3 text-sm">
                <div>
                  <div className="text-xs uppercase text-muted">Side</div>
                  <div className="mt-1"><StatusBadge>{order.side}</StatusBadge></div>
                </div>
                <div>
                  <div className="text-xs uppercase text-muted">Type</div>
                  <div className="mt-1 text-ink-secondary">{order.order_type}</div>
                </div>
                <div>
                  <div className="text-xs uppercase text-muted">Qty</div>
                  <div className="tnum mt-1 text-ink-secondary">{qty(order.quantity)}</div>
                </div>
                <div>
                  <div className="text-xs uppercase text-muted">Target</div>
                  <div className="tnum mt-1 text-ink-secondary">{money(order.target_price)}</div>
                </div>
              </div>
              {order.status === "PENDING" && (
                <button type="button" className="btn btn-ghost mt-3 w-full px-3 py-1 text-xs" disabled={busy} onClick={() => onCancel(order.id)}>
                  <XCircle className="h-4 w-4" aria-hidden="true" />
                  Cancel
                </button>
              )}
            </article>
          ))}
        </div>
        <div className="hidden overflow-x-auto md:block">
          <table className="w-full min-w-[860px] border-collapse text-sm">
            <thead className="sticky top-0 bg-surface">
              <tr className="border-b border-line text-left text-xs uppercase text-muted">
                <th className="py-2 pr-4 pl-4 font-semibold">Symbol</th>
                <th className="py-2 pr-4 font-semibold">Type</th>
                <th className="py-2 pr-4 font-semibold">Side</th>
                <th className="py-2 pr-4 text-right font-semibold">Qty</th>
                <th className="py-2 pr-4 text-right font-semibold">Target</th>
                <th className="py-2 pr-4 font-semibold">Status</th>
                <th className="py-2 pr-4 font-semibold">Created</th>
                <th className="py-2 pr-4 text-right font-semibold">Action</th>
              </tr>
            </thead>
            <tbody>
              {orders.map((order) => (
                <tr key={order.id} className="table-row border-b border-line/70 last:border-0">
                  <td className="py-3 pr-4 pl-4 font-semibold">{order.symbol}</td>
                  <td className="py-3 pr-4 text-ink-secondary">{order.order_type}</td>
                  <td className="py-3 pr-4">
                    <StatusBadge>{order.side}</StatusBadge>
                  </td>
                  <td className="tnum py-3 pr-4 text-right text-ink-secondary">{qty(order.quantity)}</td>
                  <td className="tnum py-3 pr-4 text-right text-ink-secondary">{money(order.target_price)}</td>
                  <td className="py-3 pr-4"><StatusBadge>{order.status}</StatusBadge></td>
                  <td className="py-3 pr-4 text-muted">{new Date(order.created_at).toLocaleString()}</td>
                  <td className="py-3 pr-4 text-right">
                    {order.status === "PENDING" ? (
                      <button
                        type="button"
                        className="btn btn-ghost px-3 py-1 text-xs"
                        disabled={busy}
                        onClick={() => onCancel(order.id)}
                      >
                        <XCircle className="h-4 w-4" aria-hidden="true" />
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
        </>
        )}
      </section>
    </main>
  );
}

export default Profile;
