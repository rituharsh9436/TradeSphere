import { useState } from "react";
import { useNavigate, Link } from "react-router-dom";
import { LogIn, AlertTriangle } from "lucide-react";
import AuthShell from "../components/AuthShell";
import { Button } from "../components/ui/Button";
import { Input } from "../components/ui/Input";
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
      eyebrow="TradeSphere Terminal"
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
      <form onSubmit={onSubmit} className="flex flex-col gap-4">
        <label className="text-sm">
          <span className="mb-1.5 block font-medium text-ink-secondary">Email</span>
          <Input
            type="email"
            value={form.email}
            required
            onChange={(e) => setForm({ ...form, email: e.target.value })}
            disabled={busy}
          />
        </label>
        <label className="text-sm">
          <span className="mb-1.5 block font-medium text-ink-secondary">Password</span>
          <Input
            type="password"
            value={form.password}
            required
            onChange={(e) => setForm({ ...form, password: e.target.value })}
            disabled={busy}
          />
        </label>
        <Button type="submit" className="mt-2 group" disabled={busy}>
          <LogIn className="h-4 w-4 transition-transform group-hover:-translate-x-1" aria-hidden="true" />
          {busy ? "Logging in..." : "Log in"}
        </Button>
      </form>
      {error && (
        <div role="alert" className="mt-4 flex items-center gap-2 rounded-md border border-loss/50 bg-loss/10 p-3 text-sm text-loss">
          <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden="true" />
          {error}
        </div>
      )}
    </AuthShell>
  );
}

export default Login;
