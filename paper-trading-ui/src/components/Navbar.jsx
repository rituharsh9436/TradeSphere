import { NavLink } from "react-router-dom";
import { BarChart3, Gauge, LogOut, Trophy, UserCircle } from "lucide-react";
import { useAuth } from "../context/AuthContext";
import { Button } from "../components/ui/Button";

const LINKS = [
  { to: "/", label: "Dashboard", end: true, icon: Gauge },
  { to: "/market", label: "Market", icon: BarChart3 },
  { to: "/leaderboard", label: "Leaderboard", icon: Trophy },
  { to: "/profile", label: "Profile", icon: UserCircle },
];

function Navbar() {
  const { user, token, logout } = useAuth();
  if (!token) return null;

  return (
    <>
      <nav className="sticky top-0 z-20 border-b border-line bg-surface/95 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-7xl items-center gap-4 px-4">
          <span className="flex items-center gap-2 font-bold tracking-tight">
            <span className="grid h-7 w-7 place-items-center rounded-md bg-accent text-sm font-black text-plane">
              TS
            </span>
            Trade<span className="text-accent">Sphere</span>
          </span>

          <div className="hidden items-center gap-1 rounded-md border border-line bg-plane p-1 md:flex">
            {LINKS.map((link) => {
              const Icon = link.icon;
              return (
                <NavLink
                  key={link.to}
                  to={link.to}
                  end={link.end}
                  className={({ isActive }) =>
                    `inline-flex items-center gap-2 rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
                      isActive
                        ? "bg-surface-3 text-ink"
                        : "text-muted hover:text-ink"
                    }`
                  }
                >
                  <Icon className="h-4 w-4" aria-hidden="true" />
                  {link.label}
                </NavLink>
              );
            })}
          </div>

          <div className="ml-auto flex items-center gap-3">
            <span className="hidden rounded-md border border-line bg-plane px-3 py-1.5 text-sm text-muted sm:inline">
              Demo account{" "}
              <strong className="text-ink-secondary">{user?.full_name || user?.username || "..."}</strong>
            </span>
            <Button variant="primary" className="py-1.5 text-sm h-8" onClick={logout}>
              <LogOut className="h-4 w-4" aria-hidden="true" />
              <span className="hidden sm:inline">Log out</span>
            </Button>
          </div>
        </div>
      </nav>

      <nav className="fixed inset-x-0 bottom-0 z-30 border-t border-line bg-surface/95 px-2 pb-2 pt-1 backdrop-blur md:hidden">
        <div className="grid grid-cols-4 gap-1">
          {LINKS.map((link) => {
            const Icon = link.icon;
            return (
              <NavLink
                key={link.to}
                to={link.to}
                end={link.end}
                className={({ isActive }) =>
                  `flex min-h-12 flex-col items-center justify-center gap-1 rounded-md text-xs font-semibold transition-colors ${
                    isActive ? "bg-surface-3 text-ink" : "text-muted hover:text-ink"
                  }`
                }
              >
                <Icon className="h-5 w-5" aria-hidden="true" />
                {link.label}
              </NavLink>
            );
          })}
        </div>
      </nav>
    </>
  );
}

export default Navbar;
