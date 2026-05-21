const express = require('express');
const path = require('path');
const cors = require('cors');
const { startDailyWorldCupSync } = require('./services/theSportsDbSync');
const { startEmailNotificationScheduler } = require('./services/emailNotifications');

// Initialize database (runs on import)
require('./db/database');

const app = express();
const PORT = process.env.PORT || 3000;

// HTTPS redirect: el Classic LB de AWS añade X-Forwarded-Proto
app.use((req, res, next) => {
  if (req.headers['x-forwarded-proto'] === 'http') {
    return res.redirect(301, `https://${req.headers.host}${req.url}`);
  }
  next();
});

// Security headers
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'geolocation=(), microphone=(), camera=()');
  next();
});

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// API Routes
app.use('/api/auth', require('./routes/auth'));
app.use('/api/matches', require('./routes/matches'));
app.use('/api/predictions', require('./routes/predictions'));
app.use('/api/admin', require('./routes/admin'));
app.use('/api/leaderboard', require('./routes/leaderboard'));

// SPA fallback
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`⚽ Penca Mundial 2026 corriendo en http://localhost:${PORT}`);
  console.log(`📝 El primer usuario registrado será administrador`);
  startDailyWorldCupSync();
  startEmailNotificationScheduler();
});
