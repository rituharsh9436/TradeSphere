const pool = require('../config/database');

// Raw tick storage + on-read candlestick aggregation. market_prices holds only
// the latest price; this table keeps every tick so we can build OHLC candles for
// any interval after the fact.
const priceHistoryRepository = {
  async append(assetId, price, ts, client = pool) {
    await client.query(
      `INSERT INTO price_history (asset_id, price, ts) VALUES ($1, $2, $3)`,
      [assetId, price, ts]
    );
  },

  // Aggregate ticks into OHLC buckets of `intervalSec` seconds over [from, to).
  // open/close are the first/last tick by ts within the bucket; high/low the
  // max/min. Buckets are returned ascending; empty buckets are omitted.
  async aggregateCandles({ symbol, intervalSec, from, to }, client = pool) {
    const { rows } = await client.query(
      `SELECT to_timestamp(floor(extract(epoch from ph.ts) / $2) * $2) AS bucket,
              (array_agg(ph.price ORDER BY ph.ts ASC))[1]  AS open,
              max(ph.price)                                 AS high,
              min(ph.price)                                 AS low,
              (array_agg(ph.price ORDER BY ph.ts DESC))[1]  AS close
       FROM price_history ph
       JOIN assets a ON a.id = ph.asset_id
       WHERE a.symbol = $1 AND ph.ts >= $3 AND ph.ts < $4
       GROUP BY bucket
       ORDER BY bucket ASC`,
      [symbol, intervalSec, from, to]
    );
    return rows.map((r) => ({
      time: r.bucket.toISOString(),
      open: r.open,
      high: r.high,
      low: r.low,
      close: r.close,
    }));
  },
};

module.exports = priceHistoryRepository;
