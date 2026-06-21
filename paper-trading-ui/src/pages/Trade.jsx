import { useEffect, useState, useCallback } from "react";
import { getAssets, getPortfolio, errorMessage } from "../services/api";
import { useUser } from "../context/UserContext";
import OrderForm from "../components/OrderForm";
import HoldingsTable from "../components/HoldingsTable";
import { formatMoney } from "../utils/format";

function Trade() {
  const { userId } = useUser();
  const [assets, setAssets] = useState([]);
  const [portfolio, setPortfolio] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const loadPortfolio = useCallback(() => {
    if (!userId) return;
    getPortfolio(userId)
      .then(setPortfolio)
      .catch((err) => setError(errorMessage(err)));
  }, [userId]);

  useEffect(() => {
    let ignore = false;
    (async () => {
      try {
        const [a, p] = await Promise.all([
          getAssets(),
          userId ? getPortfolio(userId) : null,
        ]);
        if (ignore) return;
        setAssets(a || []);
        if (p) setPortfolio(p);
      } catch (err) {
        if (!ignore) setError(errorMessage(err));
      } finally {
        if (!ignore) setLoading(false);
      }
    })();
    return () => {
      ignore = true;
    };
  }, [userId]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-white">Trade</h1>
        <p className="text-sm text-slate-400">Place a market order at the current price.</p>
      </div>

      {error && (
        <p className="rounded-lg border border-rose-900/60 bg-rose-950/40 px-4 py-3 text-sm text-rose-300">
          {error}
        </p>
      )}

      {loading ? (
        <div className="rounded-2xl border border-slate-800 bg-slate-900/40 p-10 text-center text-slate-400">
          Loading…
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
          {/* Order form */}
          <div className="lg:col-span-2">
            <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-6">
              <OrderForm assets={assets} onPlaced={loadPortfolio} />
            </div>
          </div>

          {/* Side panel: cash + holdings */}
          <div className="space-y-4">
            <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-5">
              <p className="text-xs uppercase tracking-wide text-slate-400">Cash available</p>
              <p className="mt-1 text-2xl font-bold text-white">
                {formatMoney(portfolio?.cashBalance)}
              </p>
            </div>
            <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-5">
              <p className="mb-2 text-sm font-semibold text-white">Open positions</p>
              <HoldingsTable positions={portfolio?.positions || []} />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default Trade;
