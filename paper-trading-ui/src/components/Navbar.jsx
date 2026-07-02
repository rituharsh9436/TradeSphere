import { Link } from "react-router-dom";
import UserPicker from "./UserPicker";

function Navbar() {
  return (
    <nav style={{ padding: "10px", display: "flex", gap: "20px", alignItems: "center" }}>
      <Link to="/">Dashboard</Link>
      <Link to="/market">Market</Link>
      <Link to="/leaderboard">Leaderboard</Link>
      <Link to="/profile">Profile</Link>
      <UserPicker />
    </nav>
  );
}

export default Navbar;
