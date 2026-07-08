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
// TheSportsDB uses intRound values for its eventsround.php endpoint.
// Group stage: matchdays 1-6 (intRound 1-6, but typical World Cup has 3 matchdays).
// Knockout: intRound = number of teams in the round (32, 16, 8, 4, 2).
// However, TheSportsDB sometimes assigns non-standard round numbers (e.g. 125 for
// quarterfinals). We fetch all known round numbers explicitly instead of scanning
// sequentially because knockout rounds are numerically far from group-stage rounds.
const WORLD_CUP_ROUND_NUMBERS = [1, 2, 3, 4, 5, 6, 32, 16, 125, 8, 4, 2];

// Delay between round fetches (ms). Free API tier allows 30 req/min = 2s/req.
// We use 2.5s to stay safely under the limit.
const ROUND_FETCH_DELAY_MS = 2500;

// Knockout event discovery via ID scanning (fallback only).
// Used as a safety net for events that may not appear via eventsround.php.
const KNOCKOUT_ID_SCAN_BATCH = 5;
const KNOCKOUT_ID_SCAN_WINDOW = 3000;
const KNOCKOUT_ID_SCAN_EMPTY_LIMIT = 8;
const KNOCKOUT_ID_SCAN_BATCH_DELAY_MS = 200;

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
    normalized === 'AP' ||
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

async function fetchWorldCupEvents({ skipKnockoutScan = false } = {}) {
  const collectedEvents = [];

  // Fetch events by known round numbers. TheSportsDB uses intRound values:
  // 1-6 = group stage matchdays, 32 = Round of 32, 16 = Round of 16,
  // 8 = Quarterfinals, 4 = Semifinals, 2 = Final & Third Place.
  // Knockout rounds (32, 16, etc.) are not contiguous with group rounds (1-6),
  // so we query them explicitly instead of scanning sequentially.
  for (const round of WORLD_CUP_ROUND_NUMBERS) {
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

    if (roundEvents.length) {
      collectedEvents.push(...roundEvents);
    }

    // Respect rate limit: free tier = 30 req/min.
    await new Promise((r) => setTimeout(r, ROUND_FETCH_DELAY_MS));
  }

  // Fallback ID scan for any events that may have slipped through the round-based API.
  // Only run during full fixture syncs (not lightweight result-refresh).
  if (!skipKnockoutScan) {
    const existingIds = new Set(collectedEvents.map((event) => String(event.idEvent)));
    const knockoutEvents = await discoverKnockoutEvents(existingIds);
    if (knockoutEvents.length) {
      logTheSportsDb('Knockout events descubiertos via ID scan (fallback)', {
        count: knockoutEvents.length,
        first: knockoutEvents[0] ? `${knockoutEvents[0].strEvent} (${knockoutEvents[0].dateEvent})` : null,
        last: knockoutEvents.at(-1) ? `${knockoutEvents.at(-1).strEvent} (${knockoutEvents.at(-1).dateEvent})` : null,
      });
      collectedEvents.push(...knockoutEvents);
    }
  }

  if (!collectedEvents.length) {
    throw new Error('TheSportsDB no devolvió eventos para el Mundial');
  }

  return Array.from(new Map(collectedEvents.map((event) => [String(event.idEvent), event])).values())
    .sort(compareEvents);
}

async function discoverKnockoutEvents(existingIds) {
  const discovered = [];
  let emptyBatches = 0;

  // Start from the last scanned ID (or fall back to the highest known event ID in DB).
  const lastScanIdStr = await getMetadata('thesportsdb_last_knockout_scan_id');
  let scanStart = lastScanIdStr ? Number(lastScanIdStr) + 1 : null;

  if (!scanStart) {
    // First run: start from the highest event ID we already know about.
    const maxRow = await db.prepare(
      'SELECT MAX(CAST(external_event_id AS INTEGER)) AS max_id FROM matches WHERE external_event_id IS NOT NULL AND external_event_id ~ $1'
    ).get('^[0-9]+$');
    const dbMax = maxRow?.max_id ? Number(maxRow.max_id) : 0;
    scanStart = Math.max(dbMax + 1, 2499600);
  }

  // Jump past the known empty gap between group-stage IDs (~246xxxx) and
  // knockout IDs (~2499xxx).  This prevents wasting daily scans on empty space.
  if (scanStart < 2499600) {
    logTheSportsDb('Knockout ID scan saltando gap', { from: scanStart, to: 2499600 }, 'basic');
    scanStart = 2499600;
  }

  // Use a larger window on the first scan (when no previous progress exists),
  // then a smaller window for incremental daily updates.
  const isFirstScan = !lastScanIdStr;
  const scanWindow = isFirstScan ? 15000 : KNOCKOUT_ID_SCAN_WINDOW;
  const scanEnd = scanStart + scanWindow;

  logTheSportsDb('Knockout ID scan iniciando', { scanStart, scanEnd }, 'debug');

  for (let batchStart = scanStart; batchStart <= scanEnd; batchStart += KNOCKOUT_ID_SCAN_BATCH) {
    const batchIds = [];
    for (let id = batchStart; id < batchStart + KNOCKOUT_ID_SCAN_BATCH && id <= scanEnd; id++) {
      if (!existingIds.has(String(id))) {
        batchIds.push(id);
      }
    }

    // Track the highest ID we attempted in this batch for progress saving.
    const maxAttemptedId = batchStart + KNOCKOUT_ID_SCAN_BATCH - 1;

    if (!batchIds.length) {
      emptyBatches += 1;
      if (emptyBatches >= KNOCKOUT_ID_SCAN_EMPTY_LIMIT) break;
      continue;
    }

    const batchResults = await Promise.all(
      batchIds.map((id) =>
        fetch(`${THESPORTSDB_API_BASE}/${THESPORTSDB_API_KEY}/lookupevent.php?id=${id}`, {
          headers: { Accept: 'application/json' },
        })
          .then((r) => (r.ok ? r.json() : null))
          .catch(() => null)
      )
    );

    let batchFound = 0;
    for (const result of batchResults) {
      if (!result?.events?.[0]) continue;
      const event = result.events[0];
      if (String(event.idLeague) !== WORLD_CUP_LEAGUE_ID) continue;
      if (existingIds.has(String(event.idEvent))) continue;
      // Only collect knockout-stage events (from June 27 onwards)
      if (!event.dateEvent || event.dateEvent < '2026-06-27') continue;

      discovered.push(event);
      existingIds.add(String(event.idEvent));
      batchFound += 1;
    }

    // Save progress after each batch so interrupted scans can resume.
    await setMetadata('thesportsdb_last_knockout_scan_id', String(maxAttemptedId));

    // Small delay between batches to avoid rate limiting.
    await new Promise((r) => setTimeout(r, KNOCKOUT_ID_SCAN_BATCH_DELAY_MS));

    if (batchFound === 0) {
      emptyBatches += 1;
      if (emptyBatches >= KNOCKOUT_ID_SCAN_EMPTY_LIMIT) break;
    } else {
      emptyBatches = 0;
    }
  }

  // Save the final scan position.
  await setMetadata('thesportsdb_last_knockout_scan_id', String(scanEnd));

  return discovered;
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

// Fetch individual knockout events by their known external_event_id to refresh
// scores and status.  The round-based API doesn't include knockout matches.
async function refreshKnockoutResults() {
  const knockoutMatches = await db.prepare(`
    SELECT id, match_number, external_event_id, home_score, away_score, status, venue, city
    FROM matches
    WHERE match_number >= 73 AND external_event_id IS NOT NULL
  `).all();

  if (!knockoutMatches.length) return null;

  logTheSportsDb('Knockout refresh: consultando', { count: knockoutMatches.length });

  // Fetch all known knockout events in parallel.
  const results = await Promise.all(
    knockoutMatches.map((m) =>
      fetch(
        `${THESPORTSDB_API_BASE}/${THESPORTSDB_API_KEY}/lookupevent.php?id=${m.external_event_id}`,
        { headers: { Accept: 'application/json' } }
      )
        .then(async (r) => {
          if (!r.ok) return null;
          const text = await r.text();
          // TheSportsDB sometimes returns "error code: 1015" as plain text
          // for non-existent events, even with HTTP 200.
          if (!text || text.startsWith('error code:')) return null;
          try { return JSON.parse(text); } catch { return null; }
        })
        .catch(() => null)
    )
  );

  let scoreUpdates = 0;
  let metaUpdates = 0;

  for (let i = 0; i < knockoutMatches.length; i++) {
    const dbMatch = knockoutMatches[i];
    const result = results[i];
    if (!result?.events?.[0]) continue;
    const ev = result.events[0];

    const apiStatus = String(ev.strStatus || '').trim().toUpperCase();
    let newStatus = dbMatch.status;
    if (apiStatus === 'FT' || apiStatus === 'AET' || apiStatus === 'PEN' || apiStatus === 'AP' || apiStatus.includes('FINISHED')) {
      newStatus = 'finished';
    } else if (apiStatus && apiStatus !== 'NS' && apiStatus !== 'NOT STARTED') {
      newStatus = 'live';
    }

    // Never downgrade a finished match — protects predictions from being cleared.
    if (dbMatch.status === 'finished') {
      newStatus = 'finished';
    }

    const homeScore = ev.intHomeScore != null && ev.intHomeScore !== '' ? parseInt(ev.intHomeScore, 10) : null;
    const awayScore = ev.intAwayScore != null && ev.intAwayScore !== '' ? parseInt(ev.intAwayScore, 10) : null;

    const scoreChanged =
      (homeScore != null && homeScore !== dbMatch.home_score) ||
      (awayScore != null && awayScore !== dbMatch.away_score);
    const statusChanged = newStatus !== dbMatch.status;

    // Always refresh venue/city if DB has them empty and API has data.
    const venueMissing = (!dbMatch.venue || dbMatch.venue === '') && ev.strVenue && ev.strVenue !== '';
    const cityMissing = (!dbMatch.city || dbMatch.city === '') && ev.strCity && ev.strCity !== '';

    logTheSportsDb('Knockout refresh check', {
      match: dbMatch.match_number,
      dbStatus: dbMatch.status,
      apiStatus, newStatus, statusChanged,
      venueMissing, cityMissing,
    });

    if (scoreChanged || statusChanged || venueMissing || cityMissing) {
      const kickoffAt = normalizeKickoffAt(ev.strTimestamp) || buildKickoffAtFromLocal(ev.dateEvent || null, ev.strTime || null);
      const utcMinus3Parts = getUtcMinus3DateParts(kickoffAt);
      const matchDate = utcMinus3Parts?.match_date || ev.dateEvent || null;
      const matchTime = utcMinus3Parts?.match_time || normalizeMatchTime(ev.strTime || null);

      await db.prepare(`
        UPDATE matches SET
          home_score = $1, away_score = $2, status = $3,
          venue = CASE WHEN COALESCE(venue, '') = '' AND $4 != '' THEN $4 ELSE venue END,
          city = CASE WHEN COALESCE(city, '') = '' AND $5 != '' THEN $5 ELSE city END,
          kickoff_at = COALESCE($6, kickoff_at),
          match_date = COALESCE($7, match_date),
          match_time = COALESCE($8, match_time),
          home_flag = CASE WHEN home_flag = '' AND $9 != '' THEN $9 ELSE home_flag END,
          away_flag = CASE WHEN away_flag = '' AND $10 != '' THEN $10 ELSE away_flag END
        WHERE id = $11
      `).run(
        homeScore ?? dbMatch.home_score, awayScore ?? dbMatch.away_score, newStatus,
        ev.strVenue || '', ev.strCity || '',
        kickoffAt, matchDate, matchTime,
        ev.strHomeTeamBadge || '', ev.strAwayTeamBadge || '',
        dbMatch.id
      );

      if (newStatus === 'finished' && (homeScore != null && awayScore != null)) {
        scoreUpdates += await recalculatePointsForMatch(dbMatch.id, homeScore, awayScore);
      } else if (scoreChanged && newStatus !== 'finished' && dbMatch.status !== 'finished') {
        await clearPointsForMatch(dbMatch.id);
      }
      metaUpdates++;
    }
  }

  return scoreUpdates || metaUpdates ? { matches: knockoutMatches.length, scoreUpdates, metaUpdates } : null;
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
    const skipKnockoutScan = syncReason === 'result-refresh';
    const remoteEvents = await fetchWorldCupEvents({ skipKnockoutScan });
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

    // Refresh results for knockout matches that already have an external_event_id.
    // The round-based API doesn't include them, so we fetch them individually.
    const refreshedKnockout = await refreshKnockoutResults();
    logTheSportsDb('Knockout refresh done', { changes: refreshedKnockout ? JSON.stringify(refreshedKnockout) : 'none' });

    const existingMatches = await db.prepare(`
      SELECT id, match_number, external_event_id, home_score, away_score, status, home_team, away_team
      FROM matches
      ORDER BY match_number ASC
    `).all();

    const byExternalId = new Map(existingMatches.filter((match) => match.external_event_id).map((match) => [String(match.external_event_id), match]));
    const byMatchNumber = new Map(existingMatches.map((match) => [match.match_number, match]));

    let inserted = 0;
    let updated = 0;
    let recalculatedPredictions = 0;

    for (const remoteMatch of normalizedMatches) {
      // Match by external_event_id first (most reliable).
      // Only fall back to match_number if the existing slot doesn't already
      // belong to a different event (protects placeholders from being overwritten).
      let existingMatch = byExternalId.get(remoteMatch.external_event_id);
      if (!existingMatch) {
        const byNumber = byMatchNumber.get(remoteMatch.match_number);
        // Use the match_number slot only if it's free or has no external_event_id
        // (i.e. it's a placeholder still waiting for its real event).
        if (byNumber && (!byNumber.external_event_id || byNumber.external_event_id === remoteMatch.external_event_id)) {
          existingMatch = byNumber;
        }
      }

      if (existingMatch) {
        // Protect existing match data: for matches that already have real teams
        // (not placeholders), only update mutable fields (scores, status, schedule)
        // and only fill in fields that are currently empty.
        // Never overwrite team names or match_number for a match that's already set.
        const isPlaceholder = !existingMatch.external_event_id
          || existingMatch.home_team === 'A determinar'
          || !existingMatch.home_team;

        // Determine the effective status: never downgrade from 'finished' to
        // something else, since that would incorrectly clear legitimate points.
        const effectiveStatus = existingMatch.status === 'finished'
          ? 'finished'
          : remoteMatch.status;

        // Only fill team names if the existing slot is a placeholder.
        const effectiveHomeTeam = isPlaceholder
          ? remoteMatch.home_team
          : existingMatch.home_team;
        const effectiveAwayTeam = isPlaceholder
          ? remoteMatch.away_team
          : existingMatch.away_team;

        await db.prepare(`
          UPDATE matches SET
            home_team = $1,
            away_team = $2,
            home_flag = CASE WHEN COALESCE(home_flag, '') = '' AND $3 != '' THEN $3 ELSE home_flag END,
            away_flag = CASE WHEN COALESCE(away_flag, '') = '' AND $4 != '' THEN $4 ELSE away_flag END,
            match_date = COALESCE($5, match_date),
            match_time = COALESCE($6, match_time),
            kickoff_at = COALESCE($7, kickoff_at),
            venue = CASE WHEN COALESCE(venue, '') = '' AND $8 != '' THEN $8 ELSE venue END,
            city = CASE WHEN COALESCE(city, '') = '' AND $9 != '' THEN $9 ELSE city END,
            home_score = $10,
            away_score = $11,
            external_event_id = COALESCE(external_event_id, $12),
            status = $13,
            stage = CASE WHEN stage IS NULL OR stage = '' THEN $14 ELSE stage END,
            group_name = CASE WHEN group_name IS NULL OR group_name = '' THEN $15 ELSE group_name END,
            match_number = match_number
          WHERE id = $16
        `).run(
          effectiveHomeTeam,
          effectiveAwayTeam,
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
          effectiveStatus,
          remoteMatch.stage,
          remoteMatch.group_name,
          existingMatch.id,
        );
        updated += 1;
        byExternalId.set(remoteMatch.external_event_id, { ...existingMatch, external_event_id: remoteMatch.external_event_id });
        byMatchNumber.set(existingMatch.match_number, { ...existingMatch, match_number: existingMatch.match_number });

        // Only recalculate/clear points if scores or status actually changed.
        const scoreChanged = remoteMatch.home_score !== existingMatch.home_score
          || remoteMatch.away_score !== existingMatch.away_score;
        const statusChangedToFinished = effectiveStatus === 'finished'
          && existingMatch.status !== 'finished';

        if (statusChangedToFinished && remoteMatch.home_score != null && remoteMatch.away_score != null) {
          recalculatedPredictions += await recalculatePointsForMatch(
            existingMatch.id, remoteMatch.home_score, remoteMatch.away_score
          );
        } else if (scoreChanged && effectiveStatus !== 'finished' && existingMatch.status !== 'finished') {
          // Scores changed but match still in progress — clear pending points.
          await clearPointsForMatch(existingMatch.id);
        }
        // If nothing changed, leave predictions untouched.
        continue;
      }

      // New event — find an available match_number slot, starting from the
      // suggested one.  Placeholder slots (no external_event_id) are reused
      // instead of skipped.
      let insertNum = remoteMatch.match_number;
      let reuseSlot = null;
      let newMatchId = null;
      while (byMatchNumber.has(insertNum)) {
        const slot = byMatchNumber.get(insertNum);
        if (!slot.external_event_id) {
          // Placeholder slot — reuse it.
          reuseSlot = slot;
          break;
        }
        insertNum++;
      }

      if (reuseSlot) {
        // Reuse the placeholder slot with an UPDATE.
        await db.prepare(`
          UPDATE matches SET
            match_number = $1, stage = $2, group_name = $3,
            home_team = $4, away_team = $5, home_flag = $6, away_flag = $7,
            match_date = $8, match_time = $9, kickoff_at = $10,
            venue = $11, city = $12, home_score = $13, away_score = $14,
            external_event_id = $15, status = $16
          WHERE id = $17
        `).run(
          insertNum,
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
          reuseSlot.id,
        );
        inserted += 1;
        newMatchId = reuseSlot.id;
        byExternalId.set(remoteMatch.external_event_id, { ...reuseSlot, external_event_id: remoteMatch.external_event_id });
        byMatchNumber.set(insertNum, { ...reuseSlot, match_number: insertNum, external_event_id: remoteMatch.external_event_id });
      } else {
        const insertedInfo = await db.prepare(`
          INSERT INTO matches (
            match_number, stage, group_name, home_team, away_team, home_flag, away_flag,
            match_date, match_time, kickoff_at, venue, city, home_score, away_score, external_event_id, status
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
          RETURNING id
        `).get(
          insertNum,
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
        newMatchId = insertedInfo.id;
        byExternalId.set(remoteMatch.external_event_id, { id: newMatchId, match_number: insertNum, external_event_id: remoteMatch.external_event_id });
        byMatchNumber.set(insertNum, { id: newMatchId, match_number: insertNum, external_event_id: remoteMatch.external_event_id });
      }

      if (remoteMatch.status === 'finished') {
        recalculatedPredictions += await recalculatePointsForMatch(newMatchId, remoteMatch.home_score, remoteMatch.away_score);
      } else {
        await clearPointsForMatch(newMatchId);
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
  const runScheduledSync = async (opts = {}) => {
    try {
      const result = await syncWorldCupMatches({ source: 'scheduler', ...opts });
      if (!result.skipped) {
        console.log(`🔄 TheSportsDB sync OK [${result.reason || 'manual'}]: ${result.fetched} partidos, ${result.inserted} nuevos, ${result.updated} actualizados`);
      }
    } catch (error) {
      console.error(`❌ Error en sync programada de TheSportsDB: ${error.message}`);
    }
  };

  // Always force a full sync on startup — this ensures fresh deployments
  // get the latest match data immediately, regardless of when the last
  // scheduled sync ran.
  runScheduledSync({ force: true, reason: 'startup' });
  const timer = setInterval(() => runScheduledSync(), SCHEDULED_SYNC_CHECK_MS);
  if (typeof timer.unref === 'function') timer.unref();
  return timer;
}

module.exports = {
  getSyncStatus,
  startDailyWorldCupSync,
  syncWorldCupMatches,
};
