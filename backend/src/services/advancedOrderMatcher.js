const orderRepository = require('../repositories/order.repository');
// Assume we need order service to execute the market order once triggered
const orderService = require('./order.service');

// Real-time trigger evaluation. Called once per throttled price tick from
// orderService.processLimitOrdersForSymbol. Each pending advanced order is
// re-read on every tick (cheap because the candidate set is small and indexed
// by asset), evaluated against the current price, and either fires a fill or
// updates the trailing-stop high-water-mark. Never throws — per-order failures
// are caught and logged so a single bad order can't poison the tick pipeline.
async function evaluateAdvancedOrders(assetId, currentPrice) {
  const pendingOrders = await orderRepository.findPendingAdvancedByAsset(assetId);
  const current = Number(currentPrice);

  for (const order of pendingOrders) {
    try {
      await evaluateOne(order, current);
    } catch (err) {
      console.error(`Advanced-order eval failed for ${order.id}:`, err.message);
    }
  }
}

async function evaluateOne(order, current) {
  // STOP_LOSS and TAKE_PROFIT use a static trigger_price written at creation
  // and never recomputed. The trailing-stop branch is handled separately
  // because it owns its own HWM lifecycle.
  if (order.advanced_type === 'STOP_LOSS' || order.advanced_type === 'TAKE_PROFIT') {
    const trigger = Number(order.trigger_price);
    if (Number.isNaN(trigger)) return; // can't fire without a seeded trigger
    const shouldTrigger =
      (order.advanced_type === 'STOP_LOSS'
        ? (order.side === 'SELL' && current <= trigger) ||
          (order.side === 'BUY' && current >= trigger)
        : (order.side === 'SELL' && current >= trigger) ||
          (order.side === 'BUY' && current <= trigger));
    if (shouldTrigger) {
      await orderService.fillTriggeredOrder(order.id, current);
    }
    return;
  }

  if (order.advanced_type !== 'TRAILING_STOP') return;

  // Trailing-stop evaluation mirrors the spec on both sides:
  //   SELL → track highest price (HWM up); trigger when price falls to
  //            hwm - trail_amount  (or hwm * (1 - trail_percent / 100)).
  //   BUY  → track lowest  price (HWM down); trigger when price rises to
  //            hwm + trail_amount  (or hwm * (1 + trail_percent / 100)).
  // The order is silently inert until the FIRST favorable tick seeds the
  // trigger_price. Without that guard, the seed `trigger_price IS NULL`
  // would coerce to 0 in JS and fire the order on its very first tick —
  // regardless of whether the market has ever moved in the favorable
  // direction.
  const seededTrigger = Number(order.trigger_price);
  const hwm = Number(order.high_water_mark);
  const trailAmount = order.trail_amount !== null ? Number(order.trail_amount) : null;
  const trailPercent = order.trail_percent !== null ? Number(order.trail_percent) : null;

  const isFavorable =
    (order.side === 'SELL' && current > hwm) ||
    (order.side === 'BUY' && current < hwm);

  if (isFavorable) {
    const newHwm = current;
    let newTrigger;
    if (trailAmount !== null) {
      newTrigger = order.side === 'SELL' ? newHwm - trailAmount : newHwm + trailAmount;
    } else if (trailPercent !== null) {
      const factor = order.side === 'SELL' ? 1 - trailPercent / 100 : 1 + trailPercent / 100;
      newTrigger = newHwm * factor;
    } else {
      // No trail specified — treat as inert rather than firing at HWM delta=0.
      return;
    }
    // Atomic ratchet in the DB — only ratchets up for SELL trails and down
    // for BUY trails, so parallel ticks can't write a stale HWM. rowCount=0
    // means another concurrent tick won the race; either way we don't fire
    // on this tick (recompute next tick).
    await orderRepository.ratchetTrailingStop({
      orderId: order.id, newHwm, newTrigger, side: order.side,
    });
    return;
  }

  // Trigger only after at least one favorable tick has seeded trigger_price.
  if (Number.isNaN(seededTrigger)) return;
  const shouldTrigger =
    (order.side === 'SELL' && current <= seededTrigger) ||
    (order.side === 'BUY' && current >= seededTrigger);
  if (shouldTrigger) {
    await orderService.fillTriggeredOrder(order.id, current);
  }
}

module.exports = { evaluateAdvancedOrders };

