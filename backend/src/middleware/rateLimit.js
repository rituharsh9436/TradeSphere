const rateLimit = require('express-rate-limit');
const AppError = require('../utils/AppError');

// Rate limiting. Active only in production so local development and the test
// suite (which fire many requests quickly) are never throttled. The store is
// in-memory / per-process — fine for a single instance; a shared store (e.g.
// Redis) would be required if the API is scaled horizontally.
const onlyInProduction = () => process.env.NODE_ENV !== 'production';

// Emit the app's standard error envelope on a limit hit (429) by routing through
// the central error handler instead of express-rate-limit's default plain body.
const limitHandler = (req, res, next) => {
  next(new AppError('Too many requests, please try again later.', 429));
};

const commonOptions = {
  standardHeaders: true, // RateLimit-* headers
  legacyHeaders: false,
  skip: onlyInProduction,
  handler: limitHandler,
};

// Broad limiter for the whole API surface.
const apiLimiter = rateLimit({
  ...commonOptions,
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 300,
});

// Tight limiter for the auth endpoints — throttles credential-stuffing and
// registration abuse harder than ordinary reads.
const authLimiter = rateLimit({
  ...commonOptions,
  windowMs: 15 * 60 * 1000,
  max: 20,
});

module.exports = { apiLimiter, authLimiter };
