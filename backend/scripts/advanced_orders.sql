-- Advanced Orders schema (1-to-1 with `orders`).
-- Maintained in backend/src/scripts/init-db.js so fresh dev DBs come up ready.
-- Kept here for documentation and for ops who prefer running raw SQL.
CREATE TABLE IF NOT EXISTS advanced_orders (
  order_id UUID PRIMARY KEY REFERENCES orders(id) ON DELETE CASCADE,
  advanced_type VARCHAR(20) NOT NULL
    CHECK (advanced_type IN ('STOP_LOSS', 'TAKE_PROFIT', 'TRAILING_STOP')),
  trigger_price DECIMAL(15,4),
  trail_amount DECIMAL(15,4),
  trail_percent DECIMAL(5,2),
  high_water_mark DECIMAL(15,4),
  time_in_force VARCHAR(10) NOT NULL DEFAULT 'DAY'
    CHECK (time_in_force IN ('DAY', 'GTC'))
);
