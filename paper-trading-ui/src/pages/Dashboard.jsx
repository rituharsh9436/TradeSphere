import { useEffect, useState } from "react";
import api from "../services/api";

function Dashboard() {
  const [portfolio, setPortfolio] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    api.get("/me/portfolio")
      .then((res) => setPortfolio(res.data.data))
      .catch(() => setError("Couldn't load portfolio"));
  }, []);

  return (
    <div>
      <h1>Dashboard</h1>
      {error && <p style={{ color: "crimson" }}>{error}</p>}
      <p>Cash: ${portfolio?.cashBalance}</p>
      <p>Equity: ${portfolio?.totalEquity}</p>
      <p>ROI: {portfolio?.roiPct}%</p>
    </div>
  );
}

export default Dashboard;
