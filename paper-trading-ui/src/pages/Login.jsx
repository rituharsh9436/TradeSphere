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
    <div style={{ maxWidth: 320, margin: "60px auto", display: "flex", flexDirection: "column", gap: 8 }}>
      <h1>Log in</h1>
      <form onSubmit={onSubmit} style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        <input placeholder="email" type="email" value={form.email} required
          onChange={(e) => setForm({ ...form, email: e.target.value })} />
        <input placeholder="password" type="password" value={form.password} required
          onChange={(e) => setForm({ ...form, password: e.target.value })} />
        <button type="submit" disabled={busy}>Log in</button>
      </form>
      {error && <span style={{ color: "crimson" }}>{error}</span>}
      <span>No account? <Link to="/register">Register</Link></span>
    </div>
  );
}

export default Login;
