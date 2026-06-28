const { Pool } = require('pg');

const UTC_MINUS_3_OFFSET_MS = -3 * 60 * 60 * 1000;
const dbHost = process.env.DB_HOST || 'localhost';
const dbSslSetting = (process.env.DB_SSL || '').trim().toLowerCase();
const shouldUseSsl = dbSslSetting
  ? ['1', 'true', 'require'].includes(dbSslSetting)
  : !['localhost', '127.0.0.1'].includes(dbHost);

// Configurar conexión a PostgreSQL desde variables de entorno
const pool = new Pool({
  host: dbHost,
  port: process.env.DB_PORT || 5432,
  database: process.env.DB_NAME || 'penca_db',
  user: process.env.DB_USER || 'penca_admin',
  password: process.env.DB_PASSWORD || 'password',
  ssl: shouldUseSsl ? { rejectUnauthorized: false } : false,
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 2000,
});

pool.on('error', (err) => {
  console.error('❌ Error inesperado en pool de conexiones:', err);
});

// Wrapper simple para compatibilidad con interfaz SQLite (sincrónico→asincrónico)
const db = {
  prepare: (sql) => ({
    run: async (...params) => {
      try {
        const result = await pool.query(sql, params);
        return {
          changes: result.rowCount,
          lastID: result.rows[0]?.id,
          rows: result.rows
        };
      } catch (err) {
        console.error('❌ Error en query:', sql, params, err);
        throw err;
      }
    },
    get: async (...params) => {
      try {
        const result = await pool.query(sql, params);
        return result.rows[0] || null;
      } catch (err) {
        console.error('❌ Error en query:', sql, params, err);
        throw err;
      }
    },
    all: async (...params) => {
      try {
        const result = await pool.query(sql, params);
        return result.rows || [];
      } catch (err) {
        console.error('❌ Error en query:', sql, params, err);
        throw err;
      }
    },
  }),
  exec: async (sql) => {
    try {
      const statements = sql.split(';').filter(s => s.trim());
      for (const stmt of statements) {
        if (stmt.trim()) {
          await pool.query(stmt);
        }
      }
    } catch (err) {
      console.error('❌ Error en exec:', err);
      throw err;
    }
  },
};

// Inicializar tablas y schema
async function initializeDatabase() {
  try {
    console.log('🔧 Inicializando schema de PostgreSQL...');

    await pool.query(`
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        username TEXT UNIQUE NOT NULL,
        email TEXT UNIQUE NOT NULL,
        password_hash TEXT NOT NULL,
        email_verified BOOLEAN DEFAULT FALSE,
        email_verification_token TEXT,
        email_verification_expires_at TEXT,
        password_reset_token TEXT,
        password_reset_expires_at TEXT,
        email_verification_sent_at TIMESTAMP,
        notify_match_reminders BOOLEAN DEFAULT TRUE,
        notify_prediction_results BOOLEAN DEFAULT TRUE,
        unsubscribe_token TEXT UNIQUE,
        is_admin INTEGER DEFAULT 0,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS matches (
        id SERIAL PRIMARY KEY,
        match_number INTEGER UNIQUE NOT NULL,
        stage TEXT NOT NULL,
        group_name TEXT,
        home_team TEXT NOT NULL,
        away_team TEXT NOT NULL,
        home_flag TEXT DEFAULT '',
        away_flag TEXT DEFAULT '',
        match_date TEXT,
        match_time TEXT,
        kickoff_at TEXT,
        venue TEXT,
        city TEXT,
        home_score INTEGER,
        away_score INTEGER,
        external_event_id TEXT,
        status TEXT DEFAULT 'upcoming'
      );

      CREATE TABLE IF NOT EXISTS predictions (
        id SERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        match_id INTEGER NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
        home_score INTEGER NOT NULL,
        away_score INTEGER NOT NULL,
        points INTEGER,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(user_id, match_id)
      );

      CREATE TABLE IF NOT EXISTS app_metadata (
        key TEXT PRIMARY KEY,
        value TEXT,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS email_notifications_log (
        id SERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        match_id INTEGER NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
        notification_type TEXT NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(user_id, match_id, notification_type)
      );

      CREATE UNIQUE INDEX IF NOT EXISTS idx_matches_external_event_id 
        ON matches(external_event_id) WHERE external_event_id IS NOT NULL;

      CREATE INDEX IF NOT EXISTS idx_email_notifications_log_lookup
        ON email_notifications_log(user_id, match_id, notification_type);
    `);

    // Backward compatible migrations for pre-existing databases.
    await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS email_verified BOOLEAN DEFAULT FALSE`);
    await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS email_verification_token TEXT`);
    await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS email_verification_expires_at TEXT`);
    await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS password_reset_token TEXT`);
    await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS password_reset_expires_at TEXT`);
    await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS email_verification_sent_at TIMESTAMP`);
    await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS notify_match_reminders BOOLEAN DEFAULT TRUE`);
    await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS notify_prediction_results BOOLEAN DEFAULT TRUE`);
    await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS unsubscribe_token TEXT`);
    await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS phone_number TEXT`);
    await pool.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1
          FROM pg_indexes
          WHERE schemaname = 'public' AND indexname = 'idx_users_phone_number_unique'
        ) THEN
          BEGIN
            CREATE UNIQUE INDEX idx_users_phone_number_unique
              ON users(phone_number)
              WHERE phone_number IS NOT NULL;
          EXCEPTION WHEN unique_violation THEN
            RAISE NOTICE 'No se pudo crear índice único de phone_number por duplicados históricos';
          END;
        END IF;
      END
      $$;
    `);

    console.log('✅ Schema creado correctamente');

    const matchCount = await pool.query('SELECT COUNT(*) as cnt FROM matches');
    if (parseInt(matchCount.rows[0].cnt) === 0) {
      console.log('📥 Cargando 72 partidos iniciales...');
      const seedMatches = [
        { match_number: 1,  stage: 'Fase de Grupos', group_name: 'A', home_team: 'México',      away_team: 'Sudáfrica',      match_date: '2026-06-11', venue: 'Estadio Ciudad de México',          city: 'Ciudad de México' },
        { match_number: 2,  stage: 'Fase de Grupos', group_name: 'A', home_team: 'Corea del Sur',     away_team: 'República Checa',      match_date: '2026-06-11', venue: 'Rose Bowl',               city: 'Los Ángeles' },
        { match_number: 3,  stage: 'Fase de Grupos', group_name: 'A', home_team: 'República Checa',      away_team: 'Sudáfrica',      match_date: '2026-06-18', venue: 'Estadio Azteca',          city: 'Ciudad de México' },
        { match_number: 4,  stage: 'Fase de Grupos', group_name: 'A', home_team: 'México',     away_team: 'Corea del Sur',      match_date: '2026-06-18', venue: 'AT&T Stadium',            city: 'Dallas' },
        { match_number: 5,  stage: 'Fase de Grupos', group_name: 'A', home_team: 'República Checa',      away_team: 'México',      match_date: '2026-06-24', venue: 'Estadio Azteca',          city: 'Ciudad de México' },
        { match_number: 6,  stage: 'Fase de Grupos', group_name: 'A', home_team: 'Sudáfrica',     away_team: 'Corea del Sur',      match_date: '2026-06-24', venue: 'SoFi Stadium',            city: 'Los Ángeles' },
        { match_number: 7,  stage: 'Fase de Grupos', group_name: 'B', home_team: 'Canadá',      away_team: 'Bosnia y Herzegovina',    match_date: '2026-06-11', venue: 'MetLife Stadium',         city: 'Nueva York' },
        { match_number: 8,  stage: 'Fase de Grupos', group_name: 'B', home_team: 'Brasil',      away_team: 'Croacia',      match_date: '2026-06-12', venue: 'SoFi Stadium',            city: 'Los Ángeles' },
        { match_number: 9,  stage: 'Fase de Grupos', group_name: 'B', home_team: 'España',      away_team: 'Croacia',      match_date: '2026-06-16', venue: 'Gillette Stadium',        city: 'Boston' },
        { match_number: 10, stage: 'Fase de Grupos', group_name: 'B', home_team: 'Brasil',      away_team: 'Marruecos',    match_date: '2026-06-16', venue: 'MetLife Stadium',         city: 'Nueva York' },
        { match_number: 11, stage: 'Fase de Grupos', group_name: 'B', home_team: 'España',      away_team: 'Brasil',       match_date: '2026-06-20', venue: 'SoFi Stadium',            city: 'Los Ángeles' },
        { match_number: 12, stage: 'Fase de Grupos', group_name: 'B', home_team: 'Croacia',     away_team: 'Marruecos',    match_date: '2026-06-20', venue: 'Lumen Field',             city: 'Seattle' },
        { match_number: 13, stage: 'Fase de Grupos', group_name: 'C', home_team: 'Argentina',   away_team: 'Países Bajos', match_date: '2026-06-12', venue: 'MetLife Stadium',         city: 'Nueva York' },
        { match_number: 14, stage: 'Fase de Grupos', group_name: 'C', home_team: 'Perú',        away_team: 'Arabia Saudita',match_date: '2026-06-12', venue: 'Estadio Akron',          city: 'Guadalajara' },
        { match_number: 15, stage: 'Fase de Grupos', group_name: 'C', home_team: 'Argentina',   away_team: 'Arabia Saudita',match_date: '2026-06-16', venue: 'AT&T Stadium',           city: 'Dallas' },
        { match_number: 16, stage: 'Fase de Grupos', group_name: 'C', home_team: 'Países Bajos',away_team: 'Perú',         match_date: '2026-06-17', venue: 'Estadio BBVA',           city: 'Monterrey' },
        { match_number: 17, stage: 'Fase de Grupos', group_name: 'C', home_team: 'Argentina',   away_team: 'Perú',         match_date: '2026-06-21', venue: 'Hard Rock Stadium',       city: 'Miami' },
        { match_number: 18, stage: 'Fase de Grupos', group_name: 'C', home_team: 'Países Bajos',away_team: 'Arabia Saudita',match_date: '2026-06-21', venue: 'Estadio Akron',          city: 'Guadalajara' },
        { match_number: 19, stage: 'Fase de Grupos', group_name: 'D', home_team: 'Francia',     away_team: 'Polonia',      match_date: '2026-06-12', venue: 'Lumen Field',             city: 'Seattle' },
        { match_number: 20, stage: 'Fase de Grupos', group_name: 'D', home_team: 'Alemania',    away_team: 'Venezuela',    match_date: '2026-06-13', venue: 'Geodis Park',             city: 'Nashville' },
        { match_number: 21, stage: 'Fase de Grupos', group_name: 'D', home_team: 'Francia',     away_team: 'Venezuela',    match_date: '2026-06-17', venue: 'Lincoln Financial Field', city: 'Filadelfia' },
        { match_number: 22, stage: 'Fase de Grupos', group_name: 'D', home_team: 'Alemania',    away_team: 'Polonia',      match_date: '2026-06-17', venue: 'BC Place',               city: 'Vancouver' },
        { match_number: 23, stage: 'Fase de Grupos', group_name: 'D', home_team: 'Francia',     away_team: 'Alemania',     match_date: '2026-06-21', venue: 'MetLife Stadium',         city: 'Nueva York' },
        { match_number: 24, stage: 'Fase de Grupos', group_name: 'D', home_team: 'Polonia',     away_team: 'Venezuela',    match_date: '2026-06-21', venue: 'Estadio BBVA',           city: 'Monterrey' },
        { match_number: 25, stage: 'Fase de Grupos', group_name: 'E', home_team: 'Portugal',    away_team: 'Congo',        match_date: '2026-06-13', venue: 'Arrowhead Stadium',       city: 'Kansas City' },
        { match_number: 26, stage: 'Fase de Grupos', group_name: 'E', home_team: 'Turquía',     away_team: 'Panamá',       match_date: '2026-06-13', venue: 'Camping World Stadium',   city: 'Orlando' },
        { match_number: 27, stage: 'Fase de Grupos', group_name: 'E', home_team: 'Portugal',    away_team: 'Panamá',       match_date: '2026-06-17', venue: 'Empower Field',          city: 'Denver' },
        { match_number: 28, stage: 'Fase de Grupos', group_name: 'E', home_team: 'Turquía',     away_team: 'Congo',        match_date: '2026-06-17', venue: 'Allegiant Stadium',       city: 'Las Vegas' },
        { match_number: 29, stage: 'Fase de Grupos', group_name: 'E', home_team: 'Portugal',    away_team: 'Turquía',      match_date: '2026-06-21', venue: 'Arrowhead Stadium',       city: 'Kansas City' },
        { match_number: 30, stage: 'Fase de Grupos', group_name: 'E', home_team: 'Congo',       away_team: 'Panamá',       match_date: '2026-06-21', venue: 'Camping World Stadium',   city: 'Orlando' },
        { match_number: 31, stage: 'Fase de Grupos', group_name: 'F', home_team: 'Bélgica',     away_team: 'Italia',       match_date: '2026-06-13', venue: 'Estadio Azteca',          city: 'Ciudad de México' },
        { match_number: 32, stage: 'Fase de Grupos', group_name: 'F', home_team: 'Australia',   away_team: 'Rep. Checa',   match_date: '2026-06-13', venue: 'BC Place',               city: 'Vancouver' },
        { match_number: 33, stage: 'Fase de Grupos', group_name: 'F', home_team: 'Bélgica',     away_team: 'Rep. Checa',   match_date: '2026-06-17', venue: 'Hard Rock Stadium',       city: 'Miami' },
        { match_number: 34, stage: 'Fase de Grupos', group_name: 'F', home_team: 'Italia',      away_team: 'Australia',    match_date: '2026-06-18', venue: 'Lumen Field',             city: 'Seattle' },
        { match_number: 35, stage: 'Fase de Grupos', group_name: 'F', home_team: 'Bélgica',     away_team: 'Australia',    match_date: '2026-06-22', venue: 'SoFi Stadium',            city: 'Los Ángeles' },
        { match_number: 36, stage: 'Fase de Grupos', group_name: 'F', home_team: 'Italia',      away_team: 'Rep. Checa',   match_date: '2026-06-22', venue: 'MetLife Stadium',         city: 'Nueva York' },
        { match_number: 37, stage: 'Fase de Grupos', group_name: 'G', home_team: 'EE. UU.',     away_team: 'Canadá',       match_date: '2026-06-14', venue: 'Arrowhead Stadium',       city: 'Kansas City' },
        { match_number: 38, stage: 'Fase de Grupos', group_name: 'G', home_team: 'Honduras',    away_team: 'Serbia',       match_date: '2026-06-14', venue: 'AT&T Stadium',            city: 'Dallas' },
        { match_number: 39, stage: 'Fase de Grupos', group_name: 'G', home_team: 'EE. UU.',     away_team: 'Serbia',       match_date: '2026-06-18', venue: 'SoFi Stadium',            city: 'Los Ángeles' },
        { match_number: 40, stage: 'Fase de Grupos', group_name: 'G', home_team: 'Canadá',      away_team: 'Honduras',     match_date: '2026-06-18', venue: 'BC Place',               city: 'Vancouver' },
        { match_number: 41, stage: 'Fase de Grupos', group_name: 'G', home_team: 'EE. UU.',     away_team: 'Honduras',     match_date: '2026-06-22', venue: 'Empower Field',          city: 'Denver' },
        { match_number: 42, stage: 'Fase de Grupos', group_name: 'G', home_team: 'Canadá',      away_team: 'Serbia',       match_date: '2026-06-22', venue: 'Gillette Stadium',        city: 'Boston' },
        { match_number: 43, stage: 'Fase de Grupos', group_name: 'H', home_team: 'Senegal',     away_team: 'Nueva Zelanda',match_date: '2026-06-14', venue: 'Geodis Park',             city: 'Nashville' },
        { match_number: 44, stage: 'Fase de Grupos', group_name: 'H', home_team: 'Ucrania',     away_team: 'Eslovaquia',   match_date: '2026-06-14', venue: 'Camping World Stadium',   city: 'Orlando' },
        { match_number: 45, stage: 'Fase de Grupos', group_name: 'H', home_team: 'Senegal',     away_team: 'Eslovaquia',   match_date: '2026-06-18', venue: 'Allegiant Stadium',       city: 'Las Vegas' },
        { match_number: 46, stage: 'Fase de Grupos', group_name: 'H', home_team: 'Ucrania',     away_team: 'Nueva Zelanda',match_date: '2026-06-19', venue: 'Lincoln Financial Field', city: 'Filadelfia' },
        { match_number: 47, stage: 'Fase de Grupos', group_name: 'H', home_team: 'Senegal',     away_team: 'Ucrania',      match_date: '2026-06-23', venue: 'Estadio Akron',          city: 'Guadalajara' },
        { match_number: 48, stage: 'Fase de Grupos', group_name: 'H', home_team: 'Nueva Zelanda',away_team: 'Eslovaquia',  match_date: '2026-06-23', venue: 'Estadio BBVA',           city: 'Monterrey' },
        { match_number: 49, stage: 'Fase de Grupos', group_name: 'I', home_team: 'Japón',       away_team: 'Colombia',     match_date: '2026-06-14', venue: 'Estadio Akron',          city: 'Guadalajara' },
        { match_number: 50, stage: 'Fase de Grupos', group_name: 'I', home_team: 'Costa Rica',  away_team: 'Camerún',      match_date: '2026-06-14', venue: 'Estadio BBVA',           city: 'Monterrey' },
        { match_number: 51, stage: 'Fase de Grupos', group_name: 'I', home_team: 'Japón',       away_team: 'Camerún',      match_date: '2026-06-18', venue: 'Estadio Azteca',          city: 'Ciudad de México' },
        { match_number: 52, stage: 'Fase de Grupos', group_name: 'I', home_team: 'Colombia',    away_team: 'Costa Rica',   match_date: '2026-06-19', venue: 'AT&T Stadium',            city: 'Dallas' },
        { match_number: 53, stage: 'Fase de Grupos', group_name: 'I', home_team: 'Japón',       away_team: 'Costa Rica',   match_date: '2026-06-23', venue: 'Rose Bowl',               city: 'Los Ángeles' },
        { match_number: 54, stage: 'Fase de Grupos', group_name: 'I', home_team: 'Colombia',    away_team: 'Camerún',      match_date: '2026-06-23', venue: 'Hard Rock Stadium',       city: 'Miami' },
        { match_number: 55, stage: 'Fase de Grupos', group_name: 'J', home_team: 'Corea del Sur',away_team: 'Ghana',       match_date: '2026-06-15', venue: 'SoFi Stadium',            city: 'Los Ángeles' },
        { match_number: 56, stage: 'Fase de Grupos', group_name: 'J', home_team: 'Dinamarca',   away_team: 'Argelia',      match_date: '2026-06-15', venue: 'Arrowhead Stadium',       city: 'Kansas City' },
        { match_number: 57, stage: 'Fase de Grupos', group_name: 'J', home_team: 'Corea del Sur',away_team: 'Argelia',     match_date: '2026-06-19', venue: 'Lumen Field',             city: 'Seattle' },
        { match_number: 58, stage: 'Fase de Grupos', group_name: 'J', home_team: 'Dinamarca',   away_team: 'Ghana',        match_date: '2026-06-19', venue: 'BC Place',               city: 'Vancouver' },
        { match_number: 59, stage: 'Fase de Grupos', group_name: 'J', home_team: 'Corea del Sur',away_team: 'Dinamarca',   match_date: '2026-06-23', venue: 'Geodis Park',             city: 'Nashville' },
        { match_number: 60, stage: 'Fase de Grupos', group_name: 'J', home_team: 'Ghana',       away_team: 'Argelia',      match_date: '2026-06-23', venue: 'Empower Field',          city: 'Denver' },
        { match_number: 61, stage: 'Fase de Grupos', group_name: 'K', home_team: 'Nigeria',     away_team: 'Qatar',        match_date: '2026-06-15', venue: 'Hard Rock Stadium',       city: 'Miami' },
        { match_number: 62, stage: 'Fase de Grupos', group_name: 'K', home_team: 'Suecia',      away_team: 'Eslovenia',    match_date: '2026-06-16', venue: 'Allegiant Stadium',       city: 'Las Vegas' },
        { match_number: 63, stage: 'Fase de Grupos', group_name: 'K', home_team: 'Nigeria',     away_team: 'Eslovenia',    match_date: '2026-06-20', venue: 'Camping World Stadium',   city: 'Orlando' },
        { match_number: 64, stage: 'Fase de Grupos', group_name: 'K', home_team: 'Suecia',      away_team: 'Qatar',        match_date: '2026-06-20', venue: 'Lincoln Financial Field', city: 'Filadelfia' },
        { match_number: 65, stage: 'Fase de Grupos', group_name: 'K', home_team: 'Nigeria',     away_team: 'Suecia',       match_date: '2026-06-24', venue: 'MetLife Stadium',         city: 'Nueva York' },
        { match_number: 66, stage: 'Fase de Grupos', group_name: 'K', home_team: 'Qatar',       away_team: 'Eslovenia',    match_date: '2026-06-24', venue: 'AT&T Stadium',            city: 'Dallas' },
        { match_number: 67, stage: 'Fase de Grupos', group_name: 'L', home_team: 'Inglaterra',  away_team: 'Costa de Marfil',match_date: '2026-06-15', venue: 'Estadio BBVA',         city: 'Monterrey' },
        { match_number: 68, stage: 'Fase de Grupos', group_name: 'L', home_team: 'México',      away_team: 'Hungría',      match_date: '2026-06-16', venue: 'Rose Bowl',               city: 'Los Ángeles' },
        { match_number: 69, stage: 'Fase de Grupos', group_name: 'L', home_team: 'Inglaterra',  away_team: 'Hungría',      match_date: '2026-06-20', venue: 'Gillette Stadium',        city: 'Boston' },
        { match_number: 70, stage: 'Fase de Grupos', group_name: 'L', home_team: 'México',      away_team: 'Costa de Marfil',match_date: '2026-06-20', venue: 'Arrowhead Stadium',     city: 'Kansas City' },
        { match_number: 71, stage: 'Fase de Grupos', group_name: 'L', home_team: 'Inglaterra',  away_team: 'México',       match_date: '2026-06-24', venue: 'Estadio Azteca',          city: 'Ciudad de México' },
        { match_number: 72, stage: 'Fase de Grupos', group_name: 'L', home_team: 'Costa de Marfil',away_team: 'Hungría',  match_date: '2026-06-24', venue: 'Estadio Akron',          city: 'Guadalajara' },
      ];

      for (const match of seedMatches) {
        await pool.query(
          `INSERT INTO matches (match_number, stage, group_name, home_team, away_team, match_date, venue, city)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
          [match.match_number, match.stage, match.group_name, match.home_team, match.away_team, match.match_date, match.venue, match.city]
        );
      }
      console.log('✅ Partidos cargados correctamente');
    }

    // Seed knockout placeholder matches if they don't exist yet.
    await ensureKnockoutPlaceholders();
  } catch (err) {
    console.error('❌ Error inicializando database:', err);
    throw err;
  }
}

// ──────────────────────────────────────────
// Knockout placeholder matches
// ──────────────────────────────────────────
// TheSportsDB does not return knockout-stage events via bulk API endpoints
// (events have no strRound assigned).  We pre-seed them with official FIFA
// dates and UTC times so the phases appear in the frontend.
// When TheSportsDB eventually publishes them, the sync updates teams & details
// by matching external_event_id.
//
// Times are in UTC.  match_time (display) is converted to UTC-3 on write.

function utcToUtcMinus3(utcDateStr, utcTimeStr) {
  if (!utcDateStr || !utcTimeStr) return { date: utcDateStr, time: utcTimeStr };
  const d = new Date(`${utcDateStr}T${utcTimeStr}Z`);
  if (isNaN(d.getTime())) return { date: utcDateStr, time: utcTimeStr };
  return {
    date: d.toLocaleDateString('en-CA', { timeZone: 'America/Montevideo' }),
    time: d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit', timeZone: 'America/Montevideo' }),
  };
}

function buildKickoffUtc(date, time) {
  if (!date || !time) return null;
  return `${date}T${time}:00Z`;
}
const KNOCKOUT_PLACEHOLDERS = [
  // Ronda de 32 (matches 73-88): June 28 – July 3
  // Matches with confirmed teams (from TheSportsDB as of June 27).
  { num: 73,  stage: 'Ronda de 32',       date: '2026-06-28', time: '19:00', home: 'Sudáfrica',       away: 'Canadá',               extId: '2499618', badgeH: 'https://r2.thesportsdb.com/images/media/team/badge/xjz9j91553368824.png', badgeA: 'https://r2.thesportsdb.com/images/media/team/badge/2t631f1595154867.png' },
  { num: 74,  stage: 'Ronda de 32',       date: '2026-06-29', time: '17:00', home: 'Brasil',          away: 'Japón',                extId: '2499835', badgeH: 'https://r2.thesportsdb.com/images/media/team/badge/jl6dip1726167280.png', badgeA: 'https://r2.thesportsdb.com/images/media/team/badge/ffsyxz1591989843.png' },
  { num: 75,  stage: 'Ronda de 32',       date: '2026-06-29', time: '20:30', home: 'Alemania',        away: 'Paraguay',             extId: '2502846', badgeH: 'https://r2.thesportsdb.com/images/media/team/badge/1xysi51726167152.png', badgeA: 'https://r2.thesportsdb.com/images/media/team/badge/khgav41553419195.png' },
  { num: 76,  stage: 'Ronda de 32',       date: '2026-06-30', time: '01:00', home: 'Países Bajos',    away: 'Marruecos',            extId: '2499836', badgeH: 'https://r2.thesportsdb.com/images/media/team/badge/1p0hr41593787110.png', badgeA: 'https://r2.thesportsdb.com/images/media/team/badge/hbmwkj1731791275.png' },
  { num: 77,  stage: 'Ronda de 32',       date: '2026-06-30', time: '17:00', home: 'Costa de Marfil', away: 'Noruega',              extId: '2502605', badgeH: 'https://r2.thesportsdb.com/images/media/team/badge/rwxuuu1455465643.png', badgeA: 'https://r2.thesportsdb.com/images/media/team/badge/gyfn811591973155.png' },
  { num: 78,  stage: 'Ronda de 32',       date: '2026-06-30', time: '21:00', home: 'Francia',         away: 'Suecia',               extId: '2502847', badgeH: 'https://r2.thesportsdb.com/images/media/team/badge/p3n0z51726166851.png', badgeA: 'https://r2.thesportsdb.com/images/media/team/badge/h5adzg1591981772.png' },
  { num: 79,  stage: 'Ronda de 32',       date: '2026-07-02', time: '00:00', home: 'Estados Unidos',  away: 'Bosnia y Herzegovina', extId: '2499837', badgeH: 'https://r2.thesportsdb.com/images/media/team/badge/21f0oi1597948195.png', badgeA: 'https://r2.thesportsdb.com/images/media/team/badge/wtqqst1455463120.png' },
  // Still TBD — will be updated by sync when TheSportsDB publishes teams.
  { num: 80,  stage: 'Ronda de 32',       date: '2026-06-30', time: '20:00' },
  { num: 81,  stage: 'Ronda de 32',       date: '2026-07-01', time: '15:00' },
  { num: 82,  stage: 'Ronda de 32',       date: '2026-07-01', time: '17:00' },
  { num: 83,  stage: 'Ronda de 32',       date: '2026-07-01', time: '20:00' },
  { num: 84,  stage: 'Ronda de 32',       date: '2026-07-02', time: '15:00' },
  { num: 85,  stage: 'Ronda de 32',       date: '2026-07-02', time: '17:00' },
  { num: 86,  stage: 'Ronda de 32',       date: '2026-07-02', time: '20:00' },
  { num: 87,  stage: 'Ronda de 32',       date: '2026-07-03', time: '15:00' },
  { num: 88,  stage: 'Ronda de 32',       date: '2026-07-03', time: '19:00' },
  // Octavos de Final (matches 89-96): July 4-8
  { num: 89,  stage: 'Octavos de Final',  date: '2026-07-04', time: '15:00' },
  { num: 90,  stage: 'Octavos de Final',  date: '2026-07-04', time: '19:00' },
  { num: 91,  stage: 'Octavos de Final',  date: '2026-07-05', time: '15:00' },
  { num: 92,  stage: 'Octavos de Final',  date: '2026-07-05', time: '19:00' },
  { num: 93,  stage: 'Octavos de Final',  date: '2026-07-06', time: '15:00' },
  { num: 94,  stage: 'Octavos de Final',  date: '2026-07-06', time: '19:00' },
  { num: 95,  stage: 'Octavos de Final',  date: '2026-07-07', time: '15:00' },
  { num: 96,  stage: 'Octavos de Final',  date: '2026-07-07', time: '19:00' },
  // Cuartos de Final (matches 97-100): July 9-12
  { num: 97,  stage: 'Cuartos de Final',  date: '2026-07-09', time: '16:00' },
  { num: 98,  stage: 'Cuartos de Final',  date: '2026-07-10', time: '16:00' },
  { num: 99,  stage: 'Cuartos de Final',  date: '2026-07-11', time: '16:00' },
  { num: 100, stage: 'Cuartos de Final',  date: '2026-07-11', time: '20:00' },
  // Semifinal (matches 101-102): July 14-15
  { num: 101, stage: 'Semifinal',         date: '2026-07-14', time: '20:00' },
  { num: 102, stage: 'Semifinal',         date: '2026-07-15', time: '20:00' },
  // Tercer Puesto (match 103): July 18
  { num: 103, stage: 'Tercer Puesto',     date: '2026-07-18', time: '16:00' },
  // Final (match 104): July 19
  { num: 104, stage: 'Final',             date: '2026-07-19', time: '16:00' },
];

async function ensureKnockoutPlaceholders() {
  console.log('🔧 Verificando partidos de eliminatoria...');

  let created = 0;
  let patched = 0;

  for (const m of KNOCKOUT_PLACEHOLDERS) {
    try {
    // Times are in UTC. Build kickoff_at as ISO UTC, match_time as UTC-3 display.
    const kickoffAt = buildKickoffUtc(m.date, m.time);
    const display = utcToUtcMinus3(m.date, m.time);
    const home = m.home || 'A determinar';
    const away = m.away || 'A determinar';
    const badgeH = m.badgeH || '';
    const badgeA = m.badgeA || '';

    // Try insert; if it already exists, patch missing fields.
    const result = await pool.query(
      `INSERT INTO matches (match_number, stage, home_team, away_team, home_flag, away_flag,
         match_date, match_time, kickoff_at, venue, city, external_event_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
       ON CONFLICT (match_number) DO NOTHING
       RETURNING id`,
      [m.num, m.stage, home, away, badgeH, badgeA, display.date, display.time, kickoffAt, '', '', m.extId || null]
    );

    if (result.rows.length > 0) {
      created++;
      continue;
    }

    // Match already exists — only patch if it still has placeholder teams.
    // Never overwrite a match that already has real teams, because users may
    // have already placed predictions on it.
    const current = await pool.query(
      `SELECT home_team, away_team, external_event_id FROM matches WHERE match_number = $1`,
      [m.num]
    );
    const row = current.rows[0];
    if (!row) continue;

    const isPlaceholder =
      row.home_team === 'A determinar' && row.away_team === 'A determinar';

    if (!isPlaceholder) {
      // Slot occupied.  If we have confirmed data for this match (matching by
      // external_event_id OR by team names), fix times and badges in place.
      if (!m.home || m.home === 'A determinar' || !m.extId) continue;

      const sameExtId = row.external_event_id === m.extId;
      const sameTeams = row.home_team === m.home && row.away_team === m.away;

      if (sameExtId || sameTeams) {
        // Same match — update times (UTC→UTC-3) and badges.
        const kickoffAt = buildKickoffUtc(m.date, m.time);
        const display = utcToUtcMinus3(m.date, m.time);
        const setClauses = [];
        const vals = [];
        let pi = 1;
        if (kickoffAt) { setClauses.push(`kickoff_at = $${pi}`); vals.push(kickoffAt); pi++; }
        if (display.date) { setClauses.push(`match_date = $${pi}`); vals.push(display.date); pi++; }
        if (display.time) { setClauses.push(`match_time = $${pi}`); vals.push(display.time); pi++; }
        if (m.badgeH) { setClauses.push(`home_flag = $${pi}`); vals.push(m.badgeH); pi++; }
        if (m.badgeA) { setClauses.push(`away_flag = $${pi}`); vals.push(m.badgeA); pi++; }
        if (setClauses.length > 0) {
          vals.push(m.num);
          await pool.query(`UPDATE matches SET ${setClauses.join(', ')} WHERE match_number = $${pi}`, vals);
          patched++;
        }
        continue;
      }

      // Different match at this slot — try relocation to a free placeholder.
      {

        // Find a free placeholder slot in the same stage
        const freeSlot = await pool.query(
          `SELECT match_number FROM matches
           WHERE stage = $1 AND home_team = 'A determinar' AND away_team = 'A determinar'
           ORDER BY match_number ASC LIMIT 1`,
          [m.stage]
        );
        if (freeSlot.rows.length > 0) {
          const newNum = freeSlot.rows[0].match_number;
          const kickoffAt = buildKickoffUtc(m.date, m.time);
          const display = utcToUtcMinus3(m.date, m.time);
          await pool.query(
            `UPDATE matches SET home_team=$1, away_team=$2, home_flag=$3, away_flag=$4,
              match_date=$5, match_time=$6, kickoff_at=$7, external_event_id=$8, stage=$9
             WHERE match_number=$10`,
            [m.home, m.away, m.badgeH||'', m.badgeA||'', display.date, display.time, kickoffAt, m.extId, m.stage, newNum]
          );
          patched++;
          console.log(`  ↳ ${m.home} vs ${m.away} reubicado de #${m.num} a #${newNum}`);
        }
      }
      continue;
    }

    // It's a pure placeholder — safe to update.
    const updates = [];
    const values = [];
    let p = 1;

    if (m.home && m.home !== 'A determinar') {
      updates.push(`home_team = $${p}`);
      values.push(m.home); p++;
    }
    if (m.away && m.away !== 'A determinar') {
      updates.push(`away_team = $${p}`);
      values.push(m.away); p++;
    }
    if (m.badgeH) {
      updates.push(`home_flag = $${p}`);
      values.push(m.badgeH); p++;
    }
    if (m.badgeA) {
      updates.push(`away_flag = $${p}`);
      values.push(m.badgeA); p++;
    }
    if (m.extId) {
      updates.push(`external_event_id = $${p}`);
      values.push(m.extId); p++;
    }
    updates.push(`stage = $${p}`);
    values.push(m.stage); p++;

    if (updates.length > 0) {
      values.push(m.num);
      await pool.query(
        `UPDATE matches SET ${updates.join(', ')} WHERE match_number = $${p}`,
        values
      );
      patched++;
    }
    } catch (err) {
      // Individual placeholder failure shouldn't crash the whole server.
      if (err.code === '23505') {
        console.warn(`  ⚠️  Placeholder #${m.num} omitido (conflicto de unique key)`);
      } else {
        console.error(`  ❌ Error en placeholder #${m.num}:`, err.message);
      }
    }
  }

  if (created || patched) {
    console.log(`✅ Eliminatoria: ${created} nuevos, ${patched} actualizados`);
  } else {
    console.log('✅ Eliminatoria: todo al día');
  }
}

// Inicializar
initializeDatabase().catch((err) => {
  console.error('❌ Fallo inicialización:', err);
  process.exit(1);
});

// Utility: calcular puntos
function calculatePoints(predHome, predAway, realHome, realAway) {
  if (predHome === realHome && predAway === realAway) return 3;
  const predResult = Math.sign(predHome - predAway);
  const realResult = Math.sign(realHome - realAway);
  if (predResult === realResult) return 1;
  return 0;
}

function normalizeMatchTime(matchTime) {
  if (!matchTime) return null;
  const value = String(matchTime).trim();
  if (/^\d{2}:\d{2}$/.test(value)) return `${value}:00`;
  if (/^\d{2}:\d{2}:\d{2}$/.test(value)) return value;
  return null;
}

function normalizeKickoffAt(kickoffAt) {
  if (!kickoffAt) return null;
  const normalizedInput = typeof kickoffAt === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/.test(kickoffAt.trim())
    ? `${kickoffAt.trim()}Z`
    : kickoffAt;
  const kickoff = kickoffAt instanceof Date ? kickoffAt : new Date(normalizedInput);
  return Number.isNaN(kickoff.getTime()) ? null : kickoff.toISOString();
}

function getUtcMinus3DateParts(kickoffAt) {
  const normalizedKickoffAt = normalizeKickoffAt(kickoffAt);
  if (!normalizedKickoffAt) return null;

  const shifted = new Date(new Date(normalizedKickoffAt).getTime() + UTC_MINUS_3_OFFSET_MS);
  const year = shifted.getUTCFullYear();
  const month = String(shifted.getUTCMonth() + 1).padStart(2, '0');
  const day = String(shifted.getUTCDate()).padStart(2, '0');
  const hours = String(shifted.getUTCHours()).padStart(2, '0');
  const minutes = String(shifted.getUTCMinutes()).padStart(2, '0');
  const seconds = String(shifted.getUTCSeconds()).padStart(2, '0');

  return {
    match_date: `${year}-${month}-${day}`,
    match_time: `${hours}:${minutes}:${seconds}`,
  };
}

function buildKickoffAtFromLocal(matchDate, matchTime) {
  if (!matchDate || !matchTime) return null;
  const normalizedTime = normalizeMatchTime(matchTime);
  if (!normalizedTime) return null;

  const [year, month, day] = matchDate.split('-').map(Number);
  const [hours, minutes, seconds] = normalizedTime.split(':').map(Number);
  if ([year, month, day, hours, minutes, seconds].some(Number.isNaN)) return null;

  const utcMillis = Date.UTC(year, month - 1, day, hours + 3, minutes, seconds);
  return normalizeKickoffAt(new Date(utcMillis));
}

function getMatchKickoff(match) {
  const normalizedKickoffAt = normalizeKickoffAt(match?.kickoff_at);
  if (normalizedKickoffAt) {
    return new Date(normalizedKickoffAt);
  }

  if (!match?.match_date || !match?.match_time) return null;
  const rebuiltKickoffAt = buildKickoffAtFromLocal(match.match_date, match.match_time);
  return rebuiltKickoffAt ? new Date(rebuiltKickoffAt) : null;
}

function getEffectiveMatchStatus(match, now = new Date()) {
  if (!match) return 'upcoming';
  if (match.status === 'finished') return 'finished';
  if (match.status === 'live') return 'live';

  const kickoff = getMatchKickoff(match);
  if (kickoff && now.getTime() >= kickoff.getTime()) {
    return 'live';
  }

  return 'upcoming';
}

function serializeMatch(match, now = new Date()) {
  const kickoff = getMatchKickoff(match);
  const status = getEffectiveMatchStatus(match, now);

  return {
    ...match,
    status,
    can_predict: status === 'upcoming',
    kickoff_at: kickoff ? kickoff.toISOString() : normalizeKickoffAt(match?.kickoff_at),
  };
}

module.exports = {
  db,
  buildKickoffAtFromLocal,
  calculatePoints,
  getUtcMinus3DateParts,
  getMatchKickoff,
  getEffectiveMatchStatus,
  normalizeKickoffAt,
  normalizeMatchTime,
  serializeMatch,
};

// Utility: calculate points from prediction vs result
function calculatePoints(predHome, predAway, realHome, realAway) {
  if (predHome === realHome && predAway === realAway) return 3;
  const predResult = Math.sign(predHome - predAway);
  const realResult = Math.sign(realHome - realAway);
  if (predResult === realResult) return 1;
  return 0;
}

function normalizeMatchTime(matchTime) {
  if (!matchTime) return null;
  const value = String(matchTime).trim();
  if (/^\d{2}:\d{2}$/.test(value)) return `${value}:00`;
  if (/^\d{2}:\d{2}:\d{2}$/.test(value)) return value;
  return null;
}

function normalizeKickoffAt(kickoffAt) {
  if (!kickoffAt) return null;
  const normalizedInput = typeof kickoffAt === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/.test(kickoffAt.trim())
    ? `${kickoffAt.trim()}Z`
    : kickoffAt;
  const kickoff = kickoffAt instanceof Date ? kickoffAt : new Date(normalizedInput);
  return Number.isNaN(kickoff.getTime()) ? null : kickoff.toISOString();
}

function getUtcMinus3DateParts(kickoffAt) {
  const normalizedKickoffAt = normalizeKickoffAt(kickoffAt);
  if (!normalizedKickoffAt) return null;

  const shifted = new Date(new Date(normalizedKickoffAt).getTime() + UTC_MINUS_3_OFFSET_MS);
  const year = shifted.getUTCFullYear();
  const month = String(shifted.getUTCMonth() + 1).padStart(2, '0');
  const day = String(shifted.getUTCDate()).padStart(2, '0');
  const hours = String(shifted.getUTCHours()).padStart(2, '0');
  const minutes = String(shifted.getUTCMinutes()).padStart(2, '0');
  const seconds = String(shifted.getUTCSeconds()).padStart(2, '0');

  return {
    match_date: `${year}-${month}-${day}`,
    match_time: `${hours}:${minutes}:${seconds}`,
  };
}

function buildKickoffAtFromLocal(matchDate, matchTime) {
  if (!matchDate || !matchTime) return null;
  const normalizedTime = normalizeMatchTime(matchTime);
  if (!normalizedTime) return null;

  const [year, month, day] = matchDate.split('-').map(Number);
  const [hours, minutes, seconds] = normalizedTime.split(':').map(Number);
  if ([year, month, day, hours, minutes, seconds].some(Number.isNaN)) return null;

  const utcMillis = Date.UTC(year, month - 1, day, hours + 3, minutes, seconds);
  return normalizeKickoffAt(new Date(utcMillis));
}

function getMatchKickoff(match) {
  const normalizedKickoffAt = normalizeKickoffAt(match?.kickoff_at);
  if (normalizedKickoffAt) {
    return new Date(normalizedKickoffAt);
  }

  if (!match?.match_date || !match?.match_time) return null;
  const rebuiltKickoffAt = buildKickoffAtFromLocal(match.match_date, match.match_time);
  return rebuiltKickoffAt ? new Date(rebuiltKickoffAt) : null;
}

function getEffectiveMatchStatus(match, now = new Date()) {
  if (!match) return 'upcoming';
  if (match.status === 'finished') return 'finished';
  if (match.status === 'live') return 'live';

  const kickoff = getMatchKickoff(match);
  if (kickoff && now.getTime() >= kickoff.getTime()) {
    return 'live';
  }

  return 'upcoming';
}

function serializeMatch(match, now = new Date()) {
  const kickoff = getMatchKickoff(match);
  const status = getEffectiveMatchStatus(match, now);

  return {
    ...match,
    status,
    can_predict: status === 'upcoming',
    kickoff_at: kickoff ? kickoff.toISOString() : normalizeKickoffAt(match?.kickoff_at),
  };
}

module.exports = {
  db,
  buildKickoffAtFromLocal,
  calculatePoints,
  getUtcMinus3DateParts,
  getMatchKickoff,
  getEffectiveMatchStatus,
  normalizeKickoffAt,
  normalizeMatchTime,
  serializeMatch,
};
