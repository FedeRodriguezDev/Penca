const express = require('express');
const { db } = require('../db/database');
const { authMiddleware } = require('../middleware/auth');

const router = express.Router();

// GET /api/leaderboard
router.get('/', async (req, res) => {
  try {
    const leaders = await db.prepare(`
      SELECT 
        u.id,
        u.username,
        COALESCE(SUM(p.points), 0) AS total_points,
        COUNT(p.id) AS predictions_made,
        SUM(CASE WHEN p.points = 3 THEN 1 ELSE 0 END) AS exact_scores,
        SUM(CASE WHEN p.points = 1 THEN 1 ELSE 0 END) AS correct_results,
        SUM(CASE WHEN p.points = 0 AND p.points IS NOT NULL THEN 1 ELSE 0 END) AS wrong
      FROM users u
      LEFT JOIN predictions p ON p.user_id = u.id
      GROUP BY u.id
      ORDER BY total_points DESC, exact_scores DESC, u.username ASC
    `).all();

    res.json(leaders);
  } catch (err) {
    console.error('Get leaderboard error:', err);
    res.status(500).json({ error: 'Error al obtener tabla de posiciones' });
  }
});

// GET /api/leaderboard/stats - general stats
router.get('/stats', async (req, res) => {
  try {
    const totalMatches = await db.prepare("SELECT COUNT(*) as cnt FROM matches").get();
    const finishedMatches = await db.prepare("SELECT COUNT(*) as cnt FROM matches WHERE status = 'finished'").get();
    const totalPredictions = await db.prepare("SELECT COUNT(*) as cnt FROM predictions").get();
    const exactScores = await db.prepare("SELECT COUNT(*) as cnt FROM predictions WHERE points = 3").get();

    res.json({
      totalMatches: totalMatches.cnt,
      finishedMatches: finishedMatches.cnt,
      totalPredictions: totalPredictions.cnt,
      exactScores: exactScores.cnt
    });
  } catch (err) {
    console.error('Get leaderboard stats error:', err);
    res.status(500).json({ error: 'Error al obtener estadísticas' });
  }
});

module.exports = router;

