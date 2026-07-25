import { useState } from "react";
import { useNavigate, Link } from "react-router-dom";
import { UserPlus, AlertTriangle, MailCheck } from "lucide-react";
import AuthShell from "../components/AuthShell";
import { useAuth } from "../context/AuthContext";

function Register() {
  const { startRegistration, register } = useAuth();
  const navigate = useNavigate();
  const [form, setForm] = useState({ fullName: "", username: "", email: "", password: "" });
  const [code, setCode] = useState("");
  const [codeSent, setCodeSent] = useState(false);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      if (!codeSent) {
        await startRegistration(form);
        setCodeSent(true);
      } else {
        await register({ email: form.email, code });
        navigate("/");
      }
    } catch (err) {
      setError(err.response?.data?.message || "Unable to complete registration");
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthShell
      eyebrow="Virtual Portfolio"
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
      <form onSubmit={onSubmit} className="flex flex-col gap-4">
        <label className="text-sm">
          <span className="mb-1.5 block font-medium text-ink-secondary">Full name</span>
          <input
            className="field"
            type="text"
            value={form.fullName}
            required
            onChange={(e) => setForm({ ...form, fullName: e.target.value })}
            disabled={busy || codeSent}
          />
        </label>
        <label className="text-sm">
          <span className="mb-1.5 block font-medium text-ink-secondary">Username</span>
          <span className="mb-1 block text-xs text-muted">Your unique public handle, shown on the leaderboard.</span>
          <input
            className="field"
            type="text"
            value={form.username}
            required
            onChange={(e) => setForm({ ...form, username: e.target.value })}
            disabled={busy || codeSent}
          />
        </label>
        <label className="text-sm">
          <span className="mb-1.5 block font-medium text-ink-secondary">Email</span>
          <input
            className="field"
            type="email"
            value={form.email}
            required
            onChange={(e) => setForm({ ...form, email: e.target.value })}
            disabled={busy || codeSent}
          />
        </label>
        <label className="text-sm">
          <span className="mb-1.5 block font-medium text-ink-secondary">Password</span>
          <input
            className="field"
            type="password"
            value={form.password}
            required
            minLength={8}
            onChange={(e) => setForm({ ...form, password: e.target.value })}
            disabled={busy || codeSent}
          />
        </label>
        {codeSent && (
          <label className="text-sm">
            <span className="mb-1.5 block font-medium text-ink-secondary">Verification code</span>
            <input
              className="field"
              type="text"
              inputMode="numeric"
              autoComplete="one-time-code"
              value={code}
              required
              minLength={6}
              maxLength={6}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
              disabled={busy}
            />
            <span className="mt-1 block text-xs text-muted">We sent a 6-digit code to {form.email}. It expires in 10 minutes.</span>
          </label>
        )}
        <button type="submit" className="btn btn-primary mt-2 group" disabled={busy}>
          {codeSent ? <MailCheck className="h-4 w-4" aria-hidden="true" /> : <UserPlus className="h-4 w-4 transition-transform group-hover:scale-110" aria-hidden="true" />}
          {busy ? "Please wait..." : codeSent ? "Verify and create account" : "Send verification code"}
        </button>
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

export default Register;
