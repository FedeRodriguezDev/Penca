// One-shot script: scan TheSportsDB for all knockout events and upsert them.
const https = require('https');
const { db, normalizeKickoffAt, buildKickoffAtFromLocal, getUtcMinus3DateParts, normalizeMatchTime } = require('../db/database');

const API = 'https://www.thesportsdb.com/api/v1/json/123';

function get(url) {
  return new Promise((resolve) => {
    https.get(url, { headers: { Accept: 'application/json' } }, (res) => {
      let data = '';
      res.on('data', (c) => (data += c));
      res.on('end', () => {
        try { resolve(JSON.parse(data)); } catch (e) { resolve(null); }
      });
    }).on('error', () => resolve(null));
  });
}

const TEAM_TRANSLATIONS = {
  Algeria: 'Argelia', Argentina: 'Argentina', Australia: 'Australia', Austria: 'Austria',
  Belgium: 'Bélgica', 'Bosnia-Herzegovina': 'Bosnia y Herzegovina', 'Bosnia and Herzegovina': 'Bosnia y Herzegovina',
  Brazil: 'Brasil', Cameroon: 'Camerún', Canada: 'Canadá', 'Cape Verde': 'Cabo Verde',
  Colombia: 'Colombia', Croatia: 'Croacia', Curacao: 'Curazao', 'Curaçao': 'Curazao',
  'Costa Rica': 'Costa Rica', 'Czech Republic': 'República Checa', Denmark: 'Dinamarca',
  Ecuador: 'Ecuador', Egypt: 'Egipto', England: 'Inglaterra', France: 'Francia',
  Germany: 'Alemania', Ghana: 'Ghana', Haiti: 'Haití', Honduras: 'Honduras',
  Hungary: 'Hungría', Iran: 'Irán', Iraq: 'Irak', 'Ivory Coast': 'Costa de Marfil',
  Japan: 'Japón', Jordan: 'Jordania', Mexico: 'México', Morocco: 'Marruecos',
  Netherlands: 'Países Bajos', 'New Zealand': 'Nueva Zelanda', Nigeria: 'Nigeria',
  Norway: 'Noruega', Panama: 'Panamá', Paraguay: 'Paraguay', Poland: 'Polonia',
  Portugal: 'Portugal', 'DR Congo': 'República Democrática del Congo', Qatar: 'Qatar',
  'Saudi Arabia': 'Arabia Saudita', Scotland: 'Escocia', Senegal: 'Senegal',
  Serbia: 'Serbia', Slovakia: 'Eslovaquia', Slovenia: 'Eslovenia',
  'South Africa': 'Sudáfrica', 'South Korea': 'Corea del Sur', Spain: 'España',
  Sweden: 'Suecia', Switzerland: 'Suiza', Tunisia: 'Túnez', Turkey: 'Turquía',
  Ukraine: 'Ucrania', Uruguay: 'Uruguay', USA: 'Estados Unidos', 'United States': 'Estados Unidos',
  Uzbekistan: 'Uzbekistán', Venezuela: 'Venezuela',
};

function translate(name) { return TEAM_TRANSLATIONS[name] || name; }

function getStage(matchNumber) {
  if (matchNumber <= 72) return 'Fase de Grupos';
  if (matchNumber <= 88) return 'Ronda de 32';
  if (matchNumber <= 96) return 'Octavos de Final';
  if (matchNumber <= 100) return 'Cuartos de Final';
  if (matchNumber <= 102) return 'Semifinal';
  if (matchNumber === 103) return 'Tercer Puesto';
  return 'Final';
}

function mapStatus(s) {
  const n = String(s || '').trim().toUpperCase();
  if (n === 'FT' || n === 'AET' || n === 'PEN' || n.includes('FINISHED')) return 'finished';
  if (n === 'NS' || n === 'NOT STARTED' || !n) return 'upcoming';
  return 'live';
}

async function main() {
  // Scan ranges where knockout events live — cast a wide net
  const ranges = [
    [2391770, 2391830],
    [2499600, 2503200],
    [2461120, 2461200],
  ];

  const found = [];
  const BATCH = 5;
  const BATCH_DELAY = 200;

  for (const [from, to] of ranges) {
    for (let batchStart = from; batchStart <= to; batchStart += BATCH) {
      const batchIds = [];
      for (let id = batchStart; id < batchStart + BATCH && id <= to; id++) {
        batchIds.push(id);
      }

      const results = await Promise.all(
        batchIds.map((id) => get(`${API}/lookupevent.php?id=${id}`))
      );

      for (const r of results) {
        if (!r?.events?.[0]) continue;
        const e = r.events[0];
        if (String(e.idLeague) !== '4429') continue;
        if (!e.dateEvent || e.dateEvent < '2026-06-27' || e.dateEvent > '2026-07-19') continue;
        // Deduplicate
        if (found.find((f) => f.id === String(e.idEvent))) continue;
        found.push({
          id: String(e.idEvent),
          date: e.dateEvent,
          time: e.strTime || '',
          home: e.strHomeTeam || '',
          away: e.strAwayTeam || '',
          status: e.strStatus,
          venue: e.strVenue || '',
          city: e.strCity || '',
          badgeH: e.strHomeTeamBadge || '',
          badgeA: e.strAwayTeamBadge || '',
          timestamp: e.strTimestamp || '',
        });
      }

      process.stderr.write('.');
      if (found.length >= 35) break;
      await new Promise((r) => setTimeout(r, BATCH_DELAY));
    }
    if (found.length >= 35) break;
  }

  // Sort by date/time
  found.sort((a, b) => {
    const sa = a.timestamp || `${a.date}T${a.time || '00:00:00'}`;
    const sb = b.timestamp || `${b.date}T${b.time || '00:00:00'}`;
    return sa.localeCompare(sb);
  });

  console.log('\nEncontrados: ' + found.length + ' eventos de eliminatoria');

  // Determine match numbers: start from the highest existing match_number + 1,
  // or from the last group-stage match + 1.
  const maxRow = await db.prepare(
    'SELECT MAX(match_number) AS mx FROM matches WHERE match_number <= 72'
  ).get();
  let nextNum = (maxRow?.mx || 72) + 1;

  let inserted = 0;
  let updated = 0;

  for (const ev of found) {
    const kickoffAt =
      normalizeKickoffAt(ev.timestamp) ||
      buildKickoffAtFromLocal(ev.date, ev.time);
    const utcMinus3Parts = getUtcMinus3DateParts(kickoffAt);
    const matchDate = utcMinus3Parts?.match_date || ev.date;
    const matchTime = utcMinus3Parts?.match_time || normalizeMatchTime(ev.time);
    const status = mapStatus(ev.status);
    const homeTeam = translate(ev.home);
    const awayTeam = translate(ev.away);
    const stage = getStage(nextNum);

    // Check if already exists by external_event_id
    let existing = null;
    if (ev.id) {
      existing = await db.prepare(
        'SELECT id, match_number FROM matches WHERE external_event_id = $1'
      ).get(ev.id);
    }
    // Also check by match_number if not found
    if (!existing) {
      existing = await db.prepare(
        'SELECT id, match_number FROM matches WHERE match_number = $1'
      ).get(nextNum);
    }

    if (existing) {
      // Update existing match but preserve its original match_number
      await db.prepare(`
        UPDATE matches SET
          stage = $1, home_team = $2, away_team = $3,
          home_flag = $4, away_flag = $5, match_date = $6, match_time = $7,
          kickoff_at = $8, venue = $9, city = $10, external_event_id = $11, status = $12
        WHERE id = $13
      `).run(
        stage, homeTeam, awayTeam,
        ev.badgeH, ev.badgeA, matchDate, matchTime,
        kickoffAt, ev.venue, ev.city, ev.id, status,
        existing.id
      );
      updated++;
      console.log(`  UPD #${existing.match_number} ${homeTeam} vs ${awayTeam} | ${matchDate} ${matchTime}`);
    } else {
      // Find next available match_number (skip placeholders that already have real teams)
      let assignedNum = nextNum;
      while (true) {
        const conflict = await db.prepare(
          'SELECT id FROM matches WHERE match_number = $1'
        ).get(assignedNum);
        if (!conflict) break;
        // If the slot has "A determinar", reuse it; otherwise skip
        const slot = await db.prepare(
          "SELECT id, home_team FROM matches WHERE match_number = $1 AND home_team = 'A determinar'"
        ).get(assignedNum);
        if (slot) {
          // Reuse this slot
          await db.prepare(`
            UPDATE matches SET stage=$1, home_team=$2, away_team=$3, home_flag=$4, away_flag=$5,
              match_date=$6, match_time=$7, kickoff_at=$8, venue=$9, city=$10, external_event_id=$11, status=$12
            WHERE id=$13
          `).run(stage, homeTeam, awayTeam, ev.badgeH, ev.badgeA, matchDate, matchTime,
            kickoffAt, ev.venue, ev.city, ev.id, status, slot.id);
          inserted++;
          console.log(`  NEW #${assignedNum} ${homeTeam} vs ${awayTeam} | ${matchDate} ${matchTime} (reused placeholder)`);
          assignedNum = -1; // signal done
          break;
        }
        assignedNum++;
      }
      if (assignedNum > 0) {
        await db.prepare(`
          INSERT INTO matches (match_number, stage, home_team, away_team, home_flag, away_flag,
            match_date, match_time, kickoff_at, venue, city, external_event_id, status)
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
        `).run(assignedNum, stage, homeTeam, awayTeam, ev.badgeH, ev.badgeA, matchDate, matchTime,
          kickoffAt, ev.venue, ev.city, ev.id, status);
        inserted++;
        console.log(`  NEW #${assignedNum} ${homeTeam} vs ${awayTeam} | ${matchDate} ${matchTime}`);
      }
      nextNum = Math.max(nextNum, assignedNum > 0 ? assignedNum + 1 : nextNum + 1);
    }
  }

  // Update scan position
  await db.prepare(`
    INSERT INTO app_metadata (key, value, updated_at)
    VALUES ('thesportsdb_last_knockout_scan_id', $1, CURRENT_TIMESTAMP)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = CURRENT_TIMESTAMP
  `).run('2503000');

  console.log(`\ninserted=${inserted} updated=${updated}`);

  // Show totals
  const totals = await db.prepare(
    'SELECT stage, COUNT(*) as cnt FROM matches GROUP BY stage ORDER BY MIN(match_number)'
  ).all();
  console.log('\nTotales por fase:');
  totals.forEach((r) => console.log(`  ${r.stage}: ${r.cnt}`));
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
