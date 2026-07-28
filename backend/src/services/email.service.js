const nodemailer = require('nodemailer');
const AppError = require('../utils/AppError');

function mailConfig() {
  const { SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASSWORD, SMTP_FROM } = process.env;
  if (!SMTP_HOST || !SMTP_PORT || !SMTP_USER || !SMTP_PASSWORD || !SMTP_FROM) {
    console.error(`[EmailService] Missing required SMTP configuration. HOST=${!!SMTP_HOST} PORT=${!!SMTP_PORT} USER=${!!SMTP_USER} PASS=${!!SMTP_PASSWORD} FROM=${!!SMTP_FROM}`);
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
    console.log(`[EmailService] Attempting to send OTP to ${email} via ${config.SMTP_HOST}:${config.SMTP_PORT}...`);
    const info = await transport.sendMail({
      from: config.SMTP_FROM,
      to: email,
      subject: 'Your Money-logix verification code',
      text: `Your Money-logix verification code is ${code}. It expires in 10 minutes. Do not share this code.`,
    });
    console.log(`[EmailService] Successfully sent OTP to ${email}. Message ID: ${info.messageId}`);
  } catch (error) {
    console.error(`[EmailService] Registration OTP email failed to send to ${email}. Error:`, error);
    throw new AppError('We could not send the verification email. Please try again later.', 503);
  }
}

module.exports = { sendRegistrationOtp };
