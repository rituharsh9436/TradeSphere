require('dotenv').config();
const http = require('node:http');
const app = require('./app');
const pool = require('./config/database');
const { ensureAdvancedOrdersSchema } = require('./db/ensureAdvancedOrdersSchema');
const assetRepository = require('./repositories/asset.repository');
const marketPriceRepository = require('./repositories/marketPrice.repository');
const createMarketSocket = require('./marketdata/marketSocket');
const { createMarketRuntime } = require('./marketdata/runtime');
const { isUsMarketOpen } = require('./marketdata/marketHours');

const PORT = process.env.PORT || 5000;

const startServer = async () => {
  try {
    await pool.query('SELECT NOW()'); // fail fast if the DB is unreachable
    await ensureAdvancedOrdersSchema();

    const server = http.createServer(app);
    const marketSocket = createMarketSocket();
    marketSocket.attach(server);

    const assets = await assetRepository.findAllActive();
    const latestPrices = await marketPriceRepository.findAll();
    const apiKey = process.env.FINNHUB_API_KEY || '';

    const buildRuntime = () =>
      createMarketRuntime({
        assets,
        latestPrices,
        apiKey,
        isMarketOpen: isUsMarketOpen(new Date()),
        marketSocket,
      });

    let runtime = buildRuntime();
    runtime.start();
    console.log(`Market data pipeline started in '${runtime.mode}' mode.`);

    // Re-evaluate market hours periodically and switch the tick source on an
    // open/close transition (e.g. simulator -> live Finnhub at the 09:30 open),
    // so the feed isn't frozen to whatever it was at boot. Tick sources are inert
    // until start(), so building one to compare is side-effect-free.
    const desiredMode = () => (apiKey && isUsMarketOpen(new Date()) ? 'finnhub' : 'simulated');
    const resyncTimer = setInterval(() => {
      if (desiredMode() === runtime.mode) return;
      const next = buildRuntime();
      console.log(`Market mode change: '${runtime.mode}' -> '${next.mode}'.`);
      runtime.stop();
      runtime = next;
      runtime.start();
    }, Number(process.env.MARKET_MODE_RESYNC_MS) || 60000);
    if (resyncTimer.unref) resyncTimer.unref();

    server.listen(PORT, () => {
      console.log(`Server is running on http://localhost:${PORT}`);
    });

    // Single, idempotent shutdown path. Awaits server.close() (drains in-flight
    // requests) before ending the pool, and guards against a second signal so we
    // never call pool.end() twice.
    let shuttingDown = false;
    const shutdown = async (reason, code = 0) => {
      if (shuttingDown) return;
      shuttingDown = true;
      console.log(`Shutting down (${reason})...`);
      clearInterval(resyncTimer);
      try {
        runtime.stop();
        marketSocket.close();
        await new Promise((resolve) => server.close(resolve));
        await pool.end();
      } catch (err) {
        console.error('Error during shutdown:', err.message);
      }
      process.exit(code);
    };
    process.on('SIGINT', () => shutdown('SIGINT'));
    process.on('SIGTERM', () => shutdown('SIGTERM'));

    // Last-resort handlers: log structured, then shut down non-zero. Without these
    // an unhandled rejection/exception outside the request path (e.g. in the
    // market pipeline) would crash with a bare stack and skip cleanup.
    process.on('unhandledRejection', (reason) => {
      const err = reason instanceof Error ? reason : new Error(String(reason));
      console.error(JSON.stringify({ level: 'error', msg: 'unhandledRejection', error: err.message, stack: err.stack }));
      shutdown('unhandledRejection', 1);
    });
    process.on('uncaughtException', (err) => {
      console.error(JSON.stringify({ level: 'error', msg: 'uncaughtException', error: err.message, stack: err.stack }));
      shutdown('uncaughtException', 1);
    });
  } catch (error) {
    console.error('Failed to start the server.', error);
    process.exit(1);
  }
};

startServer();
