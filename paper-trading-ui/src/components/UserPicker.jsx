import { useEffect, useState } from "react";
import { getUsers, registerUser } from "../services/marketApi";
import { useActiveUser } from "../context/ActiveUserContext";

// Navbar control for the dev active user: select an existing user or register a
// new one. Writes the choice into ActiveUserContext (localStorage-backed).
function UserPicker() {
  const { activeUser, setActiveUser } = useActiveUser();
  const [users, setUsers] = useState([]);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState({ username: "", email: "" });
  const [error, setError] = useState(null);

  useEffect(() => {
    getUsers().then(setUsers).catch(() => setError("Couldn't load users"));
  }, []);

  function onSelect(e) {
    const id = e.target.value;
    const u = users.find((x) => x.id === id);
    setActiveUser(u ? { id: u.id, username: u.username } : null);
  }

  async function onCreate(e) {
    e.preventDefault();
    setError(null);
    try {
      const u = await registerUser(form);
      setUsers((prev) => [...prev, u]);
      setActiveUser({ id: u.id, username: u.username });
      setCreating(false);
      setForm({ username: "", email: "" });
    } catch (err) {
      setError(err.response?.data?.message || "Registration failed");
    }
  }

  return (
    <div style={{ marginLeft: "auto", display: "flex", gap: "8px", alignItems: "center" }}>
      <select value={activeUser?.id || ""} onChange={onSelect}>
        <option value="">— select user —</option>
        {users.map((u) => (
          <option key={u.id} value={u.id}>{u.username}</option>
        ))}
      </select>
      <button type="button" onClick={() => setCreating((v) => !v)}>+ new</button>
      {creating && (
        <form onSubmit={onCreate} style={{ display: "flex", gap: "4px" }}>
          <input
            placeholder="username" value={form.username}
            onChange={(e) => setForm({ ...form, username: e.target.value })} required
          />
          <input
            placeholder="email" type="email" value={form.email}
            onChange={(e) => setForm({ ...form, email: e.target.value })} required
          />
          <button type="submit">create</button>
        </form>
      )}
      {error && <span style={{ color: "crimson" }}>{error}</span>}
    </div>
  );
}

export default UserPicker;
