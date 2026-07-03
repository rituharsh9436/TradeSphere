const AppError = require('../utils/AppError');
const catchAsync = require('../utils/catchAsync');
const { verifyToken } = require('../utils/token');

// Gate for protected routes. Requires `Authorization: Bearer <token>`, verifies
// it, and pins the authenticated user id on the request for downstream handlers.
const requireAuth = catchAsync(async (req, res, next) => {
  const header = req.headers.authorization || '';
  const [scheme, token] = header.split(' ');
  if (scheme !== 'Bearer' || !token) {
    throw new AppError('Authentication required.', 401);
  }
  const payload = verifyToken(token); // throws AppError(401) on bad/expired
  req.userId = payload.sub;
  next();
});

module.exports = { requireAuth };
