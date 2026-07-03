import { useEffect, useState } from "react";
import api from "../services/api";

function Dashboard() {
  const [portfolio, setPortfolio] = useState(null);

  useEffect(() => {
    api.get("/portfolio")
      .then((res) => {
        setPortfolio(res.data);
      });
  }, []);

  return (
    <div>
      <h1>Dashboard</h1>

      <p>Balance: ₹{portfolio?.balance}</p>
      <p>Portfolio Value: ₹{portfolio?.portfolioValue}</p>
    </div>
  );
}

export default Dashboard;