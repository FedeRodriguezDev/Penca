const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { db } = require('../db/database');
const { JWT_SECRET } = require('../middleware/auth');

const router = express.Router();

// POST /api/auth/register
router.post('/register', async (req, res) => {
  const { username, email, password } = req.body;
  if (!username || !email || !password) {
    return res.status(400).json({ error: 'Todos los campos son requeridos' });
  }
  if (password.length < 6) {
    return res.status(400).json({ error: 'La contraseña debe tener al menos 6 caracteres' });
  }
  try {
    const hash = await bcrypt.hash(password, 10);
    // First user becomes admin
    const userCount = db.prepare('SELECT COUNT(*) as cnt FROM users').get();
    const isAdmin = userCount.cnt === 0 ? 1 : 0;
    const stmt = db.prepare('INSERT INTO users (username, email, password_hash, is_admin) VALUES (?, ?, ?, ?)');
    const result = stmt.run(username.trim(), email.toLowerCase().trim(), hash, isAdmin);
    const token = jwt.sign({ id: result.lastInsertRowid, username, is_admin: isAdmin === 1 }, JWT_SECRET, { expiresIn: '30d' });
    res.json({ token, username, is_admin: isAdmin === 1, message: isAdmin ? '¡Bienvenido! Eres el administrador.' : '¡Registro exitoso!' });
  } catch (err) {
    if (err.message.includes('UNIQUE')) {
      return res.status(400).json({ error: 'El usuario o email ya está registrado' });
    }
    res.status(500).json({ error: 'Error al registrar usuario' });
  }
});

// POST /api/auth/login
router.post('/login', async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) return res.status(400).json({ error: 'Email y contraseña requeridos' });
  const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email.toLowerCase().trim());
  if (!user) return res.status(401).json({ error: 'Credenciales inválidas' });
  const valid = await bcrypt.compare(password, user.password_hash);
  if (!valid) return res.status(401).json({ error: 'Credenciales inválidas' });
  const token = jwt.sign({ id: user.id, username: user.username, is_admin: user.is_admin === 1 }, JWT_SECRET, { expiresIn: '30d' });
  res.json({ token, username: user.username, is_admin: user.is_admin === 1 });
});

// GET /api/auth/me
router.get('/me', require('../middleware/auth').authMiddleware, (req, res) => {
  const user = db.prepare('SELECT id, username, email, is_admin, created_at FROM users WHERE id = ?').get(req.user.id);
  if (!user) return res.status(404).json({ error: 'Usuario no encontrado' });
  res.json(user);
});

module.exports = router;
