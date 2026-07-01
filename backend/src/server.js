require('dotenv').config();
const http = require('node:http');
const app = require('./app');
const pool = require('./config/database');
const assetRepository = require('./repositories/asset.repository');
const marketPriceRepository = require('./repositories/marketPrice.repository');
const createMarketSocket = require('./marketdata/marketSocket');
const { createMarketRuntime } = require('./marketdata/runtime');
const { isUsMarketOpen } = require('./marketdata/marketHours');

const PORT = process.env.PORT || 5000;

const startServer = async () => {
  try {
    await pool.query('SELECT NOW()'); // fail fast if the DB is unreachable

    const server = http.createServer(app);
    const marketSocket = createMarketSocket();
    marketSocket.attach(server);

    const assets = await assetRepository.findAllActive();
    const latestPrices = await marketPriceRepository.findAll();
    const runtime = createMarketRuntime({
      assets,
      latestPrices,
      apiKey: process.env.FINNHUB_API_KEY || '',
      isMarketOpen: isUsMarketOpen(new Date()),
      marketSocket,
    });
    runtime.start();
    console.log(`Market data pipeline started in '${runtime.mode}' mode.`);

    server.listen(PORT, () => {
      console.log(`Server is running on http://localhost:${PORT}`);
    });

    const shutdown = async () => {
      console.log('Shutting down...');
      runtime.stop();
      marketSocket.close();
      server.close();
      await pool.end();
      process.exit(0);
    };
    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);
  } catch (error) {
    console.error('Failed to start the server.', error);
    process.exit(1);
  }
};

startServer();
