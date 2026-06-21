import { BrowserRouter, Routes, Route } from "react-router-dom";

import { UserProvider, useUser } from "./context/UserContext";
import Navbar from "./components/Navbar";
import Onboarding from "./components/Onboarding";

import Dashboard from "./pages/Dashboard";
import Market from "./pages/Market";
import Trade from "./pages/Trade";
import Orders from "./pages/Orders";
import Leaderboard from "./pages/Leaderboard";
import Profile from "./pages/Profile";

// Decides what to render based on auth state: a loading splash while we
// rehydrate, the onboarding screen when there is no active user, otherwise the
// full app shell with routed pages.
function AppShell() {
  const { userId, loading } = useUser();

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#0b1120] text-slate-400">
        Loading…
      </div>
    );
  }

  if (!userId) {
    return <Onboarding />;
  }

  return (
    <div className="min-h-screen bg-[#0b1120]">
      <Navbar />
      <main className="mx-auto max-w-6xl px-4 py-8">
        <Routes>
          <Route path="/" element={<Dashboard />} />
          <Route path="/market" element={<Market />} />
          <Route path="/trade" element={<Trade />} />
          <Route path="/orders" element={<Orders />} />
          <Route path="/leaderboard" element={<Leaderboard />} />
          <Route path="/profile" element={<Profile />} />
        </Routes>
      </main>
    </div>
  );
}

function App() {
  return (
    <BrowserRouter>
      <UserProvider>
        <AppShell />
      </UserProvider>
    </BrowserRouter>
  );
}

export default App;
