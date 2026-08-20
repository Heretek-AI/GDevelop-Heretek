#!/usr/bin/env node
/*
 * SonarCloud drift detection for Heretek-AI/GDevelop-Heretek.
 *
 * Queries the SonarCloud REST API for the current open-issue count and
 * compares it against the previous count (recorded in
 * `.sonarcloud-drift-baseline`). Fails if the count has grown by more
 * than `MAX_GROWTH_PCT` percent since the last baseline.
 *
 * The SonarCloud project is public, so no token is needed for read-only
 * queries. The script is safe to run in any CI environment.
 *
 * Usage:
 *   node scripts/sonarcloud-drift.js                 # report current count
 *   node scripts/sonarcloud-drift.js --update-baseline   # record new baseline
 *   node scripts/sonarcloud-drift.js --max-growth-pct=10  # custom threshold
 */

const fs = require('fs');
const path = require('path');
const https = require('https');

const PROJECT_KEY = 'Heretek-AI_GDevelop-Heretek';
const BASELINE_PATH = path.join(__dirname, '..', '.sonarcloud-drift-baseline');
const DEFAULT_MAX_GROWTH_PCT = 10;

function parseArgs(argv) {
  const args = {
    updateBaseline: false,
    maxGrowthPct: DEFAULT_MAX_GROWTH_PCT,
  };
  for (let i = 2; i < argv.length; i++) {
    if (argv[i] === '--update-baseline') args.updateBaseline = true;
    if (argv[i].startsWith('--max-growth-pct=')) {
      args.maxGrowthPct = parseFloat(argv[i].split('=')[1]);
    }
  }
  return args;
}

function fetchOpenCount() {
  return new Promise((resolve, reject) => {
    const url = `https://sonarcloud.io/api/issues/search?componentKeys=${PROJECT_KEY}&issueStatuses=OPEN&ps=1`;
    https
      .get(url, { headers: { 'User-Agent': 'sonarcloud-drift-script' } }, res => {
        if (res.statusCode !== 200) {
          reject(new Error(`HTTP ${res.statusCode}: ${res.statusMessage}`));
          return;
        }
        let body = '';
        res.on('data', chunk => (body += chunk));
        res.on('end', () => {
          try {
            const json = JSON.parse(body);
            resolve(json.total);
          } catch (e) {
            reject(e);
          }
        });
      })
      .on('error', reject);
  });
}

function readBaseline() {
  if (!fs.existsSync(BASELINE_PATH)) return null;
  try {
    const text = fs.readFileSync(BASELINE_PATH, 'utf8').trim();
    return JSON.parse(text);
  } catch (_) {
    return null;
  }
}

function writeBaseline(count) {
  const payload = JSON.stringify(
    {
      count,
      recordedAt: new Date().toISOString(),
      source: 'scripts/sonarcloud-drift.js',
    },
    null,
    2
  );
  fs.writeFileSync(BASELINE_PATH, payload + '\n');
}

async function main() {
  const args = parseArgs(process.argv);
  const count = await fetchOpenCount();
  const baseline = readBaseline();

  console.log(`SonarCloud open-issue count for ${PROJECT_KEY}: ${count}`);
  console.log(`Threshold: ${args.maxGrowthPct}% growth allowed`);

  if (args.updateBaseline) {
    writeBaseline(count);
    console.log(`Wrote baseline to ${BASELINE_PATH}`);
    return;
  }

  if (baseline) {
    const baseCount = baseline.count;
    const delta = count - baseCount;
    const pct = ((delta / baseCount) * 100).toFixed(2);
    console.log(`Baseline: ${baseCount} (recorded ${baseline.recordedAt})`);
    console.log(`Delta: ${delta > 0 ? '+' : ''}${delta} (${pct}%)`);
    if (delta > 0 && parseFloat(pct) > args.maxGrowthPct) {
      console.error(
        `\nERROR: open-issue count grew by ${pct}% (>${args.maxGrowthPct}% threshold)`
      );
      console.error(`       See SONARCLOUD_REMEDIATION_PLAN.md for suppressions.`);
      process.exit(1);
    }
  } else {
    console.log(
      `No baseline found at ${BASELINE_PATH}; skipping growth check.`
    );
    console.log(`Run with --update-baseline to record the current count.`);
  }
}

main().catch(err => {
  console.error(err.stack || err.message || err);
  process.exit(2);
});
