const { syncWorldCupMatches } = require('../services/theSportsDbSync');

async function main() {
  try {
    const result = await syncWorldCupMatches({ force: true, source: 'script' });
    console.log('TheSportsDB sync completada');
    console.log(JSON.stringify(result, null, 2));
  } catch (error) {
    console.error(`Error sincronizando TheSportsDB: ${error.message}`);
    process.exitCode = 1;
  }
}

main();