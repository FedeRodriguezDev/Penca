const express = require('express');
const { db, serializeMatch } = require('../db/database');
const { authMiddleware } = require('../middleware/auth');

const router = express.Router();

// TBD patterns — matches with both teams unresolved are hidden from the frontend.
const TBD_PATTERNS = ['TBD', 'TBC', 'TBA', 'UNKNOWN', 'TO BE DETERMINED', 'TO BE CONFIRMED',
  'TO BE ANNOUNCED', 'N/A', '-', '--', 'A DETERMINAR'];

function isTeamTbd(name) {
  if (!name || !String(name).trim()) return true;
  return TBD_PATTERNS.includes(String(name).trim().toUpperCase());
}

function isMatchHidden(match) {
  return isTeamTbd(match.home_team) && isTeamTbd(match.away_team);
}

// GET /api/matches - all matches with user's predictions
router.get('', authMiddleware, async (req, res) => {
  try {
    const matches = await db.prepare(`
      SELECT m.*, 
        p.home_score AS pred_home, p.away_score AS pred_away, p.points AS pred_points
      FROM matches m
      LEFT JOIN predictions p ON p.match_id = m.id AND p.user_id = $1
      ORDER BY m.kickoff_at ASC NULLS LAST, m.match_number ASC
    `).all(req.user.id);
    
    const serialized = matches
      .filter((m) => !isMatchHidden(m))
      .map((match) => serializeMatch(match));
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
      ORDER BY m.kickoff_at ASC NULLS LAST, m.match_number ASC
    `).all(req.user.id);

    const grouped = {};
    for (const m of matches) {
      if (isMatchHidden(m)) continue;
      const key = m.group_name ? `Grupo ${m.group_name}` : m.stage;
      if (!grouped[key]) grouped[key] = [];
      grouped[key].push(serializeMatch(m));
    }
    // Sort groups: group stage first, then knockout stages in order
    const stageOrder = ['Fase de Grupos', 'Ronda de 32', 'Octavos de Final', 'Cuartos de Final', 'Semifinal', 'Tercer Puesto', 'Final'];
    const sorted = {};
    for (const stage of stageOrder) {
      for (const key of Object.keys(grouped)) {
        if (key === stage || key.startsWith('Grupo ')) {
          if (stage === 'Fase de Grupos' && key.startsWith('Grupo ')) {
            sorted[key] = grouped[key];
          } else if (key === stage) {
            sorted[key] = grouped[key];
          }
        }
      }
    }
    res.json(sorted);
  } catch (err) {
    console.error('Get matches grouped error:', err);
    res.status(500).json({ error: 'Error al obtener partidos agrupados' });
  }
});

module.exports = router;

