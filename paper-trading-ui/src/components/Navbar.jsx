import { NavLink } from "react-router-dom";
import { useUser } from "../context/UserContext";

const links = [
  { to: "/", label: "Dashboard", end: true },
  { to: "/market", label: "Market" },
  { to: "/trade", label: "Trade" },
  { to: "/orders", label: "Orders" },
  { to: "/leaderboard", label: "Leaderboard" },
  { to: "/profile", label: "Profile" },
];

function Navbar() {
  const { user, logout } = useUser();

  const linkCls = ({ isActive }) =>
    `rounded-lg px-3 py-2 text-sm font-medium transition ${
      isActive
        ? "bg-slate-800 text-white"
        : "text-slate-400 hover:bg-slate-800/60 hover:text-slate-200"
    }`;

  return (
    <header className="sticky top-0 z-30 border-b border-slate-800 bg-[#0b1120]/90 backdrop-blur">
      <nav className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-3">
        <div className="flex items-center gap-2">
          <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-indigo-600 text-lg">
            📈
          </span>
          <span className="text-lg font-bold text-white">MoneyLogix</span>
        </div>

        <div className="hidden items-center gap-1 md:flex">
          {links.map((l) => (
            <NavLink key={l.to} to={l.to} end={l.end} className={linkCls}>
              {l.label}
            </NavLink>
          ))}
        </div>

        <div className="flex items-center gap-3">
          {user && (
            <span className="hidden text-sm text-slate-300 sm:inline">
              👤 {user.username}
            </span>
          )}
          <button
            onClick={logout}
            className="rounded-lg border border-slate-700 px-3 py-1.5 text-sm text-slate-300 transition hover:border-rose-700 hover:text-rose-300"
          >
            Sign out
          </button>
        </div>
      </nav>

      {/* Mobile nav */}
      <div className="flex gap-1 overflow-x-auto px-4 pb-2 md:hidden">
        {links.map((l) => (
          <NavLink key={l.to} to={l.to} end={l.end} className={linkCls}>
            {l.label}
          </NavLink>
        ))}
      </div>
    </header>
  );
}

export default Navbar;
