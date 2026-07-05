const AppError = require('../utils/AppError');

// 404 handler for unmatched routes — forwards to the central error handler.
const notFound = (req, res, next) => {
  next(new AppError(`Route not found: ${req.method} ${req.originalUrl}`, 404));
};

// Central error handler. Must be registered last (4-arg signature).
// eslint-disable-next-line no-unused-vars
const errorHandler = (err, req, res, next) => {
  const statusCode = err.statusCode || 500;

  // Map a couple of common Postgres errors to friendly client responses. These
  // are client faults, so they use status:'fail' (4xx) like every other client
  // error — not 'error', which the envelope contract reserves for 5xx.
  if (err.code === '23505') {
    // unique_violation
    return res.status(409).json({ status: 'fail', message: 'Resource already exists.' });
  }
  if (err.code === '23514' || err.code === '23502') {
    // check_violation / not_null_violation
    return res.status(400).json({ status: 'fail', message: 'Invalid input data.' });
  }
  if (err.code === '22P02') {
    // invalid_text_representation — e.g. a malformed UUID in the URL
    return res.status(400).json({ status: 'fail', message: 'Invalid identifier format.' });
  }

  // Structured server-side log for genuine failures (5xx / unexpected bugs).
  // Operational 4xx errors are expected client mistakes and are not logged.
  // Silent under test to keep the suite output clean.
  if (statusCode >= 500 && process.env.NODE_ENV !== 'test') {
    console.error(
      JSON.stringify({
        level: 'error',
        msg: 'unhandled_error',
        method: req.method,
        path: req.originalUrl,
        statusCode,
        error: err.message,
        code: err.code,
        stack: err.isOperational ? undefined : err.stack,
      })
    );
  }

  res.status(statusCode).json({
    status: statusCode >= 500 ? 'error' : 'fail',
    message: err.isOperational ? err.message : 'Something went wrong.',
  });
};

module.exports = { notFound, errorHandler };
