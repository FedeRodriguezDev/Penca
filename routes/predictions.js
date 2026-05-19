const express = require('express');
const { db, getEffectiveMatchStatus } = require('../db/database');
const { authMiddleware } = require('../middleware/auth');

const router = express.Router();

// POST /api/predictions - save or update a prediction
router.post('/', authMiddleware, async (req, res) => {
  try {
    const { match_id, home_score, away_score } = req.body;
    if (match_id == null || home_score == null || away_score == null) {
      return res.status(400).json({ error: 'match_id, home_score y away_score son requeridos' });
    }
    if (home_score < 0 || away_score < 0 || home_score > 30 || away_score > 30) {
      return res.status(400).json({ error: 'Marcador inválido' });
    }

    const match = await db.prepare('SELECT * FROM matches WHERE id = $1').get(match_id);
    if (!match) return res.status(404).json({ error: 'Partido no encontrado' });
    const effectiveStatus = getEffectiveMatchStatus(match);
    if (effectiveStatus !== 'upcoming') {
      return res.status(400).json({ error: 'El partido ya empezó, no se puede pronosticar' });
    }

    await db.prepare(`
      INSERT INTO predictions (user_id, match_id, home_score, away_score, updated_at)
      VALUES ($1, $2, $3, $4, CURRENT_TIMESTAMP)
      ON CONFLICT(user_id, match_id) DO UPDATE SET
        home_score = excluded.home_score,
        away_score = excluded.away_score,
        updated_at = CURRENT_TIMESTAMP
    `).run(req.user.id, match_id, home_score, away_score);

    res.json({ message: 'Pronóstico guardado ✅' });
  } catch (err) {
    console.error('Save prediction error:', err);
    res.status(500).json({ error: 'Error al guardar pronóstico' });
  }
});

// GET /api/predictions/mine - my predictions
router.get('/mine', authMiddleware, async (req, res) => {
  try {
    const preds = await db.prepare(`
      SELECT p.*, m.home_team, m.away_team, m.match_date, m.status, m.home_score AS real_home, m.away_score AS real_away
      FROM predictions p
      JOIN matches m ON m.id = p.match_id
      WHERE p.user_id = $1
      ORDER BY m.match_number
    `).all(req.user.id);
    res.json(preds);
  } catch (err) {
    console.error('Get predictions error:', err);
    res.status(500).json({ error: 'Error al obtener pronósticos' });
  }
});

module.exports = router;

