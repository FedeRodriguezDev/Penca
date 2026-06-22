const crypto = require('crypto');
const { db } = require('../db/database');
const { sendEmail } = require('./emailService');
const {
  buildPasswordResetEmail,
  buildReminderEmail,
  buildResultEmail,
  buildVerificationEmail,
} = require('./emailTemplates');

const APP_BASE_URL = process.env.APP_BASE_URL || 'http://localhost:3000';
const EMAIL_VERIFICATION_TTL_HOURS = Number(process.env.EMAIL_VERIFICATION_TTL_HOURS || 24);
const PASSWORD_RESET_TTL_HOURS = Number(process.env.PASSWORD_RESET_TTL_HOURS || 2);
const EMAIL_REMINDER_LEAD_MINUTES = Number(process.env.EMAIL_REMINDER_LEAD_MINUTES || 120);
const EMAIL_NOTIFICATION_CHECK_MS = Number(process.env.EMAIL_NOTIFICATION_CHECK_MS || 5 * 60 * 1000);

function createVerificationToken() {
  return crypto.randomBytes(32).toString('hex');
}

function getVerificationExpiryDate() {
  return new Date(Date.now() + EMAIL_VERIFICATION_TTL_HOURS * 60 * 60 * 1000);
}

function getPasswordResetExpiryDate() {
  return new Date(Date.now() + PASSWORD_RESET_TTL_HOURS * 60 * 60 * 1000);
}

async function getOrCreateUnsubscribeToken(userId) {
  const row = await db.prepare('SELECT unsubscribe_token FROM users WHERE id = $1').get(userId);
  if (row?.unsubscribe_token) return row.unsubscribe_token;

  const token = crypto.randomBytes(32).toString('hex');
  await db.prepare('UPDATE users SET unsubscribe_token = $1 WHERE id = $2').run(token, userId);
  return token;
}

async function sendVerificationEmail({ userId, username, email }) {
  const token = createVerificationToken();
  const expiresAt = getVerificationExpiryDate().toISOString();

  await db.prepare(`
    UPDATE users
    SET email_verification_token = $1,
        email_verification_expires_at = $2,
        email_verification_sent_at = CURRENT_TIMESTAMP
    WHERE id = $3
  `).run(token, expiresAt, userId);

  const verifyUrl = `${APP_BASE_URL}/api/auth/verify-email?token=${encodeURIComponent(token)}`;
  const content = buildVerificationEmail({ username, verifyUrl });

  return sendEmail({
    to: email,
    subject: content.subject,
    html: content.html,
    text: content.text,
    headers: {
      'X-Email-Type': 'verification',
    },
  });
}

async function sendPasswordResetEmail({ userId, username, email }) {
  const token = createVerificationToken();
  const expiresAt = getPasswordResetExpiryDate().toISOString();

  await db.prepare(`
    UPDATE users
    SET password_reset_token = $1,
        password_reset_expires_at = $2
    WHERE id = $3
  `).run(token, expiresAt, userId);

  const resetUrl = `${APP_BASE_URL}/?reset_token=${encodeURIComponent(token)}`;
  const content = buildPasswordResetEmail({ username, resetUrl });

  return sendEmail({
    to: email,
    subject: content.subject,
    html: content.html,
    text: content.text,
    headers: {
      'X-Email-Type': 'password-reset',
    },
  });
}

async function sendReminderNotifications() {
  const nowIso = new Date().toISOString();
  const upperIso = new Date(Date.now() + EMAIL_REMINDER_LEAD_MINUTES * 60 * 1000).toISOString();

  const pending = await db.prepare(`
    SELECT
      u.id AS user_id,
      u.username,
      u.email,
      m.id AS match_id,
      m.home_team,
      m.away_team,
      m.kickoff_at
    FROM users u
    JOIN matches m ON 1 = 1
    LEFT JOIN predictions p ON p.user_id = u.id AND p.match_id = m.id
    LEFT JOIN email_notifications_log enl
      ON enl.user_id = u.id AND enl.match_id = m.id AND enl.notification_type = 'match_reminder'
    WHERE COALESCE(u.email_verified, false) = true
      AND COALESCE(u.notify_match_reminders, true) = true
      AND COALESCE(m.status, 'upcoming') = 'upcoming'
      AND m.kickoff_at IS NOT NULL
      AND m.kickoff_at > $1
      AND m.kickoff_at <= $2
      AND p.id IS NULL
      AND enl.id IS NULL
    ORDER BY m.kickoff_at ASC
  `).all(nowIso, upperIso);

  let sent = 0;

  for (const row of pending) {
    try {
      const unsubscribeToken = await getOrCreateUnsubscribeToken(row.user_id);
      const unsubscribeUrl = `${APP_BASE_URL}/api/auth/unsubscribe?token=${encodeURIComponent(unsubscribeToken)}`;
      const content = buildReminderEmail({
        username: row.username,
        match: row,
        leadMinutes: EMAIL_REMINDER_LEAD_MINUTES,
        appUrl: APP_BASE_URL,
        unsubscribeUrl,
      });

      const result = await sendEmail({
        to: row.email,
        subject: content.subject,
        html: content.html,
        text: content.text,
        headers: {
          'X-Email-Type': 'match-reminder',
        },
      });

      if (!result.skipped) {
        await db.prepare(`
          INSERT INTO email_notifications_log (user_id, match_id, notification_type)
          VALUES ($1, $2, 'match_reminder')
        `).run(row.user_id, row.match_id);
        sent += 1;
      }
    } catch (error) {
      console.error('[email] Error enviando recordatorio:', error.message);
    }
  }

  return sent;
}

async function sendResultNotifications() {
  const rows = await db.prepare(`
    SELECT
      u.id AS user_id,
      u.username,
      u.email,
      m.id AS match_id,
      m.home_team,
      m.away_team,
      m.home_score AS real_home,
      m.away_score AS real_away,
      p.home_score AS pred_home,
      p.away_score AS pred_away,
      p.points
    FROM predictions p
    JOIN users u ON u.id = p.user_id
    JOIN matches m ON m.id = p.match_id
    LEFT JOIN email_notifications_log enl
      ON enl.user_id = u.id AND enl.match_id = m.id AND enl.notification_type = 'match_result'
    WHERE COALESCE(u.email_verified, false) = true
      AND COALESCE(u.notify_prediction_results, true) = true
      AND COALESCE(m.status, 'upcoming') = 'finished'
      AND m.home_score IS NOT NULL
      AND m.away_score IS NOT NULL
      AND p.points IS NOT NULL
      AND enl.id IS NULL
    ORDER BY m.match_number ASC
  `).all();

  let sent = 0;

  for (const row of rows) {
    try {
      const unsubscribeToken = await getOrCreateUnsubscribeToken(row.user_id);
      const unsubscribeUrl = `${APP_BASE_URL}/api/auth/unsubscribe?token=${encodeURIComponent(unsubscribeToken)}`;
      const content = buildResultEmail({ username: row.username, prediction: row, unsubscribeUrl });
      const result = await sendEmail({
        to: row.email,
        subject: content.subject,
        html: content.html,
        text: content.text,
        headers: {
          'X-Email-Type': 'match-result',
        },
      });

      if (!result.skipped) {
        await db.prepare(`
          INSERT INTO email_notifications_log (user_id, match_id, notification_type)
          VALUES ($1, $2, 'match_result')
        `).run(row.user_id, row.match_id);
        sent += 1;
      }
    } catch (error) {
      console.error('[email] Error enviando resultado:', error.message);
    }
  }

  return sent;
}

async function runEmailNotificationCycle() {
  const [remindersSent, resultsSent] = await Promise.all([
    sendReminderNotifications(),
    sendResultNotifications(),
  ]);

  if (remindersSent || resultsSent) {
    console.log(`[email] Notificaciones enviadas: recordatorios=${remindersSent}, resultados=${resultsSent}`);
  }
}

function startEmailNotificationScheduler() {
  const run = async () => {
    try {
      await runEmailNotificationCycle();
    } catch (error) {
      console.error('[email] Fallo en ciclo de notificaciones:', error.message);
    }
  };

  run();
  const timer = setInterval(run, EMAIL_NOTIFICATION_CHECK_MS);
  if (typeof timer.unref === 'function') timer.unref();
  return timer;
}

module.exports = {
  EMAIL_VERIFICATION_TTL_HOURS,
  createVerificationToken,
  sendPasswordResetEmail,
  sendVerificationEmail,
  startEmailNotificationScheduler,
};
