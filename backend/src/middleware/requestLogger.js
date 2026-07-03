// One structured line per request, emitted when the response finishes so the
// status code and duration are known. Silent under test to keep the suite output
// clean; active in development and production for basic observability.
const requestLogger = (req, res, next) => {
  if (process.env.NODE_ENV === 'test') return next();

  const start = process.hrtime.bigint();
  res.on('finish', () => {
    const durationMs = Number(process.hrtime.bigint() - start) / 1e6;
    const line = {
      level: 'info',
      msg: 'request',
      method: req.method,
      path: req.originalUrl,
      status: res.statusCode,
      durationMs: Math.round(durationMs * 10) / 10,
    };
    console.log(JSON.stringify(line));
  });

  next();
};

module.exports = requestLogger;
