const express = require('express');
const { db, serializeMatch } = require('../db/database');
const { authMiddleware } = require('../middleware/auth');

const router = express.Router();

// GET /api/matches - all matches with user's predictions
router.get('', authMiddleware, async (req, res) => {
  try {
    const matches = await db.prepare(`
      SELECT m.*, 
        p.home_score AS pred_home, p.away_score AS pred_away, p.points AS pred_points
      FROM matches m
      LEFT JOIN predictions p ON p.match_id = m.id AND p.user_id = $1
      ORDER BY m.match_number ASC
    `).all(req.user.id);
    
    const serialized = matches.map((match) => serializeMatch(match));
    res.json(serialized);
  } catch (err) {
    console.error('Get matches error:', err);
    res.status(500).json({ error: 'Error al obtener partidos' });
  }
});

// GET /api/matches/groups - matches grouped by stage/group
router.get('/groups', authMiddleware, async (req, res) => {
  try {
    const matches = await db.prepare(`
      SELECT m.*, 
        p.home_score AS pred_home, p.away_score AS pred_away, p.points AS pred_points
      FROM matches m
      LEFT JOIN predictions p ON p.match_id = m.id AND p.user_id = $1
      ORDER BY m.match_number ASC
    `).all(req.user.id);

    const grouped = {};
    for (const m of matches) {
      const key = m.group_name ? `Grupo ${m.group_name}` : m.stage;
      if (!grouped[key]) grouped[key] = [];
      grouped[key].push(serializeMatch(m));
    }
    res.json(grouped);
  } catch (err) {
    console.error('Get matches grouped error:', err);
    res.status(500).json({ error: 'Error al obtener partidos agrupados' });
  }
});

module.exports = router;

