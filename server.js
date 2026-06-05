const express = require('express');
const path = require('path');
const cors = require('cors');
const { startDailyWorldCupSync } = require('./services/theSportsDbSync');
const { startEmailNotificationScheduler } = require('./services/emailNotifications');

// Initialize database (runs on import)
require('./db/database');

const app = express();
const PORT = process.env.PORT || 3000;

// Elastic Beanstalk sits behind a load balancer/reverse proxy, so trust the
// forwarded client IP when applying per-IP protections like auth rate limiting.
app.set('trust proxy', 1);

// Rate limiter for failed login attempts only.
// Track by client IP + target email to avoid blocking many users behind the
// same NAT/shared network while still slowing brute-force attempts.
const _rlMap = new Map();
const RL_WINDOW_MS = 15 * 60 * 1000; // 15 min
const RL_MAX = 200; // failed attempts per IP before blocking
function authRateLimiter(req, res, next) {
  // Only rate-limit POST /api/auth/login
  if (req.method !== 'POST' || !req.path.endsWith('/login')) return next();

  const ip = req.ip || req.socket?.remoteAddress || 'unknown';
  const email = typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase() : '';
  const limiterKey = `${ip}:${email || 'unknown-email'}`;
  const now = Date.now();
  const entry = _rlMap.get(limiterKey) || { count: 0, resetAt: now + RL_WINDOW_MS };
  if (now > entry.resetAt) { entry.count = 0; entry.resetAt = now + RL_WINDOW_MS; }

  // Block before even hitting the handler if already over the limit
  if (entry.count >= RL_MAX) {
    const minutesLeft = Math.ceil((entry.resetAt - now) / 60000);
    return res.status(429).json({ error: `Demasiados intentos fallidos. Intentá de nuevo en ${minutesLeft} minuto${minutesLeft !== 1 ? 's' : ''}.` });
  }

  // Intercept the response to count only failures (4xx)
  const originalJson = res.json.bind(res);
  res.json = function (body) {
    if (res.statusCode === 401) {
      entry.count++;
      _rlMap.set(limiterKey, entry);
    }
    return originalJson(body);
  };

  next();
}
// Clean up expired entries hourly to avoid memory leak
setInterval(() => { const now = Date.now(); for (const [ip, e] of _rlMap) { if (now > e.resetAt) _rlMap.delete(ip); } }, 60 * 60 * 1000).unref();

// Validate Host header to prevent open redirect
const ALLOWED_HOSTS = (process.env.ALLOWED_HOSTS || 'penca.infoclub.com.uy').split(',').map(h => h.trim());

// HTTPS redirect: el Classic LB de AWS añade X-Forwarded-Proto
app.use((req, res, next) => {
  if (req.headers['x-forwarded-proto'] === 'http') {
    const host = req.headers.host || '';
    if (!ALLOWED_HOSTS.some(h => host === h || host === `${h}:443`)) {
      return res.status(400).end();
    }
    return res.redirect(301, `https://${host}${req.url}`);
  }
  next();
});

// Security headers
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'geolocation=(), microphone=(), camera=()');
  res.setHeader('Content-Security-Policy', [
    "default-src 'self'",
    "script-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net",
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com https://cdn.jsdelivr.net",
    "font-src 'self' https://fonts.gstatic.com https://cdn.jsdelivr.net",
    "img-src 'self' https: data:",
    "connect-src 'self'",
    "frame-ancestors 'none'",
  ].join('; '));
  next();
});

const corsOptions = {
  origin: process.env.NODE_ENV === 'production'
    ? (process.env.ALLOWED_ORIGINS || 'https://penca.infoclub.com.uy').split(',').map(o => o.trim())
    : true,
  methods: ['GET', 'POST', 'PUT', 'DELETE'],
  allowedHeaders: ['Content-Type', 'Authorization'],
};
app.use(cors(corsOptions));
app.use(express.json({ limit: '50kb' }));
app.use(express.static(path.join(__dirname, 'public'), {
  setHeaders: (res, filePath) => {
    // HTML and JS must never be served from cache without revalidation.
    // Mobile browsers — especially PWAs in standalone mode — can otherwise
    // hold onto stale scripts indefinitely, breaking the app after deploys.
    if (/\.(html|js|css)$/i.test(filePath)) {
      res.setHeader('Cache-Control', 'no-cache, must-revalidate');
    }
  }
}));

// API Routes
app.use('/api/auth', authRateLimiter, require('./routes/auth'));
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
