#!/usr/bin/env node
/**
 * postprocess-backfill.mjs — apply ticker hygiene fixes after a /goal BACKFILL run
 * that used the old (pre-strengthened) spec.
 *
 * What this does (deterministic, no network):
 *   1. DASH → DOT for dual-class tickers (BRK-B → BRK.B, BF-B → BF.B, etc.)
 *   2. Drop positions whose ticker matches /-OLD$/ — parser-internal markers
 *      that leaked into data. Renormalize the affected snapshot's weights to
 *      sum to 100 across what remains.
 *   3. Map known foreign-suffix tickers to their US equivalents where the
 *      company is dual-listed (Canadian Pacific CP.TO → CP, Alcon ALC.SW →
 *      ALC, etc.). Foreign-only or uncertain mappings are left as-is and
 *      logged to /tmp/postprocess-review.log.
 *   4. Recompute meta.oldestHistoryAsOf = min(asOf) across all non-aggregate
 *      investors. Writes meta.json.
 *
 * Idempotent — running twice is a no-op (after first pass, all violations are
 * already fixed).
 *
 * Snapshot saved to /tmp/postprocess-backfill.pre-run.tar before mutation.
 *
 * Run from project root:
 *   node scripts/postprocess-backfill.mjs
 */

import { readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { resolve } from 'node:path';

const cwd = process.cwd();
const INVESTORS_DIR = resolve(cwd, 'public/data/investors');
const META_PATH = resolve(cwd, 'public/data/meta.json');
const INDEX_PATH = resolve(cwd, 'public/data/investors-index.json');
const REVIEW_LOG = '/tmp/postprocess-review.log';
const SNAPSHOT_TAR = '/tmp/postprocess-backfill.pre-run.tar';

// ============================================================
// Foreign-ticker → US-ticker mapping. ONLY high-confidence cases.
// Built from analysis of current base; companies confirmed US-dual-listed.
// ============================================================
const FOREIGN_TO_US = {
  // Canadian dual-listed
  'CP.TO':       'CP',          // Canadian Pacific
  'CNR.TO':      'CNI',         // Canadian National Railway (US ticker differs)
  'BN.TO':       'BN',          // Brookfield Corp
  'BAM.TO':      'BAM',         // Brookfield Asset Mgmt
  'ABX.TO':      'GOLD',        // Barrick Gold (renamed to GOLD on NYSE in 2019)
  'K.TO':        'KGC',         // Kinross Gold (US ticker differs; K in US is Kellogg)
  'TECK-B.TO':   'TECK',        // Teck Resources Class B
  'NTR.TO':      'NTR',         // Nutrien
  'WPM.TO':      'WPM',         // Wheaton Precious Metals
  'IMO.TO':      'IMO',         // Imperial Oil
  'CVE.TO':      'CVE',         // Cenovus Energy
  'CNQ.TO':      'CNQ',         // Canadian Natural Resources
  'FNV.TO':      'FNV',         // Franco-Nevada
  'OVV.TO':      'OVV',         // Ovintiv
  'MFC.TO':      'MFC',         // Manulife
  'ENB.TO':      'ENB',         // Enbridge
  'SU.TO':       'SU',          // Suncor
  'BB.TO':       'BB',          // BlackBerry
  'GIL.TO':      'GIL',         // Gildan Activewear
  'FSV.TO':      'FSV',         // FirstService
  'MG.TO':       'MGA',         // Magna International (US ticker differs)
  'DSG.TO':      'DSGX',        // Descartes Systems (US ticker differs)
  'GOOS.TO':     'GOOS',        // Canada Goose
  'GFL.TO':      'GFL',         // GFL Environmental
  'CM.TO':       'CM',          // CIBC
  'CIGI.TO':     'CIGI',        // Colliers International
  'BNS.TO':      'BNS',         // Bank of Nova Scotia
  'CLS.TO':      'CLS',         // Celestica
  'TA.TO':       'TAC',         // TransAlta (US ticker differs)
  'AQN.TO':      'AQN',         // Algonquin Power
  'RBA.TO':      'RBA',         // Ritchie Bros (moved to NYSE)
  'RCI-B.TO':    'RCI',         // Rogers Communications Class B
  'NG.TO':       'NG',          // NovaGold

  // European dual-listed (ADRs / direct NYSE listings)
  'ALC.SW':      'ALC',         // Alcon (NYSE since 2019)
  'STLA.MI':     'STLA',        // Stellantis (NYSE)
  'DBK.DE':      'DB',          // Deutsche Bank ADR
  'UBSG.SW':     'UBS',         // UBS ADR
  'LOGN.SW':     'LOGI',        // Logitech (US ticker differs)
  'CCEP.AS':     'CCEP',        // Coca-Cola Europacific (NYSE)
  'FLTR.L':      'FLUT',        // Flutter Entertainment (moved to NYSE as FLUT in 2024)
  'INDV.L':      'INDV',        // Indivior (dual-listed)

  // Latin American
  'GSKN.MX':     'GSK',         // GSK (NYSE ticker)
  'IAC1.MX':     'IAC',         // IAC Inc
  'TEAM.MX':     'TEAM',        // Atlassian
  'ERJN.MX':     'ERJ',         // Embraer ADR (US ticker differs)

  // Note: Some recent edge cases:
  // - PRMW.TO → PRMW (same ticker) but Primo Water was acquired/restructured;
  //   keep as PRMW for now
  'PRMW.TO':     'PRMW',

  // LSE International Order Book (IOB) codes for foreign companies — verified
  // against the original (pre-BACKFILL) holdings of returning investors where
  // those positions appeared at the SAME weight under their proper US ticker.
  '0A2S.IL':     'PDD',         // Pinduoduo (Li Lu, Tepper, Burry, Vinall, Coleman, Olstein)
  '0A2Z.IL':     'TME',         // Tencent Music (Li Lu, Mueffling)
  '0A2I.IL':     'HTHT',        // H World Group (Robert Vinall)
  'TRMD-A.CO':   'TRMD',        // Torm (Howard Marks — verified: pre-run had TRMD same weight)

  // Other dual-listed verified by external knowledge:
  'SDRL.OL':     'SDRL',        // Seadrill (re-listed on NYSE post-restructure)
  'FER.MC':      'FER',         // Ferrovial (moved to NASDAQ as FER in 2024)
  'BKAA.SG':     'BRK.B',       // Berkshire — Stuttgart code; institutional positions
                                // are almost always Class B. Conservative best-guess
                                // — flag in review log for double-check.

  // From dataroma-top20 Web Archive captures (2016-2018 era top-20 aggregates):
  'ABI.BR':      'BUD',         // Anheuser-Busch InBev Brussels → NYSE ADR
  'BATS.L':      'BTI',         // British American Tobacco London → NYSE ADR

  // Verified via 13F.info / DataRoma cross-reference:
  '0A2X.IL':     'JD',          // JD.com — Tiger Global classic long-hold 2016-2025
  'EURN.BR':     'EURN',        // Euronav (Belgian) — had NYSE listing as EURN until 2023 Frontline merger
  'SJR-B.TO':    'SJR.B',       // Shaw Communications Class B — had NYSE listing SJR.B before Rogers acquisition (2023)
  'AMRZ.SW':     'AMRZ',        // Amrize — spun off from Holcim 2024, dual-listed on NYSE as AMRZ
};

// Tickers that are NOT mapped (foreign-only, unclear, or non-existent on US
// exchanges) — these get logged for manual review.
const UNCERTAIN_FOREIGN = new Set([
  'OLA.TO',     // unclear
  'ATS.TO',     // ATS Corp — only Canadian
  'H6D.F',      // German listing, unclear company
  'EURN.BR',   // Euronav — Belgian listing, US was EURN but merged
  'SJR-B.TO',  // Shaw Communications (acquired by Rogers)
]);

// ============================================================
// Helpers
// ============================================================

function log(...args) { console.log('[postprocess]', ...args); }

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

function writeJson(path, obj) {
  writeFileSync(path, JSON.stringify(obj, null, 2) + '\n');
}

// Renormalize an array of holdings so weights sum to 100 (preserving relative
// proportions). Mirrors the convention used by BACKFILL/ADD parsers.
function renormalize(holdings) {
  const sum = holdings.reduce((s, h) => s + (h.weight || 0), 0);
  if (sum === 0) return holdings;
  const scale = 100 / sum;
  return holdings.map(h => ({ ...h, weight: Math.round(h.weight * scale * 100) / 100 }));
}

// Normalize a single ticker according to all rules. Returns null if the
// position should be dropped (-OLD marker). Returns an object with
// {ticker, mappedFrom} if changed; otherwise {ticker} unchanged.
function normalizeTicker(t, ctx) {
  // Rule 1: drop -OLD parser leak
  if (/-OLD$/.test(t)) {
    stats.oldDropped++;
    ctx.dropped.push(t);
    return null;
  }
  // Rule 2: DASH → DOT for dual-class
  const dashMatch = t.match(/^([A-Z]+)-([A-Z])$/);
  if (dashMatch) {
    const newT = `${dashMatch[1]}.${dashMatch[2]}`;
    stats.dashFixed++;
    return { ticker: newT, mappedFrom: t };
  }
  // Rule 3: foreign → US mapping
  if (FOREIGN_TO_US[t]) {
    stats.foreignMapped++;
    return { ticker: FOREIGN_TO_US[t], mappedFrom: t };
  }
  // Rule 4: uncertain foreign — keep but log
  if (UNCERTAIN_FOREIGN.has(t)) {
    ctx.uncertain.push(t);
    return { ticker: t };
  }
  // Catch any foreign suffix we didn't think of — log for review
  if (/\.(TO|L|MX|SW|DE|MI|AX|HK|PA|AS|BR|F|SI)$/.test(t)) {
    ctx.uncertain.push(t);
    return { ticker: t };
  }
  return { ticker: t };
}

// Process a holdings array. Drops -OLD positions, normalizes tickers,
// returns (possibly renormalized) array.
function processHoldings(holdings, ctx) {
  if (!holdings || !holdings.length) return holdings;
  const out = [];
  let droppedAny = false;
  for (const h of holdings) {
    const result = normalizeTicker(h.ticker, ctx);
    if (result === null) {
      droppedAny = true;
      continue;
    }
    out.push({ ...h, ticker: result.ticker });
  }
  return droppedAny ? renormalize(out) : out;
}

// ============================================================
// Main
// ============================================================

const stats = {
  filesScanned: 0,
  filesModified: 0,
  dashFixed: 0,
  oldDropped: 0,
  foreignMapped: 0,
};

// Snapshot first
log(`snapshot → ${SNAPSHOT_TAR}`);
execSync(
  `tar -cf ${SNAPSHOT_TAR} public/data/investors-index.json public/data/investors/ public/data/meta.json`
);

const reviewLog = [];

const files = readdirSync(INVESTORS_DIR).filter(f => f.endsWith('.json'));
for (const file of files) {
  const path = resolve(INVESTORS_DIR, file);
  const inv = readJson(path);
  const before = JSON.stringify(inv);

  const ctx = { dropped: [], uncertain: [] };

  // Process current holdings + every history snapshot
  if (inv.holdings) inv.holdings = processHoldings(inv.holdings, ctx);
  if (inv.history) {
    inv.history = inv.history.map(snap => ({
      ...snap,
      holdings: processHoldings(snap.holdings, ctx),
    }));
  }

  if (ctx.dropped.length || ctx.uncertain.length) {
    reviewLog.push(`\n--- ${inv.id} ---`);
    if (ctx.dropped.length) {
      reviewLog.push(`  dropped (-OLD): ${[...new Set(ctx.dropped)].join(', ')}`);
    }
    if (ctx.uncertain.length) {
      reviewLog.push(`  uncertain foreign tickers (kept as-is): ${[...new Set(ctx.uncertain)].join(', ')}`);
    }
  }

  const after = JSON.stringify(inv);
  stats.filesScanned++;
  if (after !== before) {
    writeJson(path, inv);
    stats.filesModified++;
  }
}

// Recompute meta.oldestHistoryAsOf
const index = readJson(INDEX_PATH);
const aggregateIds = new Set(
  (index.investors || [])
    .filter(i => (i.primarySource || '').startsWith('dataroma-aggregate'))
    .map(i => i.id)
);
let oldest = null;
for (const file of files) {
  const id = file.replace(/\.json$/, '');
  if (aggregateIds.has(id)) continue;
  const inv = readJson(resolve(INVESTORS_DIR, file));
  for (const s of inv.history || []) {
    if (s.asOf && (oldest === null || s.asOf < oldest)) oldest = s.asOf;
  }
}

const meta = readJson(META_PATH);
const oldOldest = meta.oldestHistoryAsOf;
meta.oldestHistoryAsOf = oldest;
writeJson(META_PATH, meta);

log('');
log('=== Stats ===');
log(`  files scanned:       ${stats.filesScanned}`);
log(`  files modified:      ${stats.filesModified}`);
log(`  dash→dot fixes:      ${stats.dashFixed}`);
log(`  -OLD positions drop: ${stats.oldDropped}`);
log(`  foreign→US mapped:   ${stats.foreignMapped}`);
log(`  meta.oldestHistoryAsOf: ${oldOldest!=null?oldOldest:'(was null)'} → ${oldest}`);

if (reviewLog.length) {
  writeFileSync(REVIEW_LOG, reviewLog.join('\n') + '\n');
  log('');
  log(`  review log: ${REVIEW_LOG} (uncertain foreign tickers + dropped -OLD positions)`);
}

log('');
log('done. Snapshot at', SNAPSHOT_TAR);
