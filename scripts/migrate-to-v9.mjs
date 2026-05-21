#!/usr/bin/env node
/**
 * migrate-to-v9.mjs — one-shot Phase 0 migration.
 *
 * Reads public/default-data.json (legacy v8 single-file format) and splits it:
 *   - public/data/investors-index.json
 *   - public/data/investors/<id>.json   (one per non-benchmark, non-mine, non-youtuber portfolio)
 *   - public/data/prices.json           (verbatim prices block)
 *   - public/data/meta.json             ({ latestQuarter, lastBackfill, lastStocksUpdate })
 *
 * And rewrites default-data.json into v9 user-config layer:
 *   { version: 'v9', exportedAt, benchmarks[], myPortfolio, tarasGuk,
 *     selectedInvestors[], investorCustomization{} }
 *
 * Idempotent — safe to re-run (overwrites destination).
 * Backs up the legacy file to /tmp/default-data.pre-v9-migration.json first.
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync, copyFileSync, rmSync } from 'node:fs';
import { resolve, dirname } from 'node:path';

const cwd = process.cwd();
const LEGACY = resolve(cwd, 'public/default-data.json');
const BACKUP = '/tmp/default-data.pre-v9-migration.json';
const DATA_DIR = resolve(cwd, 'public/data');
const INVESTORS_DIR = resolve(DATA_DIR, 'investors');

const PROTECTED_IN_USER_CONFIG = new Set(['voo', 'vt', 'mine', 'youtuber']);

// Map portfolio id → DataRoma manager code. Presence here also means kind='guru'
// (the legacy data had several DataRoma investors mis-tagged as kind='custom').
const DATAROMA_CODES = {
  lilu: 'HC',
  buffett: 'BRK',
  'custom-1777150247501': 'GA',     // Greenhaven Road
  'custom-1777225955634': 'RV',      // Robert Vinall
  'custom-1777150124526': 'C',       // Chris Hohn / TCI
  'custom-1777150376264': 'GBP',     // Josh Tarasoff
  'custom-1777227848490': 'AR',      // AltaRock
  'custom-1777228154883': 'AB',      // David Abrams
  'custom-1777225852884': 'VFC',     // Valley Forge
};

// Normalize kinds:
//   - benchmark — VOO, VT (instruments, not investors)
//   - guru      — anyone with a DataRoma profile (the bulk of the base)
//   - custom    — everything else: My Portfolio, blogger picks (Taras Guk),
//                 synthetic aggregates (DataRoma Top 20)
// The legacy 'mine' kind is folded into 'custom' — special UI treatment for the
// user's own portfolio is keyed on id === 'mine' in the component, not kind.
const normalizeKind = (p) => {
  if (p.kind === 'benchmark') return 'benchmark';
  if (DATAROMA_CODES[p.id]) return 'guru';
  return 'custom';
};

// Legacy ids like 'custom-1777150247501' are timestamps — replace them with
// human-readable slugs. Applied to filename, id field inside the file, index
// entry, selectedInvestors[] members, and investorCustomization{} keys.
const ID_RENAME = {
  'custom-1777150247501': 'greenhaven',
  'custom-1777225955634': 'robert-vinall',
  'custom-1777150124526': 'chris-hohn',
  'custom-1777150376264': 'josh-tarasoff',
  'custom-1777227848490': 'altarock',
  'custom-1777228154883': 'david-abrams',
  'custom-1777225852884': 'valley-forge',
};
const newId = (id) => ID_RENAME[id] || id;

const ensureDir = (p) => { mkdirSync(p, { recursive: true }); };
const writeJson = (path, obj) => {
  ensureDir(dirname(path));
  writeFileSync(path, JSON.stringify(obj, null, 2) + '\n');
};

if (!existsSync(LEGACY)) {
  console.error(`ERROR: ${LEGACY} does not exist.`);
  process.exit(1);
}

console.log(`Reading ${LEGACY}…`);
const raw = JSON.parse(readFileSync(LEGACY, 'utf8'));

console.log(`Backing up to ${BACKUP}…`);
copyFileSync(LEGACY, BACKUP);

// Clean previously-generated investor files so renamed ids don't leave stale orphans.
if (existsSync(INVESTORS_DIR)) {
  rmSync(INVESTORS_DIR, { recursive: true, force: true });
}
ensureDir(INVESTORS_DIR);

const portfolios = raw.portfolios || [];
const prices = raw.prices || {};

// --- Derive latestQuarter from existing investor data ---
// The newest asOf among history snapshots across all investors. If all
// portfolios have current holdings (no history), there's no quarter to claim;
// default to one-quarter-after-newest-history (matches computeSeries' implicit
// current asOf).
let newestHistoryAsOf = null;
for (const p of portfolios) {
  for (const s of (p.history || [])) {
    if (!newestHistoryAsOf || s.asOf > newestHistoryAsOf) newestHistoryAsOf = s.asOf;
  }
}
// Current holdings live one quarter after the newest history asOf.
const advanceQuarter = (iso) => {
  if (!iso) return null;
  const [y, m, d] = iso.split('-').map(Number);
  const nm = m + 3;
  const ny = y + Math.floor((nm - 1) / 12);
  const nmm = ((nm - 1) % 12) + 1;
  const lastDay = new Date(ny, nmm, 0).getDate();
  return `${ny}-${String(nmm).padStart(2,'0')}-${String(lastDay).padStart(2,'0')}`;
};
const latestQuarter = advanceQuarter(newestHistoryAsOf) || newestHistoryAsOf;
console.log(`Derived latestQuarter: ${latestQuarter}`);

// --- Split portfolios ---
const investorEntries = [];           // for investors-index.json
const selectedInvestors = [];          // for default-data.json (currently visible ones)
const investorCustomization = {};      // for default-data.json
const benchmarks = [];
let myPortfolio = null;
let tarasGuk = null;

for (const p of portfolios) {
  if (p.id === 'voo' || p.id === 'vt') {
    benchmarks.push({ ...p, kind: 'benchmark' });
    continue;
  }
  if (p.id === 'mine') {
    // Legacy kind='mine' → 'custom'. UI keys the YOU badge off id === 'mine'.
    myPortfolio = { ...p, kind: 'custom' };
    continue;
  }
  if (p.id === 'youtuber') {
    tarasGuk = { ...p, kind: normalizeKind(p) };
    continue;
  }

  // Investor portfolio — split out to its own file (with renamed id if applicable)
  const kind = normalizeKind(p);
  const id = newId(p.id);
  const dataromaCode = DATAROMA_CODES[p.id] || null;

  // Special-case the DataRoma all-guru consensus page (the "top 20" portfolio).
  // It's not an individual manager — it's an aggregate computed from every
  // guru on DataRoma. INVESTORS-BACKFILL recognizes primarySource='dataroma-aggregate'
  // and fetches from /m/g/portfolio.php (top N rows by % of Portfolio).
  const isAggregate = (p.id === 'dataroma-top20');
  const primarySource = dataromaCode ? 'dataroma'
                       : isAggregate ? 'dataroma-aggregate'
                       : null;
  const link = dataromaCode
    ? `https://www.dataroma.com/m/holdings.php?m=${dataromaCode}`
    : isAggregate
      ? 'https://www.dataroma.com/m/g/portfolio.php'
      : null;
  const sourceCodes = dataromaCode ? { dataroma: dataromaCode }
                     : isAggregate ? { 'dataroma-aggregate': 'top-20' }
                     : {};

  // history range
  const asofs = (p.history || []).map(s => s.asOf).sort();
  const historyFrom = asofs[0] || null;
  // The current holdings' implicit asOf = one quarter after the last history entry.
  const historyTo = asofs.length
    ? advanceQuarter(asofs[asofs.length - 1])
    : null;

  // Index entry — display metadata only, no holdings
  investorEntries.push({
    id,
    name: p.name,
    subtitle: p.subtitle || '',
    kind,                                                     // 'guru' | 'custom'
    primarySource,
    sourceCodes,
    link,
    aum: null,                                                // Goal/manual fills later
    country: null,
    tags: isAggregate ? ['aggregate'] : [],
    historyRange: { from: historyFrom, to: historyTo },
    currentHoldingsCount: (p.holdings || []).length,
  });

  // Per-investor file — full holdings + history
  const file = {
    id,
    holdings: p.holdings || [],
    history: p.history || [],
    _provenance: {
      primarySource,
      lastFetchedAt: null,                                    // unknown — pre-migration
      lastFetchedFrom: link,
      migratedFromLegacy: true,
      legacyId: p.id !== id ? p.id : undefined,
    },
  };
  writeJson(resolve(INVESTORS_DIR, `${id}.json`), file);

  // User-config: customization (color/visible/locked/order) + selection
  investorCustomization[id] = {
    color: p.color,
    visible: p.visible,
    locked: p.locked,
  };
  selectedInvestors.push(id);  // everyone currently in the portfolio is "selected"
}

// --- Write base files ---
writeJson(resolve(DATA_DIR, 'investors-index.json'), {
  version: 'v9',
  investors: investorEntries,
});

writeJson(resolve(DATA_DIR, 'prices.json'), prices);

writeJson(resolve(DATA_DIR, 'meta.json'), {
  version: 'v9',
  latestQuarter,
  lastBackfillAt: null,
  lastStocksUpdateAt: null,
  generatedBy: 'migrate-to-v9.mjs',
  generatedAt: new Date().toISOString(),
});

// --- Rewrite default-data.json in v9 format ---
const v9UserConfig = {
  version: 'v9',
  exportedAt: new Date().toISOString(),
  benchmarks,
  myPortfolio,
  tarasGuk,
  selectedInvestors,
  investorCustomization,
};
writeJson(LEGACY, v9UserConfig);

// --- Summary ---
console.log(`
✓ Migration complete:
  - public/data/investors-index.json   (${investorEntries.length} investors)
  - public/data/investors/             (${investorEntries.length} files)
  - public/data/prices.json            (${Object.keys(prices).length} tickers)
  - public/data/meta.json              (latestQuarter: ${latestQuarter})
  - public/default-data.json           (v9 user config)
  - Backup of legacy file: ${BACKUP}
`);
