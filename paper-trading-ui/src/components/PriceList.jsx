// Live latest-price rows. `prices` is the map from useMarketData; each row shows
// the current price and is clickable to select that symbol for the chart.
function PriceList({ prices, selected, onSelect }) {
  const symbols = Object.keys(prices).sort();

  if (symbols.length === 0) {
    return <div>Waiting for prices…</div>;
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
      {symbols.map((symbol) => (
        <button
          key={symbol}
          type="button"
          onClick={() => onSelect(symbol)}
          style={{
            display: "flex",
            justifyContent: "space-between",
            gap: "16px",
            fontWeight: symbol === selected ? "bold" : "normal",
          }}
        >
          <span>{symbol}</span>
          <span>${Number(prices[symbol].price).toFixed(2)}</span>
        </button>
      ))}
    </div>
  );
}

export default PriceList;
