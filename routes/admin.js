const express = require('express');
const { db, buildKickoffAtFromLocal, calculatePoints, serializeMatch } = require('../db/database');
const { adminMiddleware } = require('../middleware/auth');
const { getSyncStatus, syncWorldCupMatches } = require('../services/theSportsDbSync');

const router = express.Router();

// POST /api/admin/result - set match result and calculate points
router.post('/result', adminMiddleware, async (req, res) => {
  try {
    const { match_id, home_score, away_score, status } = req.body;
    if (match_id == null || home_score == null || away_score == null) {
      return res.status(400).json({ error: 'match_id, home_score y away_score requeridos' });
    }

    const match = await db.prepare('SELECT * FROM matches WHERE id = $1').get(match_id);
    if (!match) return res.status(404).json({ error: 'Partido no encontrado' });

    await db.prepare(`
      UPDATE matches SET home_score = $1, away_score = $2, status = $3 WHERE id = $4
    `).run(home_score, away_score, status || 'finished', match_id);

    // Recalculate points for all predictions on this match
    if (status === 'finished' || !status) {
      const predictions = await db.prepare('SELECT * FROM predictions WHERE match_id = $1').all(match_id);
      for (const pred of predictions) {
        const pts = calculatePoints(pred.home_score, pred.away_score, home_score, away_score);
        await db.prepare('UPDATE predictions SET points = $1 WHERE id = $2').run(pts, pred.id);
      }
    }

    res.json({ message: 'Resultado guardado y puntos actualizados ✅' });
  } catch (err) {
    console.error('Set result error:', err);
    res.status(500).json({ error: 'Error al guardar resultado' });
  }
});

// POST /api/admin/match - add a new match (knockout stages)
router.post('/match', adminMiddleware, async (req, res) => {
  try {
    const { match_number, stage, group_name, home_team, away_team, match_date, match_time, venue, city } = req.body;
    if (!match_number || !stage || !home_team || !away_team) {
      return res.status(400).json({ error: 'match_number, stage, home_team y away_team requeridos' });
    }
    const kickoffAt = buildKickoffAtFromLocal(match_date || null, match_time || null);
    
    await db.prepare(`
      INSERT INTO matches (match_number, stage, group_name, home_team, away_team, match_date, match_time, kickoff_at, venue, city)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
    `).run(match_number, stage, group_name || null, home_team, away_team, match_date || null, match_time || null, kickoffAt, venue || '', city || '');
    
    res.json({ message: 'Partido agregado ✅' });
  } catch (err) {
    console.error('Add match error:', err);
    if (err.message?.includes('UNIQUE')) {
      return res.status(400).json({ error: 'Número de partido ya existe' });
    }
    res.status(500).json({ error: 'Error al agregar partido' });
  }
});

// PUT /api/admin/match/:id - update match info
router.put('/match/:id', adminMiddleware, async (req, res) => {
  try {
    const { home_team, away_team, match_date, match_time, venue, city, status } = req.body;
    const kickoffAt = buildKickoffAtFromLocal(match_date || null, match_time || null);
    
    // Build UPDATE clause dynamically
    const updates = [];
    const values = [];
    let paramCount = 1;
    
    if (home_team) { updates.push(`home_team = $${paramCount}`); values.push(home_team); paramCount++; }
    if (away_team) { updates.push(`away_team = $${paramCount}`); values.push(away_team); paramCount++; }
    if (match_date) { updates.push(`match_date = $${paramCount}`); values.push(match_date); paramCount++; }
    if (match_time) { updates.push(`match_time = $${paramCount}`); values.push(match_time); paramCount++; }
    if (kickoffAt) { updates.push(`kickoff_at = $${paramCount}`); values.push(kickoffAt); paramCount++; }
    if (venue) { updates.push(`venue = $${paramCount}`); values.push(venue); paramCount++; }
    if (city) { updates.push(`city = $${paramCount}`); values.push(city); paramCount++; }
    if (status) { updates.push(`status = $${paramCount}`); values.push(status); paramCount++; }
    
    values.push(req.params.id);
    
    if (updates.length > 0) {
      const sql = `UPDATE matches SET ${updates.join(', ')} WHERE id = $${paramCount}`;
      await db.prepare(sql).run(...values);
    }
    
    res.json({ message: 'Partido actualizado ✅' });
  } catch (err) {
    console.error('Update match error:', err);
    res.status(500).json({ error: 'Error al actualizar partido' });
  }
});

// GET /api/admin/users - list all users
router.get('/users', adminMiddleware, async (req, res) => {
  try {
    const users = await db.prepare('SELECT id, username, email, is_admin, created_at FROM users ORDER BY created_at').all();
    res.json(users);
  } catch (err) {
    console.error('Get users error:', err);
    res.status(500).json({ error: 'Error al obtener usuarios' });
  }
});

// PUT /api/admin/users/:id - update user data (username, email)
router.put('/users/:id', adminMiddleware, async (req, res) => {
  try {
    const { username, email } = req.body;
    if (!username && !email) {
      return res.status(400).json({ error: 'Se requiere al menos username o email' });
    }

    const updates = [];
    const values = [];
    let paramCount = 1;

    if (username) { updates.push(`username = $${paramCount}`); values.push(username.trim()); paramCount++; }
    if (email) { updates.push(`email = $${paramCount}`); values.push(email.trim().toLowerCase()); paramCount++; }

    values.push(req.params.id);
    const sql = `UPDATE users SET ${updates.join(', ')} WHERE id = $${paramCount}`;
    const result = await db.prepare(sql).run(...values);

    if (result.changes === 0) return res.status(404).json({ error: 'Usuario no encontrado' });
    res.json({ message: 'Usuario actualizado ✅' });
  } catch (err) {
    console.error('Update user error:', err);
    if (err.message?.includes('unique') || err.code === '23505') {
      return res.status(400).json({ error: 'El username o email ya está en uso' });
    }
    res.status(500).json({ error: 'Error al actualizar usuario' });
  }
});

// PUT /api/admin/users/:id/admin - toggle admin
router.put('/users/:id/admin', adminMiddleware, async (req, res) => {
  try {
    const { is_admin } = req.body;
    await db.prepare('UPDATE users SET is_admin = $1 WHERE id = $2').run(is_admin ? 1 : 0, req.params.id);
    res.json({ message: 'Usuario actualizado' });
  } catch (err) {
    console.error('Toggle admin error:', err);
    res.status(500).json({ error: 'Error al actualizar usuario' });
  }
});

// GET /api/admin/matches - all matches for admin
router.get('/matches', adminMiddleware, async (req, res) => {
  try {
    const matches = await db.prepare('SELECT * FROM matches ORDER BY match_number').all();
    const serialized = matches.map((match) => serializeMatch(match));
    res.json(serialized);
  } catch (err) {
    console.error('Get admin matches error:', err);
    res.status(500).json({ error: 'Error al obtener partidos' });
  }
});

// GET /api/admin/sync/thesportsdb - current sync status
router.get('/sync/thesportsdb', adminMiddleware, async (req, res) => {
  try {
    res.json(getSyncStatus());
  } catch (err) {
    console.error('Get sync status error:', err);
    res.status(500).json({ error: 'Error al obtener estado de sincronización' });
  }
});

// POST /api/admin/sync/thesportsdb - force a sync now
router.post('/sync/thesportsdb', adminMiddleware, async (req, res) => {
  try {
    const result = await syncWorldCupMatches({ force: true, source: 'admin-route' });
    res.json(result);
  } catch (error) {
    console.error('Sync error:', error);
    res.status(502).json({ error: `No se pudo sincronizar con TheSportsDB: ${error.message}` });
  }
});

module.exports = router;

