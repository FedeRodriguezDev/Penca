process.env.THESPORTSDB_LOG_LEVEL = 'debug';
const { syncWorldCupMatches } = require('../services/theSportsDbSync');

(async () => {
  const result = await syncWorldCupMatches({ force: true, source: 'test' });
  console.log('OK fetched=' + result.fetched + ' inserted=' + result.inserted);
})().catch(e => console.error(e.message));
