import { useState } from "react";
import { useNavigate, Link } from "react-router-dom";
import { LogIn } from "lucide-react";
import AuthShell from "../components/AuthShell";
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
    <AuthShell
      eyebrow="Paper-trading terminal"
      title="Log in"
      footer={
        <p className="mt-4 text-center text-sm text-muted">
          No account?{" "}
          <Link to="/register" className="font-medium text-accent hover:underline">
            Register
          </Link>
        </p>
      }
    >
      <form onSubmit={onSubmit} className="flex flex-col gap-3">
        <label className="text-sm">
          <span className="mb-1 block text-muted">Email</span>
          <input
            className="field"
            type="email"
            value={form.email}
            required
            onChange={(e) => setForm({ ...form, email: e.target.value })}
          />
        </label>
        <label className="text-sm">
          <span className="mb-1 block text-muted">Password</span>
          <input
            className="field"
            type="password"
            value={form.password}
            required
            onChange={(e) => setForm({ ...form, password: e.target.value })}
          />
        </label>
        <button type="submit" className="btn btn-primary mt-1" disabled={busy}>
          <LogIn className="h-4 w-4" aria-hidden="true" />
          {busy ? "Logging in..." : "Log in"}
        </button>
      </form>
      {error && <p className="mt-3 text-sm text-loss">{error}</p>}
    </AuthShell>
  );
}

export default Login;
