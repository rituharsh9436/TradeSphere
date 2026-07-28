const path = require('node:path');
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');

const apiRoutes = require('./routes');
const { notFound, errorHandler } = require('./middleware/errorHandler');
const { apiLimiter } = require('./middleware/rateLimit');
const requestLogger = require('./middleware/requestLogger');

// OpenAPI spec, loaded once. Optional: if the file is absent (e.g. a trimmed
// deploy that ships only backend/), the endpoint 404s instead of crashing.
let openApiSpec = null;
try {
  openApiSpec = require(path.join(__dirname, '../../docs/openapi.json'));
} catch {
  openApiSpec = null;
}

const app = express();

// Trust the reverse proxy / load balancer so req.ip is the real client IP
// (X-Forwarded-For) rather than the proxy's — without this, rate limiting keys
// every request to the single proxy IP. TRUST_PROXY accepts a hop count or an
// express trust-proxy value; defaults to 1 in production, off otherwise.
const trustProxy = process.env.TRUST_PROXY;
if (trustProxy !== undefined) {
  const asNum = Number(trustProxy);
  app.set('trust proxy', Number.isNaN(asNum) ? trustProxy : asNum);
} else if (process.env.NODE_ENV === 'production') {
  app.set('trust proxy', 1);
}

// Observability first, so every request (including 4xx/5xx) is logged.
app.use(requestLogger);

// Security & parsing middleware
app.use(helmet()); // sensible security headers (CSP off by default for a JSON API)
// Restrict CORS to an allowlist when CORS_ORIGIN is set (comma-separated origins).
// Browser origins never include a path, so this must be e.g.
// https://trade--sphere.vercel.app — not /login or any other route.
const corsOrigin = process.env.CORS_ORIGIN;
const allowedOrigins = corsOrigin
  ? corsOrigin.split(',').map((origin) => origin.trim()).filter(Boolean)
  : process.env.NODE_ENV === 'production'
    ? ['https://trade--sphere.vercel.app']
    : null;

app.use(cors({
  origin: allowedOrigins || true,
  credentials: true,
}));
app.use(express.json()); // Parses incoming JSON requests

// Health check route (no rate limit — used by liveness probes)
app.get('/api/health', (req, res) => {
  res.status(200).json({ status: 'UP', message: 'Trading engine is running.' });
});

// Machine-readable API contract (OpenAPI 3.1). Served raw (no Swagger-UI dep).
app.get('/api/openapi.json', (req, res) => {
  if (!openApiSpec) {
    return res.status(404).json({ status: 'fail', message: 'OpenAPI spec not available.' });
  }
  return res.status(200).json(openApiSpec);
});

// API routes (rate-limited in production; inert in dev/test)
app.use('/api', apiLimiter, apiRoutes);

// 404 + central error handler (must be registered last)
app.use(notFound);
app.use(errorHandler);

module.exports = app;
