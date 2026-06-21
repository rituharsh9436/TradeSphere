import OrderForm from "./OrderForm";

// Modal dialog hosting the order form for a single asset. Rendered by the
// Market page when a user clicks "Trade" on a stock card.
function TradeModal({ asset, assets = [], onClose, onPlaced }) {
  if (!asset) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md rounded-2xl border border-slate-800 bg-slate-900 p-6 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-5 flex items-start justify-between">
          <div>
            <h2 className="text-xl font-bold text-white">Trade {asset.symbol}</h2>
            <p className="text-sm text-slate-400">{asset.name}</p>
          </div>
          <button
            onClick={onClose}
            className="rounded-lg p-1 text-slate-400 transition hover:bg-slate-800 hover:text-white"
            aria-label="Close"
          >
            ✕
          </button>
        </div>

        <OrderForm
          assets={assets}
          lockedSymbol={asset.symbol}
          onPlaced={(result) => onPlaced?.(result)}
        />
      </div>
    </div>
  );
}

export default TradeModal;
