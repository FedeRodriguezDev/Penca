const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

const DB_DIR = path.join(__dirname, '..', 'data');
if (!fs.existsSync(DB_DIR)) fs.mkdirSync(DB_DIR, { recursive: true });

const db = new Database(path.join(DB_DIR, 'penca.db'));

db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL,
    email TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    is_admin INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS matches (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    match_number INTEGER UNIQUE NOT NULL,
    stage TEXT NOT NULL,
    group_name TEXT,
    home_team TEXT NOT NULL,
    away_team TEXT NOT NULL,
    home_flag TEXT DEFAULT '',
    away_flag TEXT DEFAULT '',
    match_date TEXT,
    venue TEXT,
    city TEXT,
    home_score INTEGER,
    away_score INTEGER,
    status TEXT DEFAULT 'upcoming'
  );

  CREATE TABLE IF NOT EXISTS predictions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    match_id INTEGER NOT NULL,
    home_score INTEGER NOT NULL,
    away_score INTEGER NOT NULL,
    points INTEGER,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (match_id) REFERENCES matches(id) ON DELETE CASCADE,
    UNIQUE(user_id, match_id)
  );
`);

// Seed group stage matches if not already loaded
const matchCount = db.prepare('SELECT COUNT(*) as cnt FROM matches').get();
if (matchCount.cnt === 0) {
  const seedMatches = [
    // GRUPO A
    { match_number: 1,  stage: 'Fase de Grupos', group_name: 'A', home_team: 'México',      away_team: 'Sudáfrica',      match_date: '2026-06-11', venue: 'Estadio Azteca',          city: 'Ciudad de México' },
    { match_number: 2,  stage: 'Fase de Grupos', group_name: 'A', home_team: 'Corea del Sur',     away_team: 'República Checa',      match_date: '2026-06-11', venue: 'Rose Bowl',               city: 'Los Ángeles' },
    { match_number: 3,  stage: 'Fase de Grupos', group_name: 'A', home_team: 'República Checa',      away_team: 'Sudáfrica',      match_date: '2026-06-18', venue: 'Estadio Azteca',          city: 'Ciudad de México' },
    { match_number: 4,  stage: 'Fase de Grupos', group_name: 'A', home_team: 'México',     away_team: 'Corea del Sur',      match_date: '2026-06-18', venue: 'AT&T Stadium',            city: 'Dallas' },
    { match_number: 5,  stage: 'Fase de Grupos', group_name: 'A', home_team: 'República Checa',      away_team: 'México',      match_date: '2026-06-24', venue: 'Estadio Azteca',          city: 'Ciudad de México' },
    { match_number: 6,  stage: 'Fase de Grupos', group_name: 'A', home_team: 'Sudáfrica',     away_team: 'Corea del Sur',      match_date: '2026-06-24', venue: 'SoFi Stadium',            city: 'Los Ángeles' },
    // GRUPO B
    { match_number: 7,  stage: 'Fase de Grupos', group_name: 'B', home_team: 'España',      away_team: 'Marruecos',    match_date: '2026-06-11', venue: 'MetLife Stadium',         city: 'Nueva York' },
    { match_number: 8,  stage: 'Fase de Grupos', group_name: 'B', home_team: 'Brasil',      away_team: 'Croacia',      match_date: '2026-06-12', venue: 'SoFi Stadium',            city: 'Los Ángeles' },
    { match_number: 9,  stage: 'Fase de Grupos', group_name: 'B', home_team: 'España',      away_team: 'Croacia',      match_date: '2026-06-16', venue: 'Gillette Stadium',        city: 'Boston' },
    { match_number: 10, stage: 'Fase de Grupos', group_name: 'B', home_team: 'Brasil',      away_team: 'Marruecos',    match_date: '2026-06-16', venue: 'MetLife Stadium',         city: 'Nueva York' },
    { match_number: 11, stage: 'Fase de Grupos', group_name: 'B', home_team: 'España',      away_team: 'Brasil',       match_date: '2026-06-20', venue: 'SoFi Stadium',            city: 'Los Ángeles' },
    { match_number: 12, stage: 'Fase de Grupos', group_name: 'B', home_team: 'Croacia',     away_team: 'Marruecos',    match_date: '2026-06-20', venue: 'Lumen Field',             city: 'Seattle' },
    // GRUPO C
    { match_number: 13, stage: 'Fase de Grupos', group_name: 'C', home_team: 'Argentina',   away_team: 'Países Bajos', match_date: '2026-06-12', venue: 'MetLife Stadium',         city: 'Nueva York' },
    { match_number: 14, stage: 'Fase de Grupos', group_name: 'C', home_team: 'Perú',        away_team: 'Arabia Saudita',match_date: '2026-06-12', venue: 'Estadio Akron',          city: 'Guadalajara' },
    { match_number: 15, stage: 'Fase de Grupos', group_name: 'C', home_team: 'Argentina',   away_team: 'Arabia Saudita',match_date: '2026-06-16', venue: 'AT&T Stadium',           city: 'Dallas' },
    { match_number: 16, stage: 'Fase de Grupos', group_name: 'C', home_team: 'Países Bajos',away_team: 'Perú',         match_date: '2026-06-17', venue: 'Estadio BBVA',           city: 'Monterrey' },
    { match_number: 17, stage: 'Fase de Grupos', group_name: 'C', home_team: 'Argentina',   away_team: 'Perú',         match_date: '2026-06-21', venue: 'Hard Rock Stadium',       city: 'Miami' },
    { match_number: 18, stage: 'Fase de Grupos', group_name: 'C', home_team: 'Países Bajos',away_team: 'Arabia Saudita',match_date: '2026-06-21', venue: 'Estadio Akron',          city: 'Guadalajara' },
    // GRUPO D
    { match_number: 19, stage: 'Fase de Grupos', group_name: 'D', home_team: 'Francia',     away_team: 'Polonia',      match_date: '2026-06-12', venue: 'Lumen Field',             city: 'Seattle' },
    { match_number: 20, stage: 'Fase de Grupos', group_name: 'D', home_team: 'Alemania',    away_team: 'Venezuela',    match_date: '2026-06-13', venue: 'Geodis Park',             city: 'Nashville' },
    { match_number: 21, stage: 'Fase de Grupos', group_name: 'D', home_team: 'Francia',     away_team: 'Venezuela',    match_date: '2026-06-17', venue: 'Lincoln Financial Field', city: 'Filadelfia' },
    { match_number: 22, stage: 'Fase de Grupos', group_name: 'D', home_team: 'Alemania',    away_team: 'Polonia',      match_date: '2026-06-17', venue: 'BC Place',               city: 'Vancouver' },
    { match_number: 23, stage: 'Fase de Grupos', group_name: 'D', home_team: 'Francia',     away_team: 'Alemania',     match_date: '2026-06-21', venue: 'MetLife Stadium',         city: 'Nueva York' },
    { match_number: 24, stage: 'Fase de Grupos', group_name: 'D', home_team: 'Polonia',     away_team: 'Venezuela',    match_date: '2026-06-21', venue: 'Estadio BBVA',           city: 'Monterrey' },
    // GRUPO E
    { match_number: 25, stage: 'Fase de Grupos', group_name: 'E', home_team: 'Portugal',    away_team: 'Congo',        match_date: '2026-06-13', venue: 'Arrowhead Stadium',       city: 'Kansas City' },
    { match_number: 26, stage: 'Fase de Grupos', group_name: 'E', home_team: 'Turquía',     away_team: 'Panamá',       match_date: '2026-06-13', venue: 'Camping World Stadium',   city: 'Orlando' },
    { match_number: 27, stage: 'Fase de Grupos', group_name: 'E', home_team: 'Portugal',    away_team: 'Panamá',       match_date: '2026-06-17', venue: 'Empower Field',          city: 'Denver' },
    { match_number: 28, stage: 'Fase de Grupos', group_name: 'E', home_team: 'Turquía',     away_team: 'Congo',        match_date: '2026-06-17', venue: 'Allegiant Stadium',       city: 'Las Vegas' },
    { match_number: 29, stage: 'Fase de Grupos', group_name: 'E', home_team: 'Portugal',    away_team: 'Turquía',      match_date: '2026-06-21', venue: 'Arrowhead Stadium',       city: 'Kansas City' },
    { match_number: 30, stage: 'Fase de Grupos', group_name: 'E', home_team: 'Congo',       away_team: 'Panamá',       match_date: '2026-06-21', venue: 'Camping World Stadium',   city: 'Orlando' },
    // GRUPO F
    { match_number: 31, stage: 'Fase de Grupos', group_name: 'F', home_team: 'Bélgica',     away_team: 'Italia',       match_date: '2026-06-13', venue: 'Estadio Azteca',          city: 'Ciudad de México' },
    { match_number: 32, stage: 'Fase de Grupos', group_name: 'F', home_team: 'Australia',   away_team: 'Rep. Checa',   match_date: '2026-06-13', venue: 'BC Place',               city: 'Vancouver' },
    { match_number: 33, stage: 'Fase de Grupos', group_name: 'F', home_team: 'Bélgica',     away_team: 'Rep. Checa',   match_date: '2026-06-17', venue: 'Hard Rock Stadium',       city: 'Miami' },
    { match_number: 34, stage: 'Fase de Grupos', group_name: 'F', home_team: 'Italia',      away_team: 'Australia',    match_date: '2026-06-18', venue: 'Lumen Field',             city: 'Seattle' },
    { match_number: 35, stage: 'Fase de Grupos', group_name: 'F', home_team: 'Bélgica',     away_team: 'Australia',    match_date: '2026-06-22', venue: 'SoFi Stadium',            city: 'Los Ángeles' },
    { match_number: 36, stage: 'Fase de Grupos', group_name: 'F', home_team: 'Italia',      away_team: 'Rep. Checa',   match_date: '2026-06-22', venue: 'MetLife Stadium',         city: 'Nueva York' },
    // GRUPO G
    { match_number: 37, stage: 'Fase de Grupos', group_name: 'G', home_team: 'EE. UU.',     away_team: 'Canadá',       match_date: '2026-06-14', venue: 'Arrowhead Stadium',       city: 'Kansas City' },
    { match_number: 38, stage: 'Fase de Grupos', group_name: 'G', home_team: 'Honduras',    away_team: 'Serbia',       match_date: '2026-06-14', venue: 'AT&T Stadium',            city: 'Dallas' },
    { match_number: 39, stage: 'Fase de Grupos', group_name: 'G', home_team: 'EE. UU.',     away_team: 'Serbia',       match_date: '2026-06-18', venue: 'SoFi Stadium',            city: 'Los Ángeles' },
    { match_number: 40, stage: 'Fase de Grupos', group_name: 'G', home_team: 'Canadá',      away_team: 'Honduras',     match_date: '2026-06-18', venue: 'BC Place',               city: 'Vancouver' },
    { match_number: 41, stage: 'Fase de Grupos', group_name: 'G', home_team: 'EE. UU.',     away_team: 'Honduras',     match_date: '2026-06-22', venue: 'Empower Field',          city: 'Denver' },
    { match_number: 42, stage: 'Fase de Grupos', group_name: 'G', home_team: 'Canadá',      away_team: 'Serbia',       match_date: '2026-06-22', venue: 'Gillette Stadium',        city: 'Boston' },
    // GRUPO H
    { match_number: 43, stage: 'Fase de Grupos', group_name: 'H', home_team: 'Senegal',     away_team: 'Nueva Zelanda',match_date: '2026-06-14', venue: 'Geodis Park',             city: 'Nashville' },
    { match_number: 44, stage: 'Fase de Grupos', group_name: 'H', home_team: 'Ucrania',     away_team: 'Eslovaquia',   match_date: '2026-06-14', venue: 'Camping World Stadium',   city: 'Orlando' },
    { match_number: 45, stage: 'Fase de Grupos', group_name: 'H', home_team: 'Senegal',     away_team: 'Eslovaquia',   match_date: '2026-06-18', venue: 'Allegiant Stadium',       city: 'Las Vegas' },
    { match_number: 46, stage: 'Fase de Grupos', group_name: 'H', home_team: 'Ucrania',     away_team: 'Nueva Zelanda',match_date: '2026-06-19', venue: 'Lincoln Financial Field', city: 'Filadelfia' },
    { match_number: 47, stage: 'Fase de Grupos', group_name: 'H', home_team: 'Senegal',     away_team: 'Ucrania',      match_date: '2026-06-23', venue: 'Estadio Akron',          city: 'Guadalajara' },
    { match_number: 48, stage: 'Fase de Grupos', group_name: 'H', home_team: 'Nueva Zelanda',away_team: 'Eslovaquia',  match_date: '2026-06-23', venue: 'Estadio BBVA',           city: 'Monterrey' },
    // GRUPO I
    { match_number: 49, stage: 'Fase de Grupos', group_name: 'I', home_team: 'Japón',       away_team: 'Colombia',     match_date: '2026-06-14', venue: 'Estadio Akron',          city: 'Guadalajara' },
    { match_number: 50, stage: 'Fase de Grupos', group_name: 'I', home_team: 'Costa Rica',  away_team: 'Camerún',      match_date: '2026-06-14', venue: 'Estadio BBVA',           city: 'Monterrey' },
    { match_number: 51, stage: 'Fase de Grupos', group_name: 'I', home_team: 'Japón',       away_team: 'Camerún',      match_date: '2026-06-18', venue: 'Estadio Azteca',          city: 'Ciudad de México' },
    { match_number: 52, stage: 'Fase de Grupos', group_name: 'I', home_team: 'Colombia',    away_team: 'Costa Rica',   match_date: '2026-06-19', venue: 'AT&T Stadium',            city: 'Dallas' },
    { match_number: 53, stage: 'Fase de Grupos', group_name: 'I', home_team: 'Japón',       away_team: 'Costa Rica',   match_date: '2026-06-23', venue: 'Rose Bowl',               city: 'Los Ángeles' },
    { match_number: 54, stage: 'Fase de Grupos', group_name: 'I', home_team: 'Colombia',    away_team: 'Camerún',      match_date: '2026-06-23', venue: 'Hard Rock Stadium',       city: 'Miami' },
    // GRUPO J
    { match_number: 55, stage: 'Fase de Grupos', group_name: 'J', home_team: 'Corea del Sur',away_team: 'Ghana',       match_date: '2026-06-15', venue: 'SoFi Stadium',            city: 'Los Ángeles' },
    { match_number: 56, stage: 'Fase de Grupos', group_name: 'J', home_team: 'Dinamarca',   away_team: 'Argelia',      match_date: '2026-06-15', venue: 'Arrowhead Stadium',       city: 'Kansas City' },
    { match_number: 57, stage: 'Fase de Grupos', group_name: 'J', home_team: 'Corea del Sur',away_team: 'Argelia',     match_date: '2026-06-19', venue: 'Lumen Field',             city: 'Seattle' },
    { match_number: 58, stage: 'Fase de Grupos', group_name: 'J', home_team: 'Dinamarca',   away_team: 'Ghana',        match_date: '2026-06-19', venue: 'BC Place',               city: 'Vancouver' },
    { match_number: 59, stage: 'Fase de Grupos', group_name: 'J', home_team: 'Corea del Sur',away_team: 'Dinamarca',   match_date: '2026-06-23', venue: 'Geodis Park',             city: 'Nashville' },
    { match_number: 60, stage: 'Fase de Grupos', group_name: 'J', home_team: 'Ghana',       away_team: 'Argelia',      match_date: '2026-06-23', venue: 'Empower Field',          city: 'Denver' },
    // GRUPO K
    { match_number: 61, stage: 'Fase de Grupos', group_name: 'K', home_team: 'Nigeria',     away_team: 'Qatar',        match_date: '2026-06-15', venue: 'Hard Rock Stadium',       city: 'Miami' },
    { match_number: 62, stage: 'Fase de Grupos', group_name: 'K', home_team: 'Suecia',      away_team: 'Eslovenia',    match_date: '2026-06-16', venue: 'Allegiant Stadium',       city: 'Las Vegas' },
    { match_number: 63, stage: 'Fase de Grupos', group_name: 'K', home_team: 'Nigeria',     away_team: 'Eslovenia',    match_date: '2026-06-20', venue: 'Camping World Stadium',   city: 'Orlando' },
    { match_number: 64, stage: 'Fase de Grupos', group_name: 'K', home_team: 'Suecia',      away_team: 'Qatar',        match_date: '2026-06-20', venue: 'Lincoln Financial Field', city: 'Filadelfia' },
    { match_number: 65, stage: 'Fase de Grupos', group_name: 'K', home_team: 'Nigeria',     away_team: 'Suecia',       match_date: '2026-06-24', venue: 'MetLife Stadium',         city: 'Nueva York' },
    { match_number: 66, stage: 'Fase de Grupos', group_name: 'K', home_team: 'Qatar',       away_team: 'Eslovenia',    match_date: '2026-06-24', venue: 'AT&T Stadium',            city: 'Dallas' },
    // GRUPO L
    { match_number: 67, stage: 'Fase de Grupos', group_name: 'L', home_team: 'Inglaterra',  away_team: 'Costa de Marfil',match_date: '2026-06-15', venue: 'Estadio BBVA',         city: 'Monterrey' },
    { match_number: 68, stage: 'Fase de Grupos', group_name: 'L', home_team: 'México',      away_team: 'Hungría',      match_date: '2026-06-16', venue: 'Rose Bowl',               city: 'Los Ángeles' },
    { match_number: 69, stage: 'Fase de Grupos', group_name: 'L', home_team: 'Inglaterra',  away_team: 'Hungría',      match_date: '2026-06-20', venue: 'Gillette Stadium',        city: 'Boston' },
    { match_number: 70, stage: 'Fase de Grupos', group_name: 'L', home_team: 'México',      away_team: 'Costa de Marfil',match_date: '2026-06-20', venue: 'Arrowhead Stadium',     city: 'Kansas City' },
    { match_number: 71, stage: 'Fase de Grupos', group_name: 'L', home_team: 'Inglaterra',  away_team: 'México',       match_date: '2026-06-24', venue: 'Estadio Azteca',          city: 'Ciudad de México' },
    { match_number: 72, stage: 'Fase de Grupos', group_name: 'L', home_team: 'Costa de Marfil',away_team: 'Hungría',  match_date: '2026-06-24', venue: 'Estadio Akron',          city: 'Guadalajara' },
  ];

  const insertMatch = db.prepare(`
    INSERT INTO matches (match_number, stage, group_name, home_team, away_team, match_date, venue, city, status)
    VALUES (@match_number, @stage, @group_name, @home_team, @away_team, @match_date, @venue, @city, 'upcoming')
  `);

  const insertMany = db.transaction((matches) => {
    for (const m of matches) insertMatch.run(m);
  });

  insertMany(seedMatches);
  console.log(`✅ ${seedMatches.length} partidos de fase de grupos cargados`);
}

// Utility: calculate points from prediction vs result
function calculatePoints(predHome, predAway, realHome, realAway) {
  if (predHome === realHome && predAway === realAway) return 3;
  const predResult = Math.sign(predHome - predAway);
  const realResult = Math.sign(realHome - realAway);
  if (predResult === realResult) return 1;
  return 0;
}

module.exports = { db, calculatePoints };
