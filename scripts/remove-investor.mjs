#!/usr/bin/env node
/**
 * remove-investor.mjs — remove an investor from the base.
 *
 * Usage:
 *   node scripts/remove-investor.mjs <investor-id>
 *
 * Effect:
 *   - Deletes public/data/investors/<id>.json
 *   - Removes the entry from public/data/investors-index.json
 *   - Removes the id from public/default-data.json.selectedInvestors[]
 *   - Removes id from public/default-data.json.investorCustomization
 *   - Does NOT touch public/data/prices/*.json (tickers may be used by other
 *     investors). If you want to GC orphaned tickers, run STOCKS-UPDATE.md
 *     after, with a `--gc` flag (TODO).
 *
 * Safe to run multiple times — missing pieces are silently skipped.
 */

import { readFileSync, writeFileSync, existsSync, unlinkSync } from 'node:fs';
import { resolve } from 'node:path';

const id = process.argv[2];
if (!id) {
  console.error('Usage: node scripts/remove-investor.mjs <investor-id>');
  process.exit(1);
}

const cwd = process.cwd();
const investorFile = resolve(cwd, `public/data/investors/${id}.json`);
const indexFile = resolve(cwd, 'public/data/investors-index.json');
const userConfigFile = resolve(cwd, 'public/default-data.json');

let changed = false;

// 1. Delete the per-investor file
if (existsSync(investorFile)) {
  unlinkSync(investorFile);
  console.log(`✓ deleted ${investorFile}`);
  changed = true;
} else {
  console.log(`· no file at ${investorFile}, skipping`);
}

// 2. Prune from the index
if (existsSync(indexFile)) {
  const index = JSON.parse(readFileSync(indexFile, 'utf8'));
  const before = (index.investors || []).length;
  index.investors = (index.investors || []).filter(i => i.id !== id);
  const after = index.investors.length;
  if (before !== after) {
    writeFileSync(indexFile, JSON.stringify(index, null, 2) + '\n');
    console.log(`✓ removed ${id} from investors-index.json (${before} → ${after})`);
    changed = true;
  } else {
    console.log(`· ${id} not in investors-index.json, skipping`);
  }
} else {
  console.log(`· no investors-index.json at ${indexFile}, skipping`);
}

// 3. Clean up user config (selectedInvestors + investorCustomization)
if (existsSync(userConfigFile)) {
  const cfg = JSON.parse(readFileSync(userConfigFile, 'utf8'));
  let userChanged = false;
  if (Array.isArray(cfg.selectedInvestors) && cfg.selectedInvestors.includes(id)) {
    cfg.selectedInvestors = cfg.selectedInvestors.filter(x => x !== id);
    console.log(`✓ removed ${id} from selectedInvestors`);
    userChanged = true;
  }
  if (cfg.investorCustomization && Object.prototype.hasOwnProperty.call(cfg.investorCustomization, id)) {
    delete cfg.investorCustomization[id];
    console.log(`✓ removed ${id} from investorCustomization`);
    userChanged = true;
  }
  if (userChanged) {
    writeFileSync(userConfigFile, JSON.stringify(cfg, null, 2) + '\n');
    changed = true;
  } else {
    console.log(`· ${id} not present in default-data.json user config, skipping`);
  }
}

if (!changed) {
  console.log(`\nNo changes — investor "${id}" wasn't anywhere in the data.`);
  process.exit(0);
}

console.log(`\nDone. Run STOCKS-UPDATE.md later if you want to GC orphaned tickers.`);
