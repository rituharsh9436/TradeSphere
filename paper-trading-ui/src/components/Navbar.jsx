import { Link } from "react-router-dom";

function Navbar() {
  return (
    <nav style={{ padding: "10px", display: "flex", gap: "20px" }}>
      <Link to="/">Dashboard</Link>
      <Link to="/market">Market</Link>
      <Link to="/leaderboard">Leaderboard</Link>
      <Link to="/profile">Profile</Link>
    </nav>
  );
}

export default Navbar;