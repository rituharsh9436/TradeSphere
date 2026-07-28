const AppError = require('../utils/AppError');

const BREVO_API_URL = 'https://api.brevo.com/v3/smtp/email';

/**
 * Generic email sending method using Brevo API
 * @param {Object} options 
 * @param {string} options.to - Recipient email address
 * @param {string} options.subject - Email subject
 * @param {string} options.htmlContent - HTML version of the email
 * @param {string} options.textContent - Plain text version of the email
 * @returns {Promise<Object>} API response data
 */
async function sendEmail({ to, subject, htmlContent, textContent }) {
  const { BREVO_API_KEY, MAIL_FROM_EMAIL, MAIL_FROM_NAME } = process.env;

  // We already validate these on startup, but double-checking is safe
  if (!BREVO_API_KEY || !MAIL_FROM_EMAIL || !MAIL_FROM_NAME) {
    console.error(`[EmailService] Missing required Brevo configuration.`);
    throw new AppError('Email service is temporarily unavailable. Please try again later.', 503);
  }

  const payload = {
    sender: { name: MAIL_FROM_NAME, email: MAIL_FROM_EMAIL },
    to: [{ email: to }],
    subject,
    htmlContent,
    textContent
  };

  const maxRetries = 2;
  let attempt = 0;

  while (attempt <= maxRetries) {
    try {
      if (attempt === 0) {
        console.log(`[EmailService] Attempting to send email to ${to}...`);
      } else {
        console.log(`[EmailService] Retry attempt ${attempt} for ${to}...`);
      }

      const response = await fetch(BREVO_API_URL, {
        method: 'POST',
        headers: {
          'api-key': BREVO_API_KEY,
          'Content-Type': 'application/json',
          'Accept': 'application/json'
        },
        body: JSON.stringify(payload)
      });

      if (!response.ok) {
        let errorData = {};
        try {
          errorData = await response.json();
        } catch (e) {
          // Response wasn't JSON
        }
        
        const statusCode = response.status;
        console.error(`[EmailService] Brevo API Error (Status ${statusCode}):`, errorData);

        // Do not retry for 4xx errors (except 429 rate limit)
        if (statusCode >= 400 && statusCode < 500 && statusCode !== 429) {
          throw new AppError('We could not send the email. Please try again later.', 503);
        }

        // Retry on 5xx or 429
        throw new Error(`Brevo API transient error: ${statusCode}`);
      }

      const data = await response.json();
      console.log(`[EmailService] Successfully sent email to ${to}. Message ID: ${data.messageId}`);
      return data;
    } catch (error) {
      if (error instanceof AppError) {
        throw error;
      }
      
      console.error(`[EmailService] Email sending failed (Attempt ${attempt + 1}). Error:`, error.message);
      
      if (attempt >= maxRetries) {
        console.error(`[EmailService] Max retries reached for ${to}. Giving up.`);
        throw new AppError('We could not send the email. Please try again later.', 503);
      }
      
      attempt++;
      // Wait before retrying (exponential backoff)
      await new Promise(resolve => setTimeout(resolve, attempt * 1000));
    }
  }
}

/**
 * Sends a registration OTP email
 */
async function sendRegistrationOtp({ email, code }) {
  const subject = 'Your Money-logix verification code';
  const textContent = `Your Money-logix verification code is ${code}. It expires in 10 minutes. Do not share this code.`;
  const htmlContent = `
    <h2>Your OTP Code</h2>
    <p>Your verification code is:</p>
    <h1>${code}</h1>
    <p>This OTP will expire in 10 minutes. Do not share this code.</p>
  `;

  return sendEmail({
    to: email,
    subject,
    htmlContent,
    textContent
  });
}

module.exports = { sendEmail, sendRegistrationOtp };
