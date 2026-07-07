CREATE TABLE IF NOT EXISTS advanced_orders (
  order_id INTEGER PRIMARY KEY REFERENCES orders(id) ON DELETE CASCADE,
  advanced_type VARCHAR(20) NOT NULL, -- 'STOP_LOSS', 'TAKE_PROFIT', 'TRAILING_STOP'
  trigger_price DECIMAL(15,4),
  trail_amount DECIMAL(15,4),
  trail_percent DECIMAL(5,2),
  high_water_mark DECIMAL(15,4),
  time_in_force VARCHAR(10) DEFAULT 'DAY'
);
