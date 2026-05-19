const {
  db,
  buildKickoffAtFromLocal,
  calculatePoints,
  getUtcMinus3DateParts,
  normalizeKickoffAt,
  normalizeMatchTime,
} = require('../db/database');

const THESPORTSDB_API_BASE = process.env.THESPORTSDB_API_BASE || 'https://www.thesportsdb.com/api/v1/json';
const THESPORTSDB_API_KEY = process.env.THESPORTSDB_API_KEY || '123';
const WORLD_CUP_LEAGUE_ID = process.env.THESPORTSDB_WORLD_CUP_LEAGUE_ID || '4429';
const WORLD_CUP_SEASON = process.env.THESPORTSDB_WORLD_CUP_SEASON || '2026';
const THESPORTSDB_LOG_LEVEL = (process.env.THESPORTSDB_LOG_LEVEL || 'basic').toLowerCase();
const MAX_WORLD_CUP_ROUNDS = 10;

function readIntervalMs(envName, fallbackMs) {
  const value = Number(process.env[envName]);
  return Number.isFinite(value) && value > 0 ? value : fallbackMs;
}

const DAILY_SYNC_MS = readIntervalMs('THESPORTSDB_DAILY_SYNC_MS', 24 * 60 * 60 * 1000);
const SCHEDULED_SYNC_CHECK_MS = readIntervalMs('THESPORTSDB_SCHEDULED_SYNC_CHECK_MS', 5 * 60 * 1000);
const RESULT_REFRESH_MS = readIntervalMs('THESPORTSDB_RESULT_REFRESH_MS', 5 * 60 * 1000);
const RESULT_REFRESH_LOOKBACK_MS = readIntervalMs('THESPORTSDB_RESULT_REFRESH_LOOKBACK_MS', 4 * 60 * 60 * 1000);
const RESULT_REFRESH_LOOKAHEAD_MS = readIntervalMs('THESPORTSDB_RESULT_REFRESH_LOOKAHEAD_MS', 30 * 60 * 1000);

const TEAM_NAME_TRANSLATIONS = {
  Algeria: 'Argelia',
  Argentina: 'Argentina',
  Australia: 'Australia',
  Austria: 'Austria',
  Belgium: 'Bélgica',
  'Bosnia-Herzegovina': 'Bosnia y Herzegovina',
  'Bosnia and Herzegovina': 'Bosnia y Herzegovina',
  Brazil: 'Brasil',
  Cameroon: 'Camerún',
  Canada: 'Canadá',
  'Cape Verde': 'Cabo Verde',
  Colombia: 'Colombia',
  Croatia: 'Croacia',
  Curacao: 'Curazao',
  'Curaçao': 'Curazao',
  'Costa Rica': 'Costa Rica',
  'Czech Republic': 'República Checa',
  Denmark: 'Dinamarca',
  Ecuador: 'Ecuador',
  Egypt: 'Egipto',
  England: 'Inglaterra',
  France: 'Francia',
  Germany: 'Alemania',
  Ghana: 'Ghana',
  Haiti: 'Haití',
  Honduras: 'Honduras',
  Hungary: 'Hungría',
  Iran: 'Irán',
  Iraq: 'Irak',
  'Ivory Coast': 'Costa de Marfil',
  Japan: 'Japón',
  Jordan: 'Jordania',
  Mexico: 'México',
  Morocco: 'Marruecos',
  Netherlands: 'Países Bajos',
  'New Zealand': 'Nueva Zelanda',
  Nigeria: 'Nigeria',
  Norway: 'Noruega',
  Panama: 'Panamá',
  Paraguay: 'Paraguay',
  Poland: 'Polonia',
  Portugal: 'Portugal',
  'DR Congo': 'República Democrática del Congo',
  Qatar: 'Qatar',
  'Saudi Arabia': 'Arabia Saudita',
  Scotland: 'Escocia',
  Senegal: 'Senegal',
  Serbia: 'Serbia',
  Slovakia: 'Eslovaquia',
  Slovenia: 'Eslovenia',
  'South Africa': 'Sudáfrica',
  'South Korea': 'Corea del Sur',
  Spain: 'España',
  Sweden: 'Suecia',
  Switzerland: 'Suiza',
  Tunisia: 'Túnez',
  Turkey: 'Turquía',
  Ukraine: 'Ucrania',
  Uruguay: 'Uruguay',
  USA: 'Estados Unidos',
  'United States': 'Estados Unidos',
  Uzbekistan: 'Uzbekistán',
  Venezuela: 'Venezuela',
};

function shouldLog(level = 'basic') {
  if (THESPORTSDB_LOG_LEVEL === 'silent' || THESPORTSDB_LOG_LEVEL === 'off') return false;
  if (THESPORTSDB_LOG_LEVEL === 'debug') return true;
  return level === 'basic';
}

function logTheSportsDb(message, extra = null, level = 'basic') {
  if (!shouldLog(level)) return;
  if (extra == null) {
    console.log(`[TheSportsDB] ${message}`);
    return;
  }

  console.log(`[TheSportsDB] ${message}`, extra);
}

function redactApiKey(url) {
  return String(url).replace(`/${THESPORTSDB_API_KEY}/`, '/<api-key>/');
}

async function getMetadata(key) {
  const row = await db.prepare('SELECT value FROM app_metadata WHERE key = $1').get(key);
  return row?.value ?? null;
}

async function setMetadata(key, value) {
  await db.prepare(`
    INSERT INTO app_metadata (key, value, updated_at)
    VALUES ($1, $2, CURRENT_TIMESTAMP)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = CURRENT_TIMESTAMP
  `).run(key, value == null ? null : String(value));
}

function mapApiStatus(status) {
  const normalized = String(status || '').trim().toUpperCase();
  if (!normalized || normalized === 'NOT STARTED' || normalized === 'NS') return 'upcoming';
  if (
    normalized === 'FT' ||
    normalized === 'AET' ||
    normalized === 'PEN' ||
    normalized.includes('FINISHED') ||
    normalized.includes('FULL TIME')
  ) {
    return 'finished';
  }

  return 'live';
}

function parseNullableScore(value) {
  if (value == null || value === '') return null;
  const parsed = Number.parseInt(value, 10);
  return Number.isNaN(parsed) ? null : parsed;
}

function translateTeamName(teamName) {
  if (!teamName) return teamName;
  return TEAM_NAME_TRANSLATIONS[teamName] || teamName;
}

function cleanGroupName(groupName, matchNumber) {
  if (groupName) {
    const cleaned = String(groupName).replace(/^group\s+/i, '').trim();
    return cleaned || null;
  }

  if (matchNumber <= 72) {
    return String.fromCharCode(65 + Math.floor((matchNumber - 1) / 6));
  }

  return null;
}

function getStageByMatchNumber(matchNumber) {
  if (matchNumber <= 72) return 'Fase de Grupos';
  if (matchNumber <= 88) return 'Ronda de 32';
  if (matchNumber <= 96) return 'Octavos de Final';
  if (matchNumber <= 100) return 'Cuartos de Final';
  if (matchNumber <= 102) return 'Semifinal';
  if (matchNumber === 103) return 'Tercer Puesto';
  return 'Final';
}

function compareEvents(left, right) {
  const leftStamp = left.strTimestamp || `${left.dateEvent || ''}T${left.strTime || '00:00:00'}`;
  const rightStamp = right.strTimestamp || `${right.dateEvent || ''}T${right.strTime || '00:00:00'}`;
  if (leftStamp !== rightStamp) return leftStamp.localeCompare(rightStamp);
  return String(left.idEvent || '').localeCompare(String(right.idEvent || ''));
}

function normalizeRemoteMatch(event, index) {
  const matchNumber = index + 1;
  const kickoffAt = normalizeKickoffAt(event.strTimestamp) || buildKickoffAtFromLocal(event.dateEvent || null, event.strTime || null);
  const utcMinus3Parts = getUtcMinus3DateParts(kickoffAt);
  const matchDate = utcMinus3Parts?.match_date || event.dateEvent || null;
  const matchTime = utcMinus3Parts?.match_time || normalizeMatchTime(event.strTime || null);
  const status = mapApiStatus(event.strStatus);

  return {
    external_event_id: String(event.idEvent),
    match_number: matchNumber,
    stage: getStageByMatchNumber(matchNumber),
    group_name: cleanGroupName(event.strGroup, matchNumber),
    home_team: translateTeamName(event.strHomeTeam),
    away_team: translateTeamName(event.strAwayTeam),
    home_flag: event.strHomeTeamBadge || '',
    away_flag: event.strAwayTeamBadge || '',
    match_date: matchDate,
    match_time: matchTime,
    kickoff_at: kickoffAt,
    venue: event.strVenue || '',
    city: event.strCity || '',
    home_score: parseNullableScore(event.intHomeScore),
    away_score: parseNullableScore(event.intAwayScore),
    status,
  };
}

async function recalculatePointsForMatch(matchId, homeScore, awayScore) {
  if (homeScore == null || awayScore == null) return 0;

  const predictions = await db.prepare('SELECT id, home_score, away_score FROM predictions WHERE match_id = $1').all(matchId);
  for (const prediction of predictions) {
    const points = calculatePoints(prediction.home_score, prediction.away_score, homeScore, awayScore);
    await db.prepare('UPDATE predictions SET points = $1 WHERE id = $2').run(points, prediction.id);
  }

  return predictions.length;
}

async function clearPointsForMatch(matchId) {
  const predictions = await db.prepare('SELECT id, home_score, away_score FROM predictions WHERE match_id = $1').all(matchId);
  for (const prediction of predictions) {
    await db.prepare('UPDATE predictions SET points = $1 WHERE id = $2').run(null, prediction.id);
  }

  return predictions.length;
}

async function fetchWorldCupEvents() {
  const collectedEvents = [];
  let emptyRoundsInARow = 0;

  for (let round = 1; round <= MAX_WORLD_CUP_ROUNDS; round += 1) {
    const endpoint = `${THESPORTSDB_API_BASE}/${THESPORTSDB_API_KEY}/eventsround.php?id=${WORLD_CUP_LEAGUE_ID}&r=${round}&s=${WORLD_CUP_SEASON}`;
    const startedAt = Date.now();
    logTheSportsDb('GET eventsround', {
      url: redactApiKey(endpoint),
      leagueId: WORLD_CUP_LEAGUE_ID,
      season: WORLD_CUP_SEASON,
      round,
    });

    const response = await fetch(endpoint, {
      headers: { Accept: 'application/json' },
    });

    logTheSportsDb('Response recibida', {
      round,
      status: response.status,
      ok: response.ok,
      durationMs: Date.now() - startedAt,
    });

    if (!response.ok) {
      throw new Error(`TheSportsDB respondió ${response.status} para la ronda ${round}`);
    }

    const payload = await response.json();
    const roundEvents = Array.isArray(payload?.events)
      ? payload.events.filter((event) => String(event?.idLeague) === WORLD_CUP_LEAGUE_ID)
      : [];

    logTheSportsDb('Payload procesado', {
      round,
      totalEvents: Array.isArray(payload?.events) ? payload.events.length : 0,
      filteredLeagueEvents: roundEvents.length,
    }, 'debug');

    if (!roundEvents.length) {
      emptyRoundsInARow += 1;
      if (collectedEvents.length > 0 && emptyRoundsInARow >= 2) {
        break;
      }
      continue;
    }

    emptyRoundsInARow = 0;
    collectedEvents.push(...roundEvents);
  }

  if (!collectedEvents.length) {
    throw new Error('TheSportsDB no devolvió eventos para el Mundial');
  }

  return Array.from(new Map(collectedEvents.map((event) => [String(event.idEvent), event])).values())
    .sort(compareEvents);
}

async function isDailySyncDue(now = new Date()) {
  const lastSyncAt = (await getMetadata('thesportsdb_last_fixture_sync_at')) || (await getMetadata('thesportsdb_last_sync_at'));
  if (!lastSyncAt) return true;

  const lastRun = new Date(lastSyncAt);
  if (Number.isNaN(lastRun.getTime())) return true;
  return now.getTime() - lastRun.getTime() >= DAILY_SYNC_MS;
}

async function isIntervalDue(metadataKey, intervalMs, now = new Date()) {
  const lastRunAt = await getMetadata(metadataKey);
  if (!lastRunAt) return true;

  const lastRun = new Date(lastRunAt);
  if (Number.isNaN(lastRun.getTime())) return true;
  return now.getTime() - lastRun.getTime() >= intervalMs;
}

async function hasActiveResultWindow(now = new Date()) {
  const lowerBound = new Date(now.getTime() - RESULT_REFRESH_LOOKBACK_MS).toISOString();
  const upperBound = new Date(now.getTime() + RESULT_REFRESH_LOOKAHEAD_MS).toISOString();
  const row = await db.prepare(`
    SELECT id
    FROM matches
    WHERE kickoff_at IS NOT NULL
      AND COALESCE(status, 'upcoming') != 'finished'
      AND kickoff_at BETWEEN $1 AND $2
    LIMIT 1
  `).get(lowerBound, upperBound);
  return Boolean(row);
}

async function isResultRefreshDue(now = new Date()) {
  return (await hasActiveResultWindow(now)) && (await isIntervalDue('thesportsdb_last_result_refresh_at', RESULT_REFRESH_MS, now));
}

async function getScheduledSyncReason(now = new Date()) {
  if (await isDailySyncDue(now)) return 'daily-fixtures';
  if (await isResultRefreshDue(now)) return 'result-refresh';
  return null;
}

async function syncWorldCupMatches({ force = false, source = 'manual', reason = null } = {}) {
  const startedAt = new Date();
  const syncReason = force ? 'forced' : (reason || (await getScheduledSyncReason(startedAt)));
  logTheSportsDb('Iniciando sync', {
    source,
    force,
    reason: syncReason,
    startedAt: startedAt.toISOString(),
  });

  if (!force && !syncReason) {
    logTheSportsDb('Sync omitida porque no hay ventana activa para actualizar', {
      source,
      lastSyncAt: await getMetadata('thesportsdb_last_sync_at'),
      activeResultWindow: await hasActiveResultWindow(startedAt),
    });
    return {
      skipped: true,
      reason: 'not-due',
      lastSyncAt: await getMetadata('thesportsdb_last_sync_at'),
    };
  }

  await setMetadata('thesportsdb_last_attempt_at', startedAt.toISOString());
  await setMetadata('thesportsdb_last_source', source);

  try {
    const remoteEvents = await fetchWorldCupEvents();
    const normalizedMatches = remoteEvents.map(normalizeRemoteMatch);
    logTheSportsDb('Eventos normalizados', {
      fetched: remoteEvents.length,
      firstMatch: normalizedMatches[0]
        ? `${normalizedMatches[0].match_number} ${normalizedMatches[0].home_team} vs ${normalizedMatches[0].away_team}`
        : null,
      lastMatch: normalizedMatches.at(-1)
        ? `${normalizedMatches.at(-1).match_number} ${normalizedMatches.at(-1).home_team} vs ${normalizedMatches.at(-1).away_team}`
        : null,
    }, 'debug');

    const existingMatches = await db.prepare(`
      SELECT id, match_number, external_event_id, home_score, away_score, status
      FROM matches
      ORDER BY match_number ASC
    `).all();

    const byExternalId = new Map(existingMatches.filter((match) => match.external_event_id).map((match) => [String(match.external_event_id), match]));
    const byMatchNumber = new Map(existingMatches.map((match) => [match.match_number, match]));

    let inserted = 0;
    let updated = 0;
    let recalculatedPredictions = 0;

    for (const remoteMatch of normalizedMatches) {
      const existingMatch = byExternalId.get(remoteMatch.external_event_id) || byMatchNumber.get(remoteMatch.match_number);
      if (existingMatch) {
        await db.prepare(`
          UPDATE matches
          SET match_number = $1,
              stage = $2,
              group_name = $3,
              home_team = $4,
              away_team = $5,
              home_flag = $6,
              away_flag = $7,
              match_date = $8,
              match_time = $9,
              kickoff_at = $10,
              venue = $11,
              city = $12,
              home_score = $13,
              away_score = $14,
              external_event_id = $15,
              status = $16
          WHERE id = $17
        `).run(
          remoteMatch.match_number,
          remoteMatch.stage,
          remoteMatch.group_name,
          remoteMatch.home_team,
          remoteMatch.away_team,
          remoteMatch.home_flag,
          remoteMatch.away_flag,
          remoteMatch.match_date,
          remoteMatch.match_time,
          remoteMatch.kickoff_at,
          remoteMatch.venue,
          remoteMatch.city,
          remoteMatch.home_score,
          remoteMatch.away_score,
          remoteMatch.external_event_id,
          remoteMatch.status,
          existingMatch.id,
        );
        updated += 1;
        byExternalId.set(remoteMatch.external_event_id, { ...existingMatch, external_event_id: remoteMatch.external_event_id });
        byMatchNumber.set(remoteMatch.match_number, { ...existingMatch, match_number: remoteMatch.match_number });

        if (remoteMatch.status === 'finished') {
          recalculatedPredictions += await recalculatePointsForMatch(existingMatch.id, remoteMatch.home_score, remoteMatch.away_score);
        } else {
          await clearPointsForMatch(existingMatch.id);
        }
        continue;
      }

      const insertedInfo = await db.prepare(`
        INSERT INTO matches (
          match_number, stage, group_name, home_team, away_team, home_flag, away_flag,
          match_date, match_time, kickoff_at, venue, city, home_score, away_score, external_event_id, status
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
        RETURNING id
      `).get(
        remoteMatch.match_number,
        remoteMatch.stage,
        remoteMatch.group_name,
        remoteMatch.home_team,
        remoteMatch.away_team,
        remoteMatch.home_flag,
        remoteMatch.away_flag,
        remoteMatch.match_date,
        remoteMatch.match_time,
        remoteMatch.kickoff_at,
        remoteMatch.venue,
        remoteMatch.city,
        remoteMatch.home_score,
        remoteMatch.away_score,
        remoteMatch.external_event_id,
        remoteMatch.status,
      );
      inserted += 1;
      const insertedId = insertedInfo.id;

      if (remoteMatch.status === 'finished') {
        recalculatedPredictions += await recalculatePointsForMatch(insertedId, remoteMatch.home_score, remoteMatch.away_score);
      } else {
        await clearPointsForMatch(insertedId);
      }
    }

    const summary = {
      fetched: normalizedMatches.length,
      inserted,
      updated,
      recalculatedPredictions,
    };

    const finishedAt = new Date();
    await setMetadata('thesportsdb_last_sync_at', finishedAt.toISOString());
    if (force || syncReason !== 'result-refresh') {
      await setMetadata('thesportsdb_last_fixture_sync_at', finishedAt.toISOString());
    }
    if (force || syncReason === 'result-refresh' || (await hasActiveResultWindow(finishedAt))) {
      await setMetadata('thesportsdb_last_result_refresh_at', finishedAt.toISOString());
    }
    await setMetadata('thesportsdb_last_status', 'success');
    await setMetadata('thesportsdb_last_error', '');
    await setMetadata('thesportsdb_last_summary', JSON.stringify(summary));

    logTheSportsDb('Sync completada', {
      source,
      reason: syncReason,
      durationMs: finishedAt.getTime() - startedAt.getTime(),
      ...summary,
    });

    return {
      skipped: false,
      source,
      startedAt: startedAt.toISOString(),
      finishedAt: finishedAt.toISOString(),
      ...summary,
    };
  } catch (error) {
    await setMetadata('thesportsdb_last_status', 'error');
    await setMetadata('thesportsdb_last_error', error.message);
    logTheSportsDb('Sync falló', {
      source,
      message: error.message,
    });
    throw error;
  }
}

async function getSyncStatus() {
  return {
    lastAttemptAt: await getMetadata('thesportsdb_last_attempt_at'),
    lastSyncAt: await getMetadata('thesportsdb_last_sync_at'),
    lastFixtureSyncAt: (await getMetadata('thesportsdb_last_fixture_sync_at')) || (await getMetadata('thesportsdb_last_sync_at')),
    lastResultRefreshAt: await getMetadata('thesportsdb_last_result_refresh_at'),
    lastStatus: await getMetadata('thesportsdb_last_status'),
    lastError: await getMetadata('thesportsdb_last_error'),
    lastSource: await getMetadata('thesportsdb_last_source'),
    lastSummary: await getMetadata('thesportsdb_last_summary'),
    activeResultWindow: await hasActiveResultWindow(),
    dailyDueNow: await isDailySyncDue(),
    resultRefreshDueNow: await isResultRefreshDue(),
    dueNow: Boolean(await getScheduledSyncReason()),
  };
}

function startDailyWorldCupSync() {
  const runScheduledSync = async () => {
    try {
      const result = await syncWorldCupMatches({ source: 'scheduler' });
      if (!result.skipped) {
        console.log(`🔄 TheSportsDB sync OK [${result.reason || 'manual'}]: ${result.fetched} partidos, ${result.inserted} nuevos, ${result.updated} actualizados`);
      }
    } catch (error) {
      console.error(`❌ Error en sync programada de TheSportsDB: ${error.message}`);
    }
  };

  runScheduledSync();
  const timer = setInterval(runScheduledSync, SCHEDULED_SYNC_CHECK_MS);
  if (typeof timer.unref === 'function') timer.unref();
  return timer;
}

module.exports = {
  getSyncStatus,
  startDailyWorldCupSync,
  syncWorldCupMatches,
};
