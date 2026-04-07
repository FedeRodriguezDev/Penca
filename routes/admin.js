const express = require('express');
const { db, calculatePoints } = require('../db/database');
const { adminMiddleware } = require('../middleware/auth');

const router = express.Router();

// POST /api/admin/result - set match result and calculate points
router.post('/result', adminMiddleware, (req, res) => {
  const { match_id, home_score, away_score, status } = req.body;
  if (match_id == null || home_score == null || away_score == null) {
    return res.status(400).json({ error: 'match_id, home_score y away_score requeridos' });
  }

  const match = db.prepare('SELECT * FROM matches WHERE id = ?').get(match_id);
  if (!match) return res.status(404).json({ error: 'Partido no encontrado' });

  db.prepare(`
    UPDATE matches SET home_score = ?, away_score = ?, status = ? WHERE id = ?
  `).run(home_score, away_score, status || 'finished', match_id);

  // Recalculate points for all predictions on this match
  if (status === 'finished' || !status) {
    const predictions = db.prepare('SELECT * FROM predictions WHERE match_id = ?').all(match_id);
    const updatePts = db.prepare('UPDATE predictions SET points = ? WHERE id = ?');
    const updateAll = db.transaction(() => {
      for (const pred of predictions) {
        const pts = calculatePoints(pred.home_score, pred.away_score, home_score, away_score);
        updatePts.run(pts, pred.id);
      }
    });
    updateAll();
  }

  res.json({ message: 'Resultado guardado y puntos actualizados ✅' });
});

// POST /api/admin/match - add a new match (knockout stages)
router.post('/match', adminMiddleware, (req, res) => {
  const { match_number, stage, group_name, home_team, away_team, match_date, venue, city } = req.body;
  if (!match_number || !stage || !home_team || !away_team) {
    return res.status(400).json({ error: 'match_number, stage, home_team y away_team requeridos' });
  }
  try {
    db.prepare(`
      INSERT INTO matches (match_number, stage, group_name, home_team, away_team, match_date, venue, city)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(match_number, stage, group_name || null, home_team, away_team, match_date || null, venue || '', city || '');
    res.json({ message: 'Partido agregado ✅' });
  } catch (err) {
    if (err.message.includes('UNIQUE')) return res.status(400).json({ error: 'Número de partido ya existe' });
    res.status(500).json({ error: 'Error al agregar partido' });
  }
});

// PUT /api/admin/match/:id - update match info
router.put('/match/:id', adminMiddleware, (req, res) => {
  const { home_team, away_team, match_date, venue, city, status } = req.body;
  db.prepare(`
    UPDATE matches SET home_team = COALESCE(?, home_team), away_team = COALESCE(?, away_team),
    match_date = COALESCE(?, match_date), venue = COALESCE(?, venue), city = COALESCE(?, city),
    status = COALESCE(?, status) WHERE id = ?
  `).run(home_team, away_team, match_date, venue, city, status, req.params.id);
  res.json({ message: 'Partido actualizado ✅' });
});

// GET /api/admin/users - list all users
router.get('/users', adminMiddleware, (req, res) => {
  const users = db.prepare('SELECT id, username, email, is_admin, created_at FROM users ORDER BY created_at').all();
  res.json(users);
});

// PUT /api/admin/users/:id/admin - toggle admin
router.put('/users/:id/admin', adminMiddleware, (req, res) => {
  const { is_admin } = req.body;
  db.prepare('UPDATE users SET is_admin = ? WHERE id = ?').run(is_admin ? 1 : 0, req.params.id);
  res.json({ message: 'Usuario actualizado' });
});

// GET /api/admin/matches - all matches for admin
router.get('/matches', adminMiddleware, (req, res) => {
  const matches = db.prepare('SELECT * FROM matches ORDER BY match_number').all();
  res.json(matches);
});

module.exports = router;
