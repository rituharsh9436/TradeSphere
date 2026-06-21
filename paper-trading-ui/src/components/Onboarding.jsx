import { useState } from "react";
import { createUser, errorMessage } from "../services/api";
import { useUser } from "../context/UserContext";

// Shown whenever there is no active user. The backend has no auth, so a "user"
// is created with just a username + email; we also allow pasting an existing
// user id to resume a previous session on another device/browser.
function Onboarding() {
  const { login } = useUser();
  const [mode, setMode] = useState("create"); // "create" | "existing"

  const [username, setUsername] = useState("");
  const [email, setEmail] = useState("");
  const [existingId, setExistingId] = useState("");

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);

  const handleCreate = async (e) => {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const user = await createUser({ username: username.trim(), email: email.trim() });
      login(user.id);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setSubmitting(false);
    }
  };

  const handleExisting = (e) => {
    e.preventDefault();
    const id = existingId.trim();
    if (!id) {
      setError("Please enter a user id.");
      return;
    }
    login(id);
  };

  const inputCls =
    "w-full rounded-lg border border-slate-700 bg-slate-900/70 px-3 py-2 text-sm text-slate-100 placeholder-slate-500 outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500";
  const tabCls = (active) =>
    `flex-1 rounded-lg px-3 py-2 text-sm font-medium transition ${
      active ? "bg-indigo-600 text-white" : "text-slate-400 hover:text-slate-200"
    }`;

  return (
    <div className="flex min-h-screen items-center justify-center bg-[#0b1120] px-4">
      <div className="w-full max-w-md">
        <div className="mb-8 text-center">
          <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-xl bg-indigo-600 text-2xl">
            📈
          </div>
          <h1 className="text-2xl font-bold text-white">MoneyLogix</h1>
          <p className="mt-1 text-sm text-slate-400">
            Paper Trading & Virtual Portfolio Engine
          </p>
        </div>

        <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-6 shadow-xl backdrop-blur">
          <div className="mb-5 flex gap-2 rounded-lg bg-slate-950/50 p-1">
            <button className={tabCls(mode === "create")} onClick={() => setMode("create")}>
              New account
            </button>
            <button className={tabCls(mode === "existing")} onClick={() => setMode("existing")}>
              Resume
            </button>
          </div>

          {mode === "create" ? (
            <form onSubmit={handleCreate} className="space-y-4">
              <div>
                <label className="mb-1 block text-xs font-medium text-slate-400">Username</label>
                <input
                  className={inputCls}
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  placeholder="jane_trader"
                  required
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-slate-400">Email</label>
                <input
                  type="email"
                  className={inputCls}
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="jane@example.com"
                  required
                />
              </div>
              <button
                type="submit"
                disabled={submitting}
                className="w-full rounded-lg bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-indigo-500 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {submitting ? "Creating account…" : "Start trading with ₹1,00,000"}
              </button>
            </form>
          ) : (
            <form onSubmit={handleExisting} className="space-y-4">
              <div>
                <label className="mb-1 block text-xs font-medium text-slate-400">User ID</label>
                <input
                  className={inputCls}
                  value={existingId}
                  onChange={(e) => setExistingId(e.target.value)}
                  placeholder="paste your user UUID"
                />
                <p className="mt-1 text-xs text-slate-500">
                  Find this on your Profile page from a previous session.
                </p>
              </div>
              <button
                type="submit"
                className="w-full rounded-lg bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-indigo-500"
              >
                Resume session
              </button>
            </form>
          )}

          {error && (
            <p className="mt-4 rounded-lg border border-rose-900/60 bg-rose-950/40 px-3 py-2 text-sm text-rose-300">
              {error}
            </p>
          )}
        </div>

        <p className="mt-6 text-center text-xs text-slate-600">
          Virtual money only. No real funds are ever at risk.
        </p>
      </div>
    </div>
  );
}

export default Onboarding;
