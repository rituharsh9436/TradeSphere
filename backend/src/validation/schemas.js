// Request-body schemas for the `validate` middleware. These mirror the documented
// API contracts and the service-level checks; the service keeps its own validation
// as defense-in-depth for non-HTTP callers.

const registerSchema = {
  email: { type: 'string', required: true, max: 255 },
  code: { type: 'string', required: true, min: 6, max: 6 },
};

const requestRegistrationOtpSchema = {
  fullName: { type: 'string', required: true, min: 1, max: 100 },
  username: { type: 'string', required: true, min: 1, max: 50 },
  email: { type: 'string', required: true, max: 255 },
  password: { type: 'string', required: true, min: 8 },
};

const loginSchema = {
  email: { type: 'string', required: true },
  password: { type: 'string', required: true },
};

const deleteAccountSchema = {
  password: { type: 'string', required: true, min: 1 },
};

// symbol/side/quantity are always required. orderType and targetPrice are
// optional here — the service owns the MARKET-vs-LIMIT rule (LIMIT needs a
// positive targetPrice; MARKET must omit it) and the quantity > 0 check.
const placeOrderSchema = {
  symbol: { type: 'string', required: true, min: 1, max: 10 },
  side: { type: 'string', required: true, enum: ['BUY', 'SELL'] },
  quantity: { type: 'number', required: true },
  orderType: { type: 'string', required: false, enum: ['MARKET', 'LIMIT'] },
  targetPrice: { type: 'number', required: false },
};

module.exports = { registerSchema, requestRegistrationOtpSchema, loginSchema, deleteAccountSchema, placeOrderSchema };
