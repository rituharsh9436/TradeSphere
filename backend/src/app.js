const express = require('express');
const cors = require('cors');
const helmet = require('helmet');

const apiRoutes = require('./routes');
const { notFound, errorHandler } = require('./middleware/errorHandler');
const { apiLimiter } = require('./middleware/rateLimit');
const requestLogger = require('./middleware/requestLogger');

const app = express();

// Observability first, so every request (including 4xx/5xx) is logged.
app.use(requestLogger);

// Security & parsing middleware
app.use(helmet()); // sensible security headers (CSP off by default for a JSON API)
app.use(cors());
app.use(express.json()); // Parses incoming JSON requests

// Health check route (no rate limit — used by liveness probes)
app.get('/api/health', (req, res) => {
  res.status(200).json({ status: 'UP', message: 'Trading engine is running.' });
});

// API routes (rate-limited in production; inert in dev/test)
app.use('/api', apiLimiter, apiRoutes);

// 404 + central error handler (must be registered last)
app.use(notFound);
app.use(errorHandler);

module.exports = app;