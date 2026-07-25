const nodemailer = require('nodemailer');
const AppError = require('../utils/AppError');

function mailConfig() {
  const { SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASSWORD, SMTP_FROM } = process.env;
  if (!SMTP_HOST || !SMTP_PORT || !SMTP_USER || !SMTP_PASSWORD || !SMTP_FROM) {
    throw new AppError('Email verification is temporarily unavailable. Please try again later.', 503);
  }
  return { SMTP_HOST, SMTP_PORT: Number(SMTP_PORT), SMTP_USER, SMTP_PASSWORD, SMTP_FROM };
}

async function sendRegistrationOtp({ email, code }) {
  const config = mailConfig();
  const transport = nodemailer.createTransport({
    host: config.SMTP_HOST,
    port: config.SMTP_PORT,
    secure: process.env.SMTP_SECURE === 'true',
    auth: { user: config.SMTP_USER, pass: config.SMTP_PASSWORD },
  });
  try {
    await transport.sendMail({
      from: config.SMTP_FROM,
      to: email,
      subject: 'Your Money-logix verification code',
      text: `Your Money-logix verification code is ${code}. It expires in 10 minutes. Do not share this code.`,
    });
  } catch (error) {
    console.error('Registration OTP email failed:', error.message);
    throw new AppError('We could not send the verification email. Please try again later.', 503);
  }
}

module.exports = { sendRegistrationOtp };
