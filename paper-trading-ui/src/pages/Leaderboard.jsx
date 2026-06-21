// The leaderboard backend endpoint is not built yet (see TODO Step 8). This is
// a styled placeholder so the navigation stays complete without faking data.
function Leaderboard() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-white">Leaderboard</h1>
        <p className="text-sm text-slate-400">
          See how your returns stack up against other traders.
        </p>
      </div>

      <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-slate-800 bg-slate-900/40 p-16 text-center">
        <span className="mb-4 text-5xl">🏆</span>
        <h2 className="text-lg font-semibold text-white">Coming soon</h2>
        <p className="mt-2 max-w-sm text-sm text-slate-400">
          Rankings by ROI and total portfolio value will appear here once the
          leaderboard service goes live.
        </p>
      </div>
    </div>
  );
}

export default Leaderboard;
