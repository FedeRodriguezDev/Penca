const express = require('express');
const { db } = require('../db/database');
const { authMiddleware } = require('../middleware/auth');

const router = express.Router();

// POST /api/predictions - save or update a prediction
router.post('/', authMiddleware, (req, res) => {
  const { match_id, home_score, away_score } = req.body;
  if (match_id == null || home_score == null || away_score == null) {
    return res.status(400).json({ error: 'match_id, home_score y away_score son requeridos' });
  }
  if (home_score < 0 || away_score < 0 || home_score > 30 || away_score > 30) {
    return res.status(400).json({ error: 'Marcador inválido' });
  }

  const match = db.prepare('SELECT * FROM matches WHERE id = ?').get(match_id);
  if (!match) return res.status(404).json({ error: 'Partido no encontrado' });
  if (match.status === 'finished') {
    return res.status(400).json({ error: 'El partido ya terminó, no se puede pronosticar' });
  }

  try {
    db.prepare(`
      INSERT INTO predictions (user_id, match_id, home_score, away_score, updated_at)
      VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)
      ON CONFLICT(user_id, match_id) DO UPDATE SET
        home_score = excluded.home_score,
        away_score = excluded.away_score,
        updated_at = CURRENT_TIMESTAMP
    `).run(req.user.id, match_id, home_score, away_score);

    res.json({ message: 'Pronóstico guardado ✅' });
  } catch (err) {
    res.status(500).json({ error: 'Error al guardar pronóstico' });
  }
});

// GET /api/predictions/mine - my predictions
router.get('/mine', authMiddleware, (req, res) => {
  const preds = db.prepare(`
    SELECT p.*, m.home_team, m.away_team, m.match_date, m.status, m.home_score AS real_home, m.away_score AS real_away
    FROM predictions p
    JOIN matches m ON m.id = p.match_id
    WHERE p.user_id = ?
    ORDER BY m.match_number
  `).all(req.user.id);
  res.json(preds);
});

module.exports = router;
