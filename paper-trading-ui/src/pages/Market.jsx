import { useEffect, useState, useCallback } from "react";
import { getAssets, errorMessage } from "../services/api";
import StockCard from "../components/StockCard";
import TradeModal from "../components/TradeModel";

function Market() {
  const [assets, setAssets] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [active, setActive] = useState(null); // asset being traded in the modal

  const load = useCallback(async () => {
    try {
      const data = await getAssets();
      setAssets(data || []);
      setError(null);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    (async () => {
      await load();
    })();
  }, [load]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-white">Market</h1>
        <p className="text-sm text-slate-400">
          Tradable assets and their latest prices.
        </p>
      </div>

      {error && (
        <p className="rounded-lg border border-rose-900/60 bg-rose-950/40 px-4 py-3 text-sm text-rose-300">
          {error}
        </p>
      )}

      {loading ? (
        <div className="rounded-2xl border border-slate-800 bg-slate-900/40 p-10 text-center text-slate-400">
          Loading market…
        </div>
      ) : assets.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-slate-800 bg-slate-900/40 p-10 text-center text-slate-400">
          No assets available.
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {assets.map((a) => (
            <StockCard key={a.symbol} asset={a} onTrade={setActive} />
          ))}
        </div>
      )}

      <TradeModal
        asset={active}
        assets={assets}
        onClose={() => setActive(null)}
        onPlaced={() => {
          setActive(null);
          load();
        }}
      />
    </div>
  );
}

export default Market;
