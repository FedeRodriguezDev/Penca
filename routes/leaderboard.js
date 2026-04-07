const express = require('express');
const { db } = require('../db/database');
const { authMiddleware } = require('../middleware/auth');

const router = express.Router();

// GET /api/leaderboard
router.get('/', authMiddleware, (req, res) => {
  const leaders = db.prepare(`
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
});

// GET /api/leaderboard/stats - general stats
router.get('/stats', authMiddleware, (req, res) => {
  const totalMatches = db.prepare("SELECT COUNT(*) as cnt FROM matches").get().cnt;
  const finishedMatches = db.prepare("SELECT COUNT(*) as cnt FROM matches WHERE status = 'finished'").get().cnt;
  const totalPredictions = db.prepare("SELECT COUNT(*) as cnt FROM predictions").get().cnt;
  const exactScores = db.prepare("SELECT COUNT(*) as cnt FROM predictions WHERE points = 3").get().cnt;

  res.json({ totalMatches, finishedMatches, totalPredictions, exactScores });
});

module.exports = router;
