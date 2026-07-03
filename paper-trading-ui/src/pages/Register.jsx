import { useState } from "react";
import { useNavigate, Link } from "react-router-dom";
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
    <div style={{ maxWidth: 320, margin: "60px auto", display: "flex", flexDirection: "column", gap: 8 }}>
      <h1>Register</h1>
      <form onSubmit={onSubmit} style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        <input placeholder="username" value={form.username} required
          onChange={(e) => setForm({ ...form, username: e.target.value })} />
        <input placeholder="email" type="email" value={form.email} required
          onChange={(e) => setForm({ ...form, email: e.target.value })} />
        <input placeholder="password (min 8 chars)" type="password" value={form.password} required minLength={8}
          onChange={(e) => setForm({ ...form, password: e.target.value })} />
        <button type="submit" disabled={busy}>Create account</button>
      </form>
      {error && <span style={{ color: "crimson" }}>{error}</span>}
      <span>Have an account? <Link to="/login">Log in</Link></span>
    </div>
  );
}

export default Register;
