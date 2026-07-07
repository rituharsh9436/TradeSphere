# Advanced Order Types Backend Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement backend data layer, execution logic, and API endpoints for Stop-Loss, Take-Profit, and Trailing Stop advanced order types.

**Architecture:** We add an `advanced_orders` database table joined 1-to-1 with `orders`. The real-time matcher (or a new module hooked into the price tick) will query `PENDING` advanced orders, evaluate their trigger conditions against the live price (including maintaining `high_water_mark` for trailing stops), and execute those that cross the threshold as market orders.

**Tech Stack:** Node.js, Express, PostgreSQL, pg

## Global Constraints

- Execution logic must handle real-time simulation on price ticks.
- Schema update must use valid PostgreSQL syntax compatible with the existing `orders` table.

---

### Task 1: Create Database Migration for Advanced Orders

**Files:**
- Create: `backend/scripts/migrate_advanced_orders.js` (or integrate into an existing schema init script if there is no migration framework)
- Modify: `backend/src/repositories/order.repository.js:1-50` (we need to prepare to query/insert to the new table)
- Modify: `backend/src/models/schema.sql` (if it exists, representing the source of truth)

**Interfaces:**
- Produces: A new `advanced_orders` table linked to `orders` and support for `order_type='ADVANCED'`.

- [ ] **Step 1: Write the migration script or update schema file**

If there is a `schema.sql` (we need to check, let's assume we create a quick setup script or add to `backend/scripts/setup.js` if it exists). Let's create an explicit raw SQL script to be executed.

```sql
-- backend/scripts/advanced_orders.sql
CREATE TABLE IF NOT EXISTS advanced_orders (
  order_id INTEGER PRIMARY KEY REFERENCES orders(id) ON DELETE CASCADE,
  advanced_type VARCHAR(20) NOT NULL, -- 'STOP_LOSS', 'TAKE_PROFIT', 'TRAILING_STOP'
  trigger_price DECIMAL(15,4),
  trail_amount DECIMAL(15,4),
  trail_percent DECIMAL(5,2),
  high_water_mark DECIMAL(15,4),
  time_in_force VARCHAR(10) DEFAULT 'DAY'
);
```

- [ ] **Step 2: Update the Order Repository to handle advanced insertions**

In `backend/src/repositories/order.repository.js`, update the `create` method to also accept and insert into `advanced_orders` if `orderType === 'ADVANCED'` within a transaction.

```javascript
  async create(
    { userId, assetId, orderType, side, quantity, targetPrice = null, status = 'PENDING', advancedParams = null },
    client = pool
  ) {
    // If client is pool, we might want a transaction for advanced orders. 
    // For simplicity, we'll assume we can run them sequentially or use a real transaction wrapper if provided.
    const isLocalTx = client === pool && advancedParams;
    const db = isLocalTx ? await pool.connect() : client;
    
    try {
      if (isLocalTx) await db.query('BEGIN');
      
      const { rows } = await db.query(
        `INSERT INTO orders (user_id, asset_id, order_type, side, quantity, target_price, status)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         RETURNING id, user_id, asset_id, order_type, side, quantity, target_price, status, created_at`,
        [userId, assetId, orderType, side, quantity, targetPrice, status]
      );
      const order = rows[0];

      if (orderType === 'ADVANCED' && advancedParams) {
        await db.query(
          `INSERT INTO advanced_orders (order_id, advanced_type, trigger_price, trail_amount, trail_percent, high_water_mark, time_in_force)
           VALUES ($1, $2, $3, $4, $5, $6, $7)`,
          [
            order.id, 
            advancedParams.advanced_type, 
            advancedParams.trigger_price, 
            advancedParams.trail_amount, 
            advancedParams.trail_percent, 
            advancedParams.high_water_mark, 
            advancedParams.time_in_force || 'DAY'
          ]
        );
      }
      
      if (isLocalTx) await db.query('COMMIT');
      return order;
    } catch (err) {
      if (isLocalTx) await db.query('ROLLBACK');
      throw err;
    } finally {
      if (isLocalTx) db.release();
    }
  },
```

- [ ] **Step 3: Commit the database changes**
```bash
git add backend/scripts/advanced_orders.sql backend/src/repositories/order.repository.js
git commit -m "feat: add advanced_orders database schema and repository support"
```

---

### Task 2: Implement Real-Time Execution Logic for Advanced Orders

**Files:**
- Create: `backend/src/services/advancedOrderMatcher.js`
- Modify: `backend/src/repositories/order.repository.js:100-120` (add method to fetch pending advanced orders)
- Modify: `backend/src/services/order.service.js` (or wherever market data ticks are processed, to call the new matcher)

**Interfaces:**
- Consumes: The `advanced_orders` schema from Task 1.
- Produces: An evaluation function that accepts `(assetId, currentPrice)` and processes triggered orders.

- [ ] **Step 1: Add a repository method to find pending advanced orders**

In `backend/src/repositories/order.repository.js`:

```javascript
  // Fetch pending advanced orders with their advanced parameters joined
  async findPendingAdvancedByAsset(assetId, client = pool) {
    const { rows } = await client.query(
      `SELECT o.id, o.user_id, o.asset_id, o.side, o.quantity, o.status,
              a.advanced_type, a.trigger_price, a.trail_amount, a.trail_percent, a.high_water_mark, a.time_in_force
       FROM orders o
       JOIN advanced_orders a ON o.id = a.order_id
       WHERE o.asset_id = $1 AND o.status = 'PENDING' AND o.order_type = 'ADVANCED'`,
      [assetId]
    );
    return rows;
  },
  
  // Update trailing stop HWM and trigger price
  async updateTrailingStop(orderId, hwm, triggerPrice, client = pool) {
    await client.query(
      `UPDATE advanced_orders 
       SET high_water_mark = $2, trigger_price = $3 
       WHERE order_id = $1`,
      [orderId, hwm, triggerPrice]
    );
  }
```

- [ ] **Step 2: Create the Advanced Order Matcher Logic**

In `backend/src/services/advancedOrderMatcher.js`:

```javascript
const orderRepository = require('../repositories/order.repository');
// Assume we need order service to execute the market order once triggered
const orderService = require('./order.service'); 

async function evaluateAdvancedOrders(assetId, currentPrice) {
  const pendingOrders = await orderRepository.findPendingAdvancedByAsset(assetId);
  const current = Number(currentPrice);

  for (const order of pendingOrders) {
    let shouldTrigger = false;
    const trigger = Number(order.trigger_price);

    if (order.advanced_type === 'STOP_LOSS') {
      if (order.side === 'SELL' && current <= trigger) shouldTrigger = true;
      if (order.side === 'BUY' && current >= trigger) shouldTrigger = true;
    } 
    else if (order.advanced_type === 'TAKE_PROFIT') {
      if (order.side === 'SELL' && current >= trigger) shouldTrigger = true;
      if (order.side === 'BUY' && current <= trigger) shouldTrigger = true;
    }
    else if (order.advanced_type === 'TRAILING_STOP') {
      let hwm = Number(order.high_water_mark);
      
      // Update HWM if price moved favorably (we assume SELL orders trail below a rising price)
      // For a SELL trailing stop, we want the price to go UP. HWM tracks the highest price.
      if (order.side === 'SELL' && current > hwm) {
        hwm = current;
        let newTrigger = 0;
        if (order.trail_amount) {
          newTrigger = hwm - Number(order.trail_amount);
        } else if (order.trail_percent) {
          newTrigger = hwm * (1 - (Number(order.trail_percent) / 100));
        }
        await orderRepository.updateTrailingStop(order.id, hwm, newTrigger);
        // Continue evaluation with new trigger
      }
      
      // Trigger if current price falls to or below the trigger
      if (order.side === 'SELL' && current <= Number(order.trigger_price)) {
         shouldTrigger = true;
      }
    }

    if (shouldTrigger) {
      // Execute as a market order. 
      // Note: we might need a specific internal method in orderService to fill an existing order 
      // rather than placing a new one. For this task, we assume `orderService.fillTriggeredOrder(order.id, currentPrice)` exists or will be created.
      try {
         await orderService.fillTriggeredOrder(order.id, current);
      } catch (err) {
         console.error(`Failed to execute triggered order ${order.id}:`, err.message);
      }
    }
  }
}

module.exports = { evaluateAdvancedOrders };
```

*(Note: The exact implementation of `fillTriggeredOrder` will need to be verified or built in `order.service.js` during execution, reusing existing fill logic).*

- [ ] **Step 3: Commit the logic**
```bash
git add backend/src/repositories/order.repository.js backend/src/services/advancedOrderMatcher.js
git commit -m "feat: add real-time evaluation logic for advanced orders"
```

---

### Task 3: Update Order API & Validation

**Files:**
- Modify: `backend/src/controllers/order.controller.js`
- Modify: `backend/src/services/order.service.js`

**Interfaces:**
- Consumes: Execution logic and repository methods from Tasks 1 & 2.
- Produces: API accepting `advanced_type`, `trigger_price`, `trail_amount`, `trail_percent`, `time_in_force`.

- [ ] **Step 1: Add validation in the Order Controller/Service**

In `backend/src/services/order.service.js` (inside the `place` function):

```javascript
  async place({ userId, symbol, side, quantity, orderType, targetPrice, advancedType, triggerPrice, trailAmount, trailPercent, timeInForce }) {
    // ... existing asset lookup and inventory checks ...
    
    let advancedParams = null;
    if (orderType === 'ADVANCED') {
       if (!['STOP_LOSS', 'TAKE_PROFIT', 'TRAILING_STOP'].includes(advancedType)) {
         throw new Error("Invalid advanced_type");
       }
       
       // Example logic for SELL validations:
       if (side === 'SELL') {
          // Assume currentPrice is fetched here for validation
          const current = Number(asset.current_price);
          
          if (advancedType === 'STOP_LOSS' && Number(triggerPrice) >= current) {
             throw new Error("Stop-loss trigger must be below current market price for SELL.");
          }
          if (advancedType === 'TAKE_PROFIT' && Number(triggerPrice) <= current) {
             throw new Error("Take-profit trigger must be above current market price for SELL.");
          }
          if (advancedType === 'TRAILING_STOP' && !trailAmount && !trailPercent) {
             throw new Error("Trailing stop requires trail_amount or trail_percent.");
          }
       }
       
       advancedParams = {
         advanced_type: advancedType,
         trigger_price: triggerPrice,
         trail_amount: trailAmount,
         trail_percent: trailPercent,
         high_water_mark: asset.current_price, // Initialize HWM to current price
         time_in_force: timeInForce || 'DAY'
       };
    }

    // Pass advancedParams to repository...
    const order = await orderRepository.create({
       userId, assetId: asset.id, orderType, side, quantity, targetPrice, advancedParams
    });
    
    // ... rest of place logic ...
    return order;
  }
```

- [ ] **Step 2: Update the Controller to extract new fields**

In `backend/src/controllers/order.controller.js`:
```javascript
  place: catchAsync(async (req, res) => {
    const { 
      userId, symbol, side, quantity, orderType, targetPrice, 
      advancedType, triggerPrice, trailAmount, trailPercent, timeInForce 
    } = req.body;
    
    const data = await orderService.place({ 
      userId, symbol, side, quantity, orderType, targetPrice, 
      advancedType, triggerPrice, trailAmount, trailPercent, timeInForce 
    });
    res.status(201).json({ status: 'success', data });
  }),
```

- [ ] **Step 3: Commit the API changes**
```bash
git add backend/src/controllers/order.controller.js backend/src/services/order.service.js
git commit -m "feat: add advanced order fields to API and validation"
```

---

### Task 4: End-of-Day Sweep (Time-In-Force)

**Files:**
- Create: `backend/src/scripts/sweepDayOrders.js`

**Interfaces:**
- Consumes: The `orders` and `advanced_orders` tables.
- Produces: A script that cancels expired 'DAY' orders.

- [ ] **Step 1: Write the sweep script**

Create `backend/src/scripts/sweepDayOrders.js`:
```javascript
const pool = require('../config/database');

async function sweepDayOrders() {
  console.log('Sweeping expired DAY orders...');
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    
    // Cancel standard pending limit orders (assuming they are DAY by default in this context)
    await client.query(
      `UPDATE orders 
       SET status = 'CANCELLED', updated_at = CURRENT_TIMESTAMP 
       WHERE status = 'PENDING' AND order_type = 'LIMIT'`
    );

    // Cancel advanced orders where time_in_force is 'DAY'
    await client.query(
      `UPDATE orders o
       SET status = 'CANCELLED', updated_at = CURRENT_TIMESTAMP
       FROM advanced_orders a
       WHERE o.id = a.order_id 
         AND o.status = 'PENDING' 
         AND o.order_type = 'ADVANCED' 
         AND a.time_in_force = 'DAY'`
    );

    await client.query('COMMIT');
    console.log('Sweep complete.');
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Sweep failed:', err);
  } finally {
    client.release();
    pool.end();
  }
}

sweepDayOrders();
```

- [ ] **Step 2: Commit the sweep script**
```bash
git add backend/src/scripts/sweepDayOrders.js
git commit -m "feat: add end-of-day order sweep script"
```
