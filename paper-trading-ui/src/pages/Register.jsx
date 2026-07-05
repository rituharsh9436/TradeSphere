import { useState } from "react";
import { useNavigate, Link } from "react-router-dom";
import { UserPlus } from "lucide-react";
import AuthShell from "../components/AuthShell";
import { useAuth } from "../context/AuthContext";

function Register() {
  const { register } = useAuth();
  const navigate = useNavigate();
  const [form, setForm] = useState({ username: "", email: "", password: "" });
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await register(form);
      navigate("/");
    } catch (err) {
      setError(err.response?.data?.message || "Registration failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthShell
      eyebrow="Start with virtual $100,000"
      title="Create account"
      footer={
        <p className="mt-4 text-center text-sm text-muted">
          Have an account?{" "}
          <Link to="/login" className="font-medium text-accent hover:underline">
            Log in
          </Link>
        </p>
      }
    >
      <form onSubmit={onSubmit} className="flex flex-col gap-3">
        <label className="text-sm">
          <span className="mb-1 block text-muted">Username</span>
          <input
            className="field"
            value={form.username}
            required
            onChange={(e) => setForm({ ...form, username: e.target.value })}
          />
        </label>
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
            minLength={8}
            onChange={(e) => setForm({ ...form, password: e.target.value })}
          />
        </label>
        <button type="submit" className="btn btn-primary mt-1" disabled={busy}>
          <UserPlus className="h-4 w-4" aria-hidden="true" />
          {busy ? "Creating..." : "Create account"}
        </button>
      </form>
      {error && <p className="mt-3 text-sm text-loss">{error}</p>}
    </AuthShell>
  );
}

export default Register;
