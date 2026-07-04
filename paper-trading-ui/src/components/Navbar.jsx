import { NavLink } from "react-router-dom";
import { useAuth } from "../context/AuthContext";

const LINKS = [
  { to: "/", label: "Dashboard", end: true },
  { to: "/market", label: "Market" },
  { to: "/leaderboard", label: "Leaderboard" },
  { to: "/profile", label: "Profile" },
];

function Navbar() {
  const { user, token, logout } = useAuth();
  if (!token) return null;

  return (
    <nav className="sticky top-0 z-20 border-b border-line bg-surface/95 backdrop-blur">
      <div className="mx-auto flex h-14 max-w-7xl items-center gap-4 px-4">
        <span className="flex items-center gap-2 font-bold tracking-tight">
          <span className="grid h-7 w-7 place-items-center rounded-md bg-accent text-sm font-black text-plane">
            ML
          </span>
          Money<span className="text-accent">logix</span>
        </span>

        <div className="hidden items-center gap-1 rounded-md border border-line bg-plane p-1 md:flex">
          {LINKS.map((link) => (
            <NavLink
              key={link.to}
              to={link.to}
              end={link.end}
              className={({ isActive }) =>
                `rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
                  isActive
                    ? "bg-surface-3 text-ink"
                    : "text-muted hover:text-ink"
                }`
              }
            >
              {link.label}
            </NavLink>
          ))}
        </div>

        <div className="ml-auto flex items-center gap-3">
          <span className="hidden rounded-md border border-line bg-plane px-3 py-1.5 text-sm text-muted sm:inline">
            Demo account{" "}
            <strong className="text-ink-secondary">{user?.username || "..."}</strong>
          </span>
          <button type="button" className="btn btn-primary py-1.5 text-sm" onClick={logout}>
            Log out
          </button>
        </div>
      </div>
    </nav>
  );
}

export default Navbar;
