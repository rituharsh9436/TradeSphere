import { useState } from "react";
import { useNavigate, Link } from "react-router-dom";
import { useAuth } from "../context/AuthContext";

function Login() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const [form, setForm] = useState({ email: "", password: "" });
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await login(form);
      navigate("/");
    } catch (err) {
      setError(err.response?.data?.message || "Login failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid min-h-screen place-items-center px-4">
      <div className="w-full max-w-sm">
        <div className="mb-6 text-center">
          <span className="inline-flex items-center gap-2 text-xl font-bold tracking-tight">
            <span className="grid h-7 w-7 place-items-center rounded-md bg-accent text-white">
              M
            </span>
            Money<span className="text-accent">logix</span>
          </span>
          <p className="mt-2 text-sm text-muted">Paper-trading terminal</p>
        </div>

        <div className="card p-6">
          <h1 className="mb-4 text-lg font-semibold">Log in</h1>
          <form onSubmit={onSubmit} className="flex flex-col gap-3">
            <input
              className="field"
              placeholder="Email"
              type="email"
              value={form.email}
              required
              onChange={(e) => setForm({ ...form, email: e.target.value })}
            />
            <input
              className="field"
              placeholder="Password"
              type="password"
              value={form.password}
              required
              onChange={(e) => setForm({ ...form, password: e.target.value })}
            />
            <button type="submit" className="btn btn-primary mt-1" disabled={busy}>
              {busy ? "Logging in…" : "Log in"}
            </button>
          </form>
          {error && <p className="mt-3 text-sm text-loss">{error}</p>}
        </div>

        <p className="mt-4 text-center text-sm text-muted">
          No account?{" "}
          <Link to="/register" className="font-medium text-accent hover:underline">
            Register
          </Link>
        </p>
      </div>
    </div>
  );
}

export default Login;
