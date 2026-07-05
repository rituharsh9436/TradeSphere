const AppError = require('../utils/AppError');

// Tiny declarative request-body validator. A schema maps field name -> rule:
//   { type: 'string'|'number', required, min, max, enum }
// For strings, min/max bound the length; for numbers, the value. `enum`
// (case-insensitive) restricts allowed values. Unknown fields are ignored so
// optional extras (e.g. orderType/targetPrice) pass through untouched.
//
// It collects ALL failures and throws one AppError(400) with a combined message,
// matching the wording of the existing service-level checks. Service validation
// is intentionally kept as defense-in-depth for non-HTTP callers.
function checkField(name, rule, value) {
  const present = value !== undefined && value !== null && value !== '';
  if (!present) {
    return rule.required ? `${name} is required.` : null;
  }

  if (rule.type === 'number') {
    // Accept only a real number or a numeric string — reject booleans, arrays and
    // objects (which Number() would silently coerce to 0/1/NaN) and non-finite
    // values like Infinity (JSON.parse turns 1e999 into Infinity).
    const isNumericString = typeof value === 'string' && value.trim() !== '';
    if (typeof value !== 'number' && !isNumericString) return `${name} must be a number.`;
    const n = Number(value);
    if (!Number.isFinite(n)) return `${name} must be a finite number.`;
    if (rule.min !== undefined && n < rule.min) return `${name} must be at least ${rule.min}.`;
    if (rule.max !== undefined && n > rule.max) return `${name} must be at most ${rule.max}.`;
    return null;
  }

  // Default: string.
  if (typeof value !== 'string') return `${name} must be a string.`;
  if (rule.min !== undefined && value.length < rule.min) {
    return `${name} must be at least ${rule.min} characters.`;
  }
  if (rule.max !== undefined && value.length > rule.max) {
    return `${name} must be at most ${rule.max} characters.`;
  }
  if (rule.enum) {
    const allowed = rule.enum.map((v) => v.toUpperCase());
    if (!allowed.includes(String(value).toUpperCase())) {
      return `${name} must be one of: ${rule.enum.join(', ')}.`;
    }
  }
  return null;
}

function validate(schema) {
  return (req, res, next) => {
    const body = req.body || {};
    const errors = [];
    for (const [name, rule] of Object.entries(schema)) {
      const message = checkField(name, rule, body[name]);
      if (message) errors.push(message);
    }
    if (errors.length) return next(new AppError(errors.join(' '), 400));
    return next();
  };
}

module.exports = validate;
