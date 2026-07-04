import { useEffect, useState } from "react";
import { Medal } from "lucide-react";
import Skeleton from "../components/Skeleton";
import StatusBadge from "../components/StatusBadge";
import { getLeaderboard } from "../services/marketApi";
import { deltaClass, money, percent } from "../lib/format";

function Leaderboard() {
  const [entries, setEntries] = useState([]);
  const [limit, setLimit] = useState(25);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    getLeaderboard({ limit })
      .then((data) => {
        setEntries(data);
        setError(null);
      })
      .catch(() => setError("Couldn't load leaderboard"))
      .finally(() => setLoading(false));
  }, [limit]);

  return (
    <main className="mx-auto max-w-7xl px-4 pb-24 pt-6 md:pb-6">
      <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <div className="flex items-center gap-2">
            <Medal className="h-6 w-6 text-accent" aria-hidden="true" />
            <h1 className="text-2xl font-semibold">Leaderboard</h1>
          </div>
          <p className="text-sm text-muted">Ranked by total equity against the $100,000 start.</p>
        </div>
        <select
          className="field w-36"
          value={limit}
          onChange={(e) => {
            setLoading(true);
            setLimit(Number(e.target.value));
          }}
        >
          <option value={10}>Top 10</option>
          <option value={25}>Top 25</option>
          <option value={50}>Top 50</option>
          <option value={100}>Top 100</option>
        </select>
      </div>

      {error && <div className="mb-4 rounded-md border border-loss/50 p-3 text-sm text-loss">{error}</div>}

      {loading && (
        <div className="card p-4">
          <Skeleton className="mb-4 h-5 w-40" />
          <div className="space-y-3">
            {Array.from({ length: 8 }).map((_, index) => (
              <Skeleton key={index} className="h-9 w-full" />
            ))}
          </div>
        </div>
      )}

      {!loading && (
      <div className="card overflow-hidden">
        <div className="grid gap-3 p-3 md:hidden">
          {entries.map((entry) => (
            <article key={entry.userId} className="rounded-md border border-line bg-plane p-3">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <div className="tnum text-lg font-semibold text-ink">#{entry.rank}</div>
                  <div className="text-sm text-ink-secondary">{entry.username}</div>
                </div>
                <StatusBadge tone={entry.hasUnpricedHoldings ? "UNPRICED" : "LIVE"}>
                  {entry.hasUnpricedHoldings ? "Unpriced" : "Live"}
                </StatusBadge>
              </div>
              <div className="mt-3 grid grid-cols-2 gap-3 text-sm">
                <div>
                  <div className="text-xs uppercase text-muted">Equity</div>
                  <div className="tnum mt-1 font-semibold text-ink">{money(entry.totalEquity)}</div>
                </div>
                <div>
                  <div className="text-xs uppercase text-muted">ROI</div>
                  <div className={`tnum mt-1 font-semibold ${deltaClass(entry.roiPct)}`}>{percent(entry.roiPct)}</div>
                </div>
              </div>
            </article>
          ))}
        </div>
        <div className="hidden overflow-x-auto md:block">
          <table className="w-full min-w-[720px] border-collapse text-sm">
            <thead className="sticky top-0 bg-surface-2">
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
                <tr key={entry.userId} className="table-row border-b border-line/70 last:border-0">
                  <td className="tnum px-4 py-3 font-semibold text-ink">#{entry.rank}</td>
                  <td className="px-4 py-3 text-ink-secondary">{entry.username}</td>
                  <td className="tnum px-4 py-3 text-right font-semibold text-ink">
                    {money(entry.totalEquity)}
                  </td>
                  <td className={`tnum px-4 py-3 text-right font-semibold ${deltaClass(entry.roiPct)}`}>
                    {percent(entry.roiPct)}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <StatusBadge tone={entry.hasUnpricedHoldings ? "UNPRICED" : "LIVE"}>
                      {entry.hasUnpricedHoldings ? "Unpriced" : "Live"}
                    </StatusBadge>
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
      )}
    </main>
  );
}

export default Leaderboard;
