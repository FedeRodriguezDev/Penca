const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { db } = require('../db/database');
const { JWT_SECRET } = require('../middleware/auth');
const { sendVerificationEmail } = require('../services/emailNotifications');
const { buildVerificationResultPage } = require('../services/emailTemplates');

const router = express.Router();

// POST /api/auth/register
router.post('/register', async (req, res) => {
  try {
    const { username, email, password } = req.body;
    if (!username || !email || !password) {
      return res.status(400).json({ error: 'Todos los campos son requeridos' });
    }
    const cleanEmail = email.toLowerCase().trim();
    if (!/^\S+@\S+\.\S+$/.test(cleanEmail)) {
      return res.status(400).json({ error: 'Email inválido' });
    }
    if (password.length < 6) {
      return res.status(400).json({ error: 'La contraseña debe tener al menos 6 caracteres' });
    }

    const hash = await bcrypt.hash(password, 10);
    // First user becomes admin
    const userCount = await db.prepare('SELECT COUNT(*) as cnt FROM users').get();
    const isAdmin = userCount.cnt === 0 ? 1 : 0;
    
    const result = await db.prepare(
      'INSERT INTO users (username, email, password_hash, email_verified, is_admin) VALUES ($1, $2, $3, $4, $5) RETURNING id'
    ).run(username.trim(), cleanEmail, hash, false, isAdmin);
    
    const userId = result.rows?.[0]?.id || result.lastID;

    await sendVerificationEmail({
      userId,
      username: username.trim(),
      email: cleanEmail,
    });
    
    res.status(201).json({
      username: username.trim(),
      is_admin: isAdmin === 1,
      requires_email_verification: true,
      message: 'Te enviamos un correo para verificar tu cuenta. Revisá tu bandeja de entrada.'
    });
  } catch (err) {
    console.error('Register error:', err);
    if (err.message?.includes('UNIQUE') || err.code === '23505') {
      return res.status(400).json({ error: 'El usuario o email ya está registrado' });
    }
    res.status(500).json({ error: 'Error al registrar usuario' });
  }
});

// POST /api/auth/login
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      return res.status(400).json({ error: 'Email y contraseña requeridos' });
    }

    const user = await db.prepare('SELECT * FROM users WHERE email = $1').get(email.toLowerCase().trim());
    if (!user) {
      return res.status(401).json({ error: 'Credenciales inválidas' });
    }

    if (!user.email_verified) {
      return res.status(403).json({
        error: 'Tu email aún no está verificado. Revisá tu bandeja y confirmá tu cuenta.',
        code: 'EMAIL_NOT_VERIFIED',
      });
    }

    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) {
      return res.status(401).json({ error: 'Credenciales inválidas' });
    }

    const token = jwt.sign(
      { id: user.id, username: user.username, is_admin: user.is_admin === 1 },
      JWT_SECRET,
      { expiresIn: '30d' }
    );
    
    res.json({ token, username: user.username, is_admin: user.is_admin === 1 });
  } catch (err) {
    console.error('Login error:', err);
    res.status(500).json({ error: 'Error en login' });
  }
});

// GET /api/auth/me
router.get('/me', require('../middleware/auth').authMiddleware, async (req, res) => {
  try {
    const user = await db.prepare(
      'SELECT id, username, email, email_verified, is_admin, created_at FROM users WHERE id = $1'
    ).get(req.user.id);
    
    if (!user) {
      return res.status(404).json({ error: 'Usuario no encontrado' });
    }
    res.json(user);
  } catch (err) {
    console.error('Get me error:', err);
    res.status(500).json({ error: 'Error al obtener usuario' });
  }
});

// GET /api/auth/verify-email?token=...
router.get('/verify-email', async (req, res) => {
  try {
    const token = String(req.query.token || '').trim();
    if (!token) {
      return res.status(400).send(buildVerificationResultPage({
        success: false,
        message: 'Falta el token de verificación.',
      }));
    }

    const user = await db.prepare(`
      SELECT id, email_verification_expires_at, email_verified
      FROM users
      WHERE email_verification_token = $1
    `).get(token);

    if (!user) {
      return res.status(400).send(buildVerificationResultPage({
        success: false,
        message: 'El enlace no es válido o ya fue utilizado.',
      }));
    }

    if (user.email_verified) {
      return res.send(buildVerificationResultPage({
        success: true,
        message: 'Tu correo ya estaba verificado. Ya podés ingresar a la plataforma.',
      }));
    }

    const expiresAt = new Date(user.email_verification_expires_at || '');
    if (Number.isNaN(expiresAt.getTime()) || Date.now() > expiresAt.getTime()) {
      return res.status(400).send(buildVerificationResultPage({
        success: false,
        message: 'El enlace de verificación expiró. Solicitá un nuevo correo desde el login.',
      }));
    }

    await db.prepare(`
      UPDATE users
      SET email_verified = true,
          email_verification_token = NULL,
          email_verification_expires_at = NULL
      WHERE id = $1
    `).run(user.id);

    return res.send(buildVerificationResultPage({
      success: true,
      message: 'Tu email fue verificado correctamente. Ya podés iniciar sesión.',
    }));
  } catch (err) {
    console.error('Verify email error:', err);
    return res.status(500).send(buildVerificationResultPage({
      success: false,
      message: 'No se pudo completar la verificación. Intentá nuevamente en unos minutos.',
    }));
  }
});

// POST /api/auth/resend-verification
router.post('/resend-verification', async (req, res) => {
  try {
    const email = String(req.body?.email || '').toLowerCase().trim();
    if (!email) {
      return res.status(400).json({ error: 'Email requerido' });
    }

    const user = await db.prepare('SELECT id, username, email, email_verified FROM users WHERE email = $1').get(email);
    if (user && !user.email_verified) {
      await sendVerificationEmail({
        userId: user.id,
        username: user.username,
        email: user.email,
      });
    }

    return res.json({
      message: 'Si existe una cuenta pendiente de verificación, te enviamos un nuevo correo.',
    });
  } catch (err) {
    console.error('Resend verification error:', err);
    return res.status(500).json({ error: 'No se pudo reenviar el correo de verificación' });
  }
});

module.exports = router;

