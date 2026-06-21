import { useEffect, useState, useCallback } from "react";
import { Link } from "react-router-dom";
import { getPortfolio, errorMessage } from "../services/api";
import { useUser } from "../context/UserContext";
import WalletCard from "../components/WalletCard";
import PortfolioTable from "../components/PortfolioTable";

function Dashboard() {
  const { userId, user } = useUser();
  const [portfolio, setPortfolio] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const load = useCallback(async () => {
    if (!userId) return;
    try {
      const data = await getPortfolio(userId);
      setPortfolio(data);
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
          <h1 className="text-2xl font-bold text-white">
            Welcome back{user ? `, ${user.username}` : ""} 👋
          </h1>
          <p className="text-sm text-slate-400">Here's how your portfolio is doing.</p>
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

      {loading && !portfolio ? (
        <div className="rounded-2xl border border-slate-800 bg-slate-900/40 p-10 text-center text-slate-400">
          Loading portfolio…
        </div>
      ) : (
        <>
          <WalletCard portfolio={portfolio} />

          {portfolio?.unpricedSymbols?.length > 0 && (
            <p className="rounded-lg border border-amber-900/60 bg-amber-950/30 px-4 py-2 text-sm text-amber-300">
              No live price for: {portfolio.unpricedSymbols.join(", ")} — excluded from totals.
            </p>
          )}

          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold text-white">Your Holdings</h2>
            <Link
              to="/market"
              className="rounded-lg bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white transition hover:bg-indigo-500"
            >
              + New Trade
            </Link>
          </div>
          <PortfolioTable positions={portfolio?.positions || []} />
        </>
      )}
    </div>
  );
}

export default Dashboard;
