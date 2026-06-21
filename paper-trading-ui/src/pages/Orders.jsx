import { useEffect, useState, useCallback } from "react";
import { getOrders, errorMessage } from "../services/api";
import { useUser } from "../context/UserContext";
import { formatMoney, formatQty, formatDate } from "../utils/format";

const STATUS_BADGE = {
  FILLED: "bg-emerald-500/15 text-emerald-300",
  PENDING: "bg-amber-500/15 text-amber-300",
  CANCELLED: "bg-slate-500/15 text-slate-300",
  REJECTED: "bg-rose-500/15 text-rose-300",
};

function Orders() {
  const { userId } = useUser();
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const load = useCallback(async () => {
    if (!userId) return;
    try {
      const data = await getOrders(userId);
      setOrders(data || []);
      setError(null);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setLoading(false);
    }
  }, [userId]);

  useEffect(() => {
    (async () => {
      await load();
    })();
  }, [load]);

  const refresh = () => {
    setLoading(true);
    load();
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">Order History</h1>
          <p className="text-sm text-slate-400">All orders placed on your account.</p>
        </div>
        <button
          onClick={refresh}
          className="rounded-lg border border-slate-700 px-3 py-2 text-sm text-slate-300 transition hover:border-slate-500 hover:text-white"
        >
          ↻ Refresh
        </button>
      </div>

      {error && (
        <p className="rounded-lg border border-rose-900/60 bg-rose-950/40 px-4 py-3 text-sm text-rose-300">
          {error}
        </p>
      )}

      {loading ? (
        <div className="rounded-2xl border border-slate-800 bg-slate-900/40 p-10 text-center text-slate-400">
          Loading orders…
        </div>
      ) : orders.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-slate-800 bg-slate-900/40 p-10 text-center text-slate-400">
          No orders yet.
        </div>
      ) : (
        <div className="overflow-x-auto rounded-2xl border border-slate-800 bg-slate-900/60">
          <table className="w-full min-w-[680px] text-left text-sm">
            <thead>
              <tr className="border-b border-slate-800 text-xs uppercase tracking-wide text-slate-400">
                <th className="px-5 py-3 font-medium">Date</th>
                <th className="px-5 py-3 font-medium">Symbol</th>
                <th className="px-5 py-3 font-medium">Side</th>
                <th className="px-5 py-3 font-medium">Type</th>
                <th className="px-5 py-3 text-right font-medium">Qty</th>
                <th className="px-5 py-3 text-right font-medium">Target</th>
                <th className="px-5 py-3 text-center font-medium">Status</th>
              </tr>
            </thead>
            <tbody>
              {orders.map((o) => (
                <tr
                  key={o.id}
                  className="border-b border-slate-800/60 last:border-0 hover:bg-slate-800/30"
                >
                  <td className="px-5 py-3 text-slate-400">{formatDate(o.created_at)}</td>
                  <td className="px-5 py-3 font-semibold text-white">{o.symbol}</td>
                  <td className="px-5 py-3">
                    <span
                      className={
                        o.side === "BUY" ? "text-emerald-400" : "text-rose-400"
                      }
                    >
                      {o.side}
                    </span>
                  </td>
                  <td className="px-5 py-3 text-slate-300">{o.order_type}</td>
                  <td className="px-5 py-3 text-right text-slate-300">
                    {formatQty(o.quantity)}
                  </td>
                  <td className="px-5 py-3 text-right text-slate-300">
                    {o.target_price ? formatMoney(o.target_price) : "—"}
                  </td>
                  <td className="px-5 py-3 text-center">
                    <span
                      className={`rounded-full px-2.5 py-1 text-xs font-medium ${
                        STATUS_BADGE[o.status] || "bg-slate-500/15 text-slate-300"
                      }`}
                    >
                      {o.status}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

export default Orders;
