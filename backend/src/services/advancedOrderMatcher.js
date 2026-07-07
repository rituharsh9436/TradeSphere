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
