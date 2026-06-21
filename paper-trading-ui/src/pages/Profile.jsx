import { useEffect, useState, useCallback } from "react";
import { getWallet, getPortfolio, errorMessage } from "../services/api";
import { useUser } from "../context/UserContext";
import { formatMoney, formatPct, formatDate, pnlColor } from "../utils/format";

function Row({ label, value, mono, valueClass = "text-slate-200" }) {
  return (
    <div className="flex items-center justify-between border-b border-slate-800/60 py-3 last:border-0">
      <span className="text-sm text-slate-400">{label}</span>
      <span className={`text-sm ${mono ? "font-mono" : "font-medium"} ${valueClass}`}>
        {value}
      </span>
    </div>
  );
}

function Profile() {
  const { userId, user, logout } = useUser();
  const [wallet, setWallet] = useState(null);
  const [portfolio, setPortfolio] = useState(null);
  const [error, setError] = useState(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!userId) return;
    Promise.all([getWallet(userId), getPortfolio(userId)])
      .then(([w, p]) => {
        setWallet(w);
        setPortfolio(p);
      })
      .catch((err) => setError(errorMessage(err)));
  }, [userId]);

  const copyId = useCallback(() => {
    navigator.clipboard?.writeText(userId).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  }, [userId]);

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-white">Profile</h1>

      {error && (
        <p className="rounded-lg border border-rose-900/60 bg-rose-950/40 px-4 py-3 text-sm text-rose-300">
          {error}
        </p>
      )}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* Account */}
        <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-6">
          <h2 className="mb-2 text-lg font-semibold text-white">Account</h2>
          <Row label="Username" value={user?.username || "—"} />
          <Row label="Email" value={user?.email || "—"} />
          <Row label="Joined" value={formatDate(user?.created_at)} />
          <div className="flex items-center justify-between border-b border-slate-800/60 py-3 last:border-0">
            <span className="text-sm text-slate-400">User ID</span>
            <button
              onClick={copyId}
              className="max-w-[60%] truncate font-mono text-xs text-indigo-300 hover:text-indigo-200"
              title="Click to copy"
            >
              {copied ? "Copied!" : userId}
            </button>
          </div>
          <p className="mt-3 text-xs text-slate-500">
            Save this ID to resume your session on another browser.
          </p>
        </div>

        {/* Performance */}
        <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-6">
          <h2 className="mb-2 text-lg font-semibold text-white">Performance</h2>
          <Row label="Cash balance" value={formatMoney(wallet?.balance)} />
          <Row label="Total equity" value={formatMoney(portfolio?.totalEquity)} />
          <Row
            label="Starting capital"
            value={formatMoney(portfolio?.startingCapital)}
          />
          <Row
            label="ROI"
            value={formatPct(portfolio?.roiPct)}
            valueClass={pnlColor(portfolio?.roiPct)}
          />
        </div>
      </div>

      <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-6">
        <h2 className="text-lg font-semibold text-white">Session</h2>
        <p className="mt-1 text-sm text-slate-400">
          Signing out only clears this device — your account and holdings are kept.
        </p>
        <button
          onClick={logout}
          className="mt-4 rounded-lg border border-rose-800 bg-rose-950/40 px-4 py-2 text-sm font-medium text-rose-300 transition hover:bg-rose-900/40"
        >
          Sign out
        </button>
      </div>
    </div>
  );
}

export default Profile;
