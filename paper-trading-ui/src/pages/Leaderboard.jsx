import { useEffect, useState } from "react";
import { getLeaderboard } from "../services/marketApi";
import { deltaClass, money, percent } from "../lib/format";

function Leaderboard() {
  const [entries, setEntries] = useState([]);
  const [limit, setLimit] = useState(25);
  const [error, setError] = useState(null);

  useEffect(() => {
    getLeaderboard({ limit })
      .then((data) => {
        setEntries(data);
        setError(null);
      })
      .catch(() => setError("Couldn't load leaderboard"));
  }, [limit]);

  return (
    <main className="mx-auto max-w-7xl px-4 py-6">
      <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Leaderboard</h1>
          <p className="text-sm text-muted">Ranked by total equity against the $100,000 start.</p>
        </div>
        <select
          className="field w-36"
          value={limit}
          onChange={(e) => setLimit(Number(e.target.value))}
        >
          <option value={10}>Top 10</option>
          <option value={25}>Top 25</option>
          <option value={50}>Top 50</option>
          <option value={100}>Top 100</option>
        </select>
      </div>

      {error && <div className="mb-4 rounded-md border border-loss/50 p-3 text-sm text-loss">{error}</div>}

      <div className="card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[720px] border-collapse text-sm">
            <thead>
              <tr className="border-b border-line bg-surface-2 text-left text-xs uppercase text-muted">
                <th className="px-4 py-3 font-semibold">Rank</th>
                <th className="px-4 py-3 font-semibold">Trader</th>
                <th className="px-4 py-3 text-right font-semibold">Equity</th>
                <th className="px-4 py-3 text-right font-semibold">ROI</th>
                <th className="px-4 py-3 text-right font-semibold">Pricing</th>
              </tr>
            </thead>
            <tbody>
              {entries.map((entry) => (
                <tr key={entry.userId} className="border-b border-line/70 last:border-0">
                  <td className="tnum px-4 py-3 font-semibold text-ink">#{entry.rank}</td>
                  <td className="px-4 py-3 text-ink-secondary">{entry.username}</td>
                  <td className="tnum px-4 py-3 text-right font-semibold text-ink">
                    {money(entry.totalEquity)}
                  </td>
                  <td className={`tnum px-4 py-3 text-right font-semibold ${deltaClass(entry.roiPct)}`}>
                    {percent(entry.roiPct)}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <span className={`rounded px-2 py-1 text-xs ${
                      entry.hasUnpricedHoldings
                        ? "border border-warning/60 text-warning"
                        : "border border-line text-muted"
                    }`}>
                      {entry.hasUnpricedHoldings ? "Unpriced" : "Live"}
                    </span>
                  </td>
                </tr>
              ))}
              {entries.length === 0 && (
                <tr>
                  <td className="px-4 py-6 text-center text-muted" colSpan={5}>
                    No ranked traders yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </main>
  );
}

export default Leaderboard;
