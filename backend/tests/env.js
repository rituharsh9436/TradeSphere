// Test preload (wired via `node --test --require ./tests/env.js`). Runs before any
// test file — and therefore before src/app is imported — so middleware that reads
// NODE_ENV at construction time sees 'test'. This keeps request logging quiet and
// rate limiting disabled during the suite, while leaving the legacy dev routes
// mounted (test !== production) and the JWT dev fallback active.
process.env.NODE_ENV = process.env.NODE_ENV || 'test';
process.env.BREVO_API_KEY = 'test_key';
process.env.MAIL_FROM_EMAIL = 'test@example.com';
process.env.MAIL_FROM_NAME = 'Test App';
process.env.OTP_SECRET = 'test-secret';
