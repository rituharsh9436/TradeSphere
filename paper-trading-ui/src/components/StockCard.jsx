import { formatMoney } from "../utils/format";

const CLASS_BADGE = {
  EQUITY: "bg-sky-500/15 text-sky-300",
  CRYPTO: "bg-amber-500/15 text-amber-300",
  ETF: "bg-violet-500/15 text-violet-300",
  FOREX: "bg-emerald-500/15 text-emerald-300",
};

// A market tile for one tradable asset, with a Trade button.
function StockCard({ asset, onTrade }) {
  const unpriced = asset.currentPrice === null || asset.currentPrice === undefined;
  const badge = CLASS_BADGE[asset.assetClass] || "bg-slate-500/15 text-slate-300";

  return (
    <div className="flex flex-col justify-between rounded-2xl border border-slate-800 bg-slate-900/60 p-5 transition hover:border-slate-700">
      <div>
        <div className="flex items-start justify-between">
          <div>
            <h3 className="text-lg font-bold text-white">{asset.symbol}</h3>
            <p className="mt-0.5 text-sm text-slate-400">{asset.name}</p>
          </div>
          <span className={`rounded-full px-2.5 py-1 text-xs font-medium ${badge}`}>
            {asset.assetClass}
          </span>
        </div>

        <div className="mt-4">
          <p className="text-xs uppercase tracking-wide text-slate-500">Price</p>
          <p className="text-2xl font-bold text-white">
            {unpriced ? (
              <span className="text-amber-400 text-base">No price</span>
            ) : (
              formatMoney(asset.currentPrice)
            )}
          </p>
        </div>
      </div>

      <button
        onClick={() => onTrade?.(asset)}
        disabled={unpriced}
        className="mt-5 w-full rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-indigo-500 disabled:cursor-not-allowed disabled:opacity-50"
      >
        Trade
      </button>
    </div>
  );
}

export default StockCard;
