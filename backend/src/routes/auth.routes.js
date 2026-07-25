const express = require('express');
const authController = require('../controllers/auth.controller');
const { authLimiter } = require('../middleware/rateLimit');
const validate = require('../middleware/validate');
const { registerSchema, requestRegistrationOtpSchema, loginSchema } = require('../validation/schemas');

const router = express.Router();

// Tighter throttle on the credential endpoints (production-only).
router.post('/request-registration-otp', authLimiter, validate(requestRegistrationOtpSchema), authController.requestRegistrationOtp);
router.post('/register', authLimiter, validate(registerSchema), authController.register);
router.post('/login', authLimiter, validate(loginSchema), authController.login);

module.exports = router;
