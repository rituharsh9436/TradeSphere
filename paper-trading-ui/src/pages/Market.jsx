import { useEffect, useState } from "react";
import api from "../services/api";

function Market() {
  const [stocks, setStocks] = useState([]);

  useEffect(() => {
    api.get("/stocks")
      .then((res) => {
        setStocks(res.data);
      });
  }, []);

  return (
    <div>
      <h1>Market</h1>

      {stocks.map((stock) => (
        <div key={stock.symbol}>
          {stock.symbol} - ₹{stock.price}
        </div>
      ))}
    </div>
  );
}

export default Market;