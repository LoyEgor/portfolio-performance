#!/usr/bin/env node
/**
 * split-prices.mjs — migrate monolithic public/data/prices.json into per-year
 * files: public/data/prices/<YYYY>.json. Also bumps meta.json with
 *   "priceYears": { "from": <int>, "to": <int> }
 *
 * Why: as the base grows (~70 DataRoma investors × 10y of monthly prices ≈
 *      2-3MB), a single file becomes painful to read in editors and forces
 *      every STOCKS-UPDATE turn that peeks at it to load the whole thing into
 *      context. Year-split keeps the dominant monthly-update workflow touching
 *      one ~250KB file (current year only).
 *
 * Idempotent. Safe to re-run:
 *   - If prices.json exists → migrate it, delete it.
 *   - If prices.json is gone AND prices/<year>.json files exist AND
 *     meta.priceYears is set → no-op, exit 0.
 *   - If state is inconsistent (both exist, or neither, or priceYears missing) →
 *     fail loudly with a clear message.
 *
 * Snapshot saved to /tmp/prices.pre-split.json before mutation.
 *
 * Run from project root:
 *   node scripts/split-prices.mjs
 */

import {
  readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync, copyFileSync, rmSync,
} from 'node:fs';
import { resolve } from 'node:path';

const cwd = process.cwd();
const DATA_DIR = resolve(cwd, 'public/data');
const MONOLITH = resolve(DATA_DIR, 'prices.json');
const PRICES_DIR = resolve(DATA_DIR, 'prices');
const META = resolve(DATA_DIR, 'meta.json');
const SNAPSHOT = '/tmp/prices.pre-split.json';

function log(...args) { console.log('[split-prices]', ...args); }
function fail(msg) { console.error('[split-prices] FAIL:', msg); process.exit(1); }

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}
function writeJson(path, obj) {
  // 2-space indent matches the rest of the codebase's JSON files.
  writeFileSync(path, JSON.stringify(obj, null, 2) + '\n');
}

function listYearFiles() {
  if (!existsSync(PRICES_DIR)) return [];
  return readdirSync(PRICES_DIR)
    .filter((f) => /^\d{4}\.json$/.test(f))
    .map((f) => f.slice(0, 4));
}

const monolithExists = existsSync(MONOLITH);
const yearFiles = listYearFiles();
const meta = existsSync(META) ? readJson(META) : null;
const hasPriceYears = !!(meta && meta.priceYears && meta.priceYears.from && meta.priceYears.to);

// ---------- Branch: already migrated ----------
if (!monolithExists && yearFiles.length > 0 && hasPriceYears) {
  log(`already migrated: ${yearFiles.length} year files (${meta.priceYears.from}–${meta.priceYears.to}), meta.priceYears set. No-op.`);
  process.exit(0);
}

// ---------- Inconsistent states ----------
if (monolithExists && yearFiles.length > 0) {
  fail(`both ${MONOLITH} and ${PRICES_DIR}/ exist. Resolve manually (likely a half-done migration).`);
}
if (!monolithExists && yearFiles.length === 0) {
  fail(`neither ${MONOLITH} nor any ${PRICES_DIR}/<year>.json exists. Nothing to migrate.`);
}
if (!monolithExists && yearFiles.length > 0 && !hasPriceYears) {
  fail(`year files exist but meta.priceYears is missing/empty. Run with the monolith back in place, or set meta.priceYears manually.`);
}

// ---------- Migrate ----------
if (!meta) fail(`meta.json missing — refusing to proceed without it.`);

log(`reading monolith ${MONOLITH}`);
const prices = readJson(MONOLITH);

log(`saving snapshot to ${SNAPSHOT}`);
copyFileSync(MONOLITH, SNAPSHOT);

// Group: byYear[YYYY][ticker][YYYY-MM-01] = price
const byYear = new Map();
let totalTickers = 0;
let totalPoints = 0;
for (const [ticker, dateMap] of Object.entries(prices)) {
  if (!dateMap || typeof dateMap !== 'object') {
    log(`  skip ${ticker}: not an object`);
    continue;
  }
  totalTickers++;
  for (const [date, price] of Object.entries(dateMap)) {
    const m = /^(\d{4})-\d{2}-01$/.exec(date);
    if (!m) {
      log(`  skip non-monthly key ${ticker}/${date}`);
      continue;
    }
    const year = m[1];
    if (!byYear.has(year)) byYear.set(year, {});
    const bucket = byYear.get(year);
    if (!bucket[ticker]) bucket[ticker] = {};
    bucket[ticker][date] = price;
    totalPoints++;
  }
}

const years = [...byYear.keys()].map(Number).sort((a, b) => a - b);
if (years.length === 0) fail('no valid YYYY-MM-01 keys found in prices.json');

log(`grouped ${totalPoints} datapoints across ${totalTickers} tickers into ${years.length} year-files`);

// Create prices/ dir and write each year, sorted internally for stable diffs.
mkdirSync(PRICES_DIR, { recursive: true });
for (const year of years) {
  const bucket = byYear.get(String(year));
  // Sort tickers alphabetically, dates descending (newest first — matches what
  // STOCKS-UPDATE.md's natural append-newest order produces).
  const sorted = {};
  for (const ticker of Object.keys(bucket).sort()) {
    const dateMap = bucket[ticker];
    const sortedDates = Object.keys(dateMap).sort().reverse();
    sorted[ticker] = {};
    for (const d of sortedDates) sorted[ticker][d] = dateMap[d];
  }
  const path = resolve(PRICES_DIR, `${year}.json`);
  writeJson(path, sorted);
  log(`  wrote ${path} (${Object.keys(sorted).length} tickers)`);
}

// Update meta.priceYears.
const newMeta = {
  ...meta,
  priceYears: { from: years[0], to: years[years.length - 1] },
};
writeJson(META, newMeta);
log(`updated meta.priceYears = { from: ${years[0]}, to: ${years[years.length - 1]} }`);

// Delete the monolith.
rmSync(MONOLITH);
log(`removed ${MONOLITH}`);

log(`done. Snapshot at ${SNAPSHOT}.`);
