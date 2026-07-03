import { Link } from "react-router-dom";
import { useAuth } from "../context/AuthContext";

function Navbar() {
  const { user, token, logout } = useAuth();
  if (!token) return null; // hidden on login/register

  return (
    <nav style={{ padding: "10px", display: "flex", gap: "20px", alignItems: "center" }}>
      <Link to="/">Dashboard</Link>
      <Link to="/market">Market</Link>
      <Link to="/leaderboard">Leaderboard</Link>
      <Link to="/profile">Profile</Link>
      <span style={{ marginLeft: "auto" }}>
        Signed in as <strong>{user?.username || "…"}</strong>
      </span>
      <button type="button" onClick={logout}>Log out</button>
    </nav>
  );
}

export default Navbar;
