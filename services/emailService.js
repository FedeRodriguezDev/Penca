const nodemailer = require('nodemailer');

let transporter = null;
let warnedMissingConfig = false;

function getSmtpConfig() {
  const host = process.env.SMTP_HOST || '';
  const port = Number(process.env.SMTP_PORT || 587);
  const secure = String(process.env.SMTP_SECURE || '').toLowerCase() === 'true' || port === 465;
  const user = process.env.SMTP_USER || '';
  const pass = process.env.SMTP_PASS || '';
  const from = process.env.EMAIL_FROM || user || 'notificaciones@localhost';
  const replyTo = process.env.EMAIL_REPLY_TO || from;
  return { host, port, secure, user, pass, from, replyTo };
}

function hasEmailConfig() {
  const { host, port, user, pass } = getSmtpConfig();
  return Boolean(host && port && user && pass);
}

function getTransporter() {
  if (!hasEmailConfig()) return null;
  // Reset transporter if config changed (e.g. env var hot-reload in tests)
  if (transporter) return transporter;

  const { host, port, secure, user, pass } = getSmtpConfig();
  transporter = nodemailer.createTransport({
    host,
    port,
    secure,
    auth: { user, pass },
  });

  return transporter;
}

async function sendEmail({ to, subject, html, text, headers = {} }) {
  const client = getTransporter();
  if (!client) {
    if (!warnedMissingConfig) {
      console.warn('[email] Config SMTP ausente. Definí SMTP_HOST, SMTP_PORT, SMTP_USER y SMTP_PASS para habilitar envíos.');
      warnedMissingConfig = true;
    }
    return { skipped: true, reason: 'smtp-not-configured' };
  }

  const { from, replyTo } = getSmtpConfig();
  const result = await client.sendMail({
    from,
    replyTo,
    to,
    subject,
    text,
    html,
    headers,
  });

  return { skipped: false, messageId: result.messageId };
}

module.exports = {
  hasEmailConfig,
  sendEmail,
};
