// Test preload (wired via `node --test --require ./tests/env.js`). Runs before any
// test file — and therefore before src/app is imported — so middleware that reads
// NODE_ENV at construction time sees 'test'. This keeps request logging quiet and
// rate limiting disabled during the suite, while leaving the legacy dev routes
// mounted (test !== production) and the JWT dev fallback active.
process.env.NODE_ENV = process.env.NODE_ENV || 'test';
