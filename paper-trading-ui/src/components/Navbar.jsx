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
  if (!token) return null; // hidden on login/register

  return (
    <nav className="sticky top-0 z-20 border-b border-line bg-surface/95 backdrop-blur">
      <div className="mx-auto flex h-14 max-w-7xl items-center gap-6 px-4">
        <span className="flex items-center gap-2 font-bold tracking-tight">
          <span className="grid h-6 w-6 place-items-center rounded-md bg-accent text-sm text-white">
            M
          </span>
          Money<span className="text-accent">logix</span>
        </span>

        <div className="flex items-center gap-1">
          {LINKS.map((l) => (
            <NavLink
              key={l.to}
              to={l.to}
              end={l.end}
              className={({ isActive }) =>
                `rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
                  isActive
                    ? "bg-surface-2 text-ink"
                    : "text-muted hover:text-ink"
                }`
              }
            >
              {l.label}
            </NavLink>
          ))}
        </div>

        <div className="ml-auto flex items-center gap-3">
          <span className="hidden text-sm text-muted sm:inline">
            Signed in as{" "}
            <strong className="text-ink-secondary">{user?.username || "…"}</strong>
          </span>
          <button type="button" className="btn btn-ghost text-sm" onClick={logout}>
            Log out
          </button>
        </div>
      </div>
    </nav>
  );
}

export default Navbar;
