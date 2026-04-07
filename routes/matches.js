const express = require('express');
const { db } = require('../db/database');
const { authMiddleware } = require('../middleware/auth');

const router = express.Router();

// GET /api/matches - all matches with user's predictions
router.get('/', authMiddleware, (req, res) => {
  const matches = db.prepare(`
    SELECT m.*, 
      p.home_score AS pred_home, p.away_score AS pred_away, p.points AS pred_points
    FROM matches m
    LEFT JOIN predictions p ON p.match_id = m.id AND p.user_id = ?
    ORDER BY m.match_number ASC
  `).all(req.user.id);
  res.json(matches);
});

// GET /api/matches/groups - matches grouped by stage/group
router.get('/groups', authMiddleware, (req, res) => {
  const matches = db.prepare(`
    SELECT m.*, 
      p.home_score AS pred_home, p.away_score AS pred_away, p.points AS pred_points
    FROM matches m
    LEFT JOIN predictions p ON p.match_id = m.id AND p.user_id = ?
    ORDER BY m.match_number ASC
  `).all(req.user.id);

  const grouped = {};
  for (const m of matches) {
    const key = m.group_name ? `Grupo ${m.group_name}` : m.stage;
    if (!grouped[key]) grouped[key] = [];
    grouped[key].push(m);
  }
  res.json(grouped);
});

module.exports = router;
