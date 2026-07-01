import { BrowserRouter, Routes, Route } from "react-router-dom";

import Dashboard from "./pages/Dashboard";
import Market from "./pages/Market";
import Leaderboard from "./pages/Leaderboard";
import Profile from "./pages/Profile";
import Navbar from "./components/Navbar";
import { ActiveUserProvider } from "./context/ActiveUserContext";

function App() {
  return (
    <ActiveUserProvider>
      <BrowserRouter>
        <Navbar />
        <Routes>
          <Route path="/" element={<Dashboard />} />
          <Route path="/market" element={<Market />} />
          <Route path="/leaderboard" element={<Leaderboard />} />
          <Route path="/profile" element={<Profile />} />
        </Routes>
      </BrowserRouter>
    </ActiveUserProvider>
  );
}

export default App;
