# Advanced Order Types Backend Implementation

## 1. Overview
Implement backend support for advanced order types (Stop-Loss, Take-Profit, Trailing Stop) and Time-In-Force (Day, GTC) for the Money-logix paper trading simulator. Execution will happen synchronously as real-time prices update.

## 2. Database Schema
Introduce a new table `advanced_orders` linked 1-to-1 with the base `orders` table.

```sql
CREATE TABLE advanced_orders (
  order_id INTEGER PRIMARY KEY REFERENCES orders(id) ON DELETE CASCADE,
  advanced_type VARCHAR(20) NOT NULL, -- 'STOP_LOSS', 'TAKE_PROFIT', 'TRAILING_STOP'
  trigger_price DECIMAL(15,4),
  trail_amount DECIMAL(15,4),
  trail_percent DECIMAL(5,2),
  high_water_mark DECIMAL(15,4),
  time_in_force VARCHAR(10) DEFAULT 'DAY' -- 'DAY', 'GTC'
);
```
The base `orders` table remains largely untouched, but `order_type` will now accept `'ADVANCED'`.

## 3. Real-Time Execution Logic
Order evaluation integrates into the existing price feed loop. On every price tick for an asset:

1. Fetch all `PENDING` advanced orders for that asset.
2. Evaluate based on `advanced_type`:
   - **Stop-Loss (Sell):** Execute if `current_price <= trigger_price`.
   - **Take-Profit (Sell):** Execute if `current_price >= trigger_price`.
   - **Trailing Stop (Sell):** 
     - If `current_price > high_water_mark`, update `high_water_mark = current_price`. Recalculate `trigger_price` (e.g., `HWM - trail_amount`).
     - Execute if `current_price <= trigger_price`.
3. Execution converts the order to a Market Order logic flow, updating the base order status to `FILLED` and mutating user positions/balances.

## 4. API Endpoint (`POST /api/orders`)
**Payload Additions (when `order_type` is 'ADVANCED'):**
- `advanced_type`: String, required.
- `trigger_price`: Decimal, required for Stop-Loss / Take-Profit.
- `trail_amount` or `trail_percent`: Decimal, required for Trailing Stop.
- `time_in_force`: String ('DAY' or 'GTC'), optional, default 'DAY'.

**Validations:**
- Stop-Loss (Sell): `trigger_price` < current price.
- Take-Profit (Sell): `trigger_price` > current price.
- Trailing Stop: Exactly one of `trail_amount` or `trail_percent` must be provided and > 0.
- Standard inventory checks apply at creation.

## 5. End-of-Day Sweep
A scheduled job (e.g., node-cron) runs daily after market close to find all `PENDING` orders (both limit and advanced). If `time_in_force == 'DAY'` (or if it's a standard limit order without GTC), mark status as `CANCELLED`.
