import React, { useState, useEffect, useMemo, useRef } from 'react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine, ReferenceArea } from 'recharts';
import { Pencil, Trash2, Plus, AlertCircle, X, Upload, Download, Check, Database, ExternalLink, Save, RotateCcw, Wand2, GripVertical, Loader2, Sparkles, Link2, Pipette, LayoutGrid, HardDriveDownload, Eye, EyeOff, Moon, Sun } from 'lucide-react';

// ============================================================================
// DEFAULTS
// ============================================================================

const DEFAULT_PORTFOLIOS = [
  {
    id: 'voo', name: 'VOO', subtitle: 'S&P 500 — US large cap', kind: 'benchmark',
    color: '#2563eb', visible: true, locked: false,
    holdings: [{ ticker: 'VOO', weight: 100 }]
  },
  {
    id: 'vt', name: 'VT', subtitle: 'Total World — global equity', kind: 'benchmark',
    color: '#0d9488', visible: true, locked: false,
    holdings: [{ ticker: 'VT', weight: 100 }]
  },
  {
    id: 'mine', name: 'My Portfolio', subtitle: '$5,511 base', kind: 'mine',
    color: '#1a1815', visible: true, locked: false,
    holdings: [
      { ticker: 'TTWO', weight: 19.27 }, { ticker: 'GOOGL', weight: 18.54 },
      { ticker: 'BRK.B', weight: 17.22 }, { ticker: 'NVDA', weight: 14.59 },
      { ticker: 'MSFT', weight: 8.63 }, { ticker: 'NFLX', weight: 5.49 },
      { ticker: 'AAPL', weight: 4.91 }, { ticker: 'SONY', weight: 3.95 },
      { ticker: 'REMEDY.HE', weight: 3.84 }, { ticker: 'AMZN', weight: 3.55 }
    ]
  }
];

// 9 distinct hues that fit on one row alongside the custom color picker.
// Anything outside this set still works (Color picker → exact hex), it's just not preset.
const PALETTE = [
  '#1a1815', '#dc2626', '#ea580c', '#d97706', '#16a34a',
  '#0d9488', '#2563eb', '#7c3aed', '#db2777',
];

const TICKER_BLACKLIST = new Set([
  'INC','CORP','LTD','PLC','CO','LLC','SA','AG','GMBH','NV','BV','AB','OY','ASA',
  'CLASS','CLA','CLB','CL','ETF','FUND','TRUST','GROUP','HOLDINGS','HOLDING','COM',
  'CO.','THE','AND','OF','NEW','OLD','USD','EUR','GBP','CHF','JPY'
]);

// Same-company different-class tickers — used when "merge dual-class" is enabled
const TICKER_ALIASES = {
  'GOOG': 'GOOGL', // Alphabet C → A
};

const normalizeTicker = (t, mergeMode) => {
  if (!mergeMode) return t;
  if (TICKER_ALIASES[t]) return TICKER_ALIASES[t];
  // Strip single-letter class suffix: BRK.A, BRK.B, BF.A, BF.B → BRK, BF
  const m = t.match(/^([A-Z]+)\.[A-Z]$/);
  if (m) return m[1];
  return t;
};

// ============================================================================
// PRICE PARSER
// ============================================================================

const MONTHS = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };

const extractDates = (text) => {
  const found = [];
  const reA = /\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?(?:\s+(\d{1,2})\s*,?)?\s+(\d{4})\b/gi;
  let m;
  while ((m = reA.exec(text)) !== null) {
    const month = MONTHS[m[1].toLowerCase().slice(0, 3)];
    const day = m[2] ? parseInt(m[2]) : 1;
    const year = parseInt(m[3]);
    if (year >= 1900 && year <= 2100 && day >= 1 && day <= 31) {
      const date = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
      found.push({ date, start: m.index, end: m.index + m[0].length });
    }
  }
  const reB = /\b(\d{1,2})\s+(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+(\d{4})\b/gi;
  while ((m = reB.exec(text)) !== null) {
    const day = parseInt(m[1]);
    const month = MONTHS[m[2].toLowerCase().slice(0, 3)];
    const year = parseInt(m[3]);
    if (year >= 1900 && year <= 2100 && day >= 1 && day <= 31) {
      const date = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
      if (!found.some(f => m.index >= f.start && m.index < f.end)) {
        found.push({ date, start: m.index, end: m.index + m[0].length });
      }
    }
  }
  const reC = /\b(\d{4})-(\d{1,2})-(\d{1,2})\b/g;
  while ((m = reC.exec(text)) !== null) {
    const year = parseInt(m[1]), month = parseInt(m[2]), day = parseInt(m[3]);
    if (year >= 1900 && year <= 2100 && month >= 1 && month <= 12 && day >= 1 && day <= 31) {
      const date = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
      found.push({ date, start: m.index, end: m.index + m[0].length });
    }
  }
  const reD = /\b(\d{1,2})\/(\d{1,2})\/(\d{4})\b/g;
  while ((m = reD.exec(text)) !== null) {
    const month = parseInt(m[1]), day = parseInt(m[2]), year = parseInt(m[3]);
    if (year >= 1900 && year <= 2100 && month >= 1 && month <= 12 && day >= 1 && day <= 31) {
      const date = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
      found.push({ date, start: m.index, end: m.index + m[0].length });
    }
  }
  found.sort((a, b) => a.start - b.start);
  return found;
};

const extractNumbers = (text, excludeRanges, opts = {}) => {
  const min = opts.min ?? 0;
  const max = opts.max ?? 1e9;
  const allowPercent = opts.allowPercent ?? false;
  const found = [];
  const lookahead = allowPercent ? '(?![\\d.A-Za-z])' : '(?![\\d%A-Za-z.])';
  const re = new RegExp(`(?<![A-Za-z\\d.\\-])(\\d{1,3}(?:,\\d{3})+(?:\\.\\d+)?|\\d+\\.\\d+|\\d+)${lookahead}`, 'g');
  let m;
  while ((m = re.exec(text)) !== null) {
    const start = m.index, end = m.index + m[0].length;
    if (excludeRanges.some(r => start < r.end && end > r.start)) continue;
    const val = parseFloat(m[0].replace(/,/g, ''));
    if (isNaN(val) || val <= min || val > max) continue;
    found.push({ value: val, start, end });
  }
  return found;
};

const parsePriceInput = (text) => {
  if (!text || !text.trim()) return { error: 'Empty input' };
  const lines = text.trim().split(/\r?\n/).filter(l => l.trim());
  if (lines.length >= 3 && /,/.test(lines[0]) && /,/.test(lines[1])) {
    const csv = tryParseCSV(text);
    if (csv.data && Object.keys(csv.data).length >= 2) return csv;
  }
  const dates = extractDates(text);
  if (dates.length === 0) return { error: 'No dates found. Examples: "Apr 2026", "Apr 1, 2026", "2026-04-01"' };
  const numbers = extractNumbers(text, dates);
  if (numbers.length === 0) return { error: 'Found dates but no prices' };
  const seenDates = new Set();
  const uniqueDates = [];
  for (const d of dates) {
    if (!seenDates.has(d.date)) { seenDates.add(d.date); uniqueDates.push(d); }
  }
  const pairCount = Math.min(uniqueDates.length, numbers.length);
  const data = {};
  for (let i = 0; i < pairCount; i++) data[uniqueDates[i].date] = numbers[i].value;
  if (pairCount < 2) return { error: `Only ${pairCount} valid pair(s) — need at least 2` };
  const sortedDates = Object.keys(data).sort();
  const result = {
    data, parsed: pairCount,
    skipped: Math.max(0, uniqueDates.length - pairCount) + Math.max(0, numbers.length - pairCount),
    dateRange: { from: sortedDates[0], to: sortedDates[sortedDates.length - 1] },
    columnUsed: 'auto-detected', mode: 'flexible'
  };
  if (uniqueDates.length !== numbers.length) {
    result.warning = `Found ${uniqueDates.length} dates and ${numbers.length} numbers — paired first ${pairCount}`;
  }
  return result;
};

const tryParseCSV = (text) => {
  const lines = text.trim().split(/\r?\n/).filter(l => l.trim());
  if (lines.length < 2) return { error: 'Not enough rows' };
  const headers = lines[0].split(',').map(h => h.trim().replace(/^"|"$/g, '').toLowerCase());
  const dateIdx = headers.findIndex(h => h === 'date');
  if (dateIdx === -1) return { error: 'No Date column' };
  let priceIdx = headers.findIndex(h => h.includes('adj') && h.includes('close'));
  let columnUsed = 'Adj Close';
  if (priceIdx === -1) { priceIdx = headers.findIndex(h => h === 'close'); columnUsed = 'Close'; }
  if (priceIdx === -1) { priceIdx = headers.findIndex(h => h.includes('close')); columnUsed = headers[priceIdx] || 'Close'; }
  if (priceIdx === -1) { priceIdx = headers.findIndex(h => h === 'open'); columnUsed = 'Open'; }
  if (priceIdx === -1) return { error: 'No price column' };
  const data = {};
  let parsed = 0;
  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split(',');
    if (cols.length <= Math.max(dateIdx, priceIdx)) continue;
    const dt = extractDates(cols[dateIdx])[0]?.date;
    const price = parseFloat(cols[priceIdx].trim().replace(/^"|"$/g, '').replace(/,/g, ''));
    if (dt && !isNaN(price) && price > 0) { data[dt] = price; parsed++; }
  }
  if (parsed < 2) return { error: `Parsed only ${parsed} rows` };
  const sortedDates = Object.keys(data).sort();
  return { data, parsed, dateRange: { from: sortedDates[0], to: sortedDates[sortedDates.length - 1] }, columnUsed, mode: 'csv' };
};

// ============================================================================
// PORTFOLIO PASTE PARSER
// ============================================================================

const parsePortfolioInput = (text) => {
  if (!text || !text.trim()) return { error: 'Empty input' };
  const tickerSet = [];
  const tickerRanges = [];
  const reA = /\b([A-Z]{1,6}(?:[.\-][A-Z]{1,3})?)\s*[-–—]\s+(?=[A-Za-z])/g;
  let m;
  while ((m = reA.exec(text)) !== null) {
    const t = m[1];
    if (TICKER_BLACKLIST.has(t)) continue;
    tickerSet.push({ ticker: t, start: m.index, end: m.index + m[0].length });
    tickerRanges.push({ start: m.index, end: m.index + m[0].length });
  }
  if (tickerSet.length === 0) {
    const reB = /\b([A-Z]{2,6}(?:[.\-][A-Z]{1,3})?)\b/g;
    while ((m = reB.exec(text)) !== null) {
      const t = m[1];
      if (TICKER_BLACKLIST.has(t)) continue;
      tickerSet.push({ ticker: t, start: m.index, end: m.index + m[0].length });
      tickerRanges.push({ start: m.index, end: m.index + m[0].length });
    }
  }
  const seen = new Set();
  const tickers = tickerSet.filter(t => {
    if (seen.has(t.ticker)) return false;
    seen.add(t.ticker);
    return true;
  });
  if (tickers.length === 0) return { error: 'No tickers found. Use "TICKER - Description" format.' };
  const weights = extractNumbers(text, tickerRanges, { min: 0, max: 100, allowPercent: true });
  let holdings;
  if (weights.length === 0) {
    const equal = parseFloat((100 / tickers.length).toFixed(2));
    holdings = tickers.map(t => ({ ticker: t.ticker, weight: equal }));
  } else {
    const pairCount = Math.min(tickers.length, weights.length);
    holdings = [];
    for (let i = 0; i < pairCount; i++) holdings.push({ ticker: tickers[i].ticker, weight: weights[i].value });
    for (let i = pairCount; i < tickers.length; i++) holdings.push({ ticker: tickers[i].ticker, weight: 0 });
  }
  const initialSum = holdings.reduce((s, h) => s + h.weight, 0);
  let redistributed = false;
  let finalSum = initialSum;
  if (initialSum < 99 && holdings.length > 0) {
    const remainder = 100 - initialSum;
    const addPer = remainder / holdings.length;
    holdings = holdings.map(h => ({ ...h, weight: parseFloat((h.weight + addPer).toFixed(4)) }));
    finalSum = holdings.reduce((s, h) => s + h.weight, 0);
    redistributed = true;
  }
  return {
    holdings, initialSum, finalSum,
    tickerCount: tickers.length, weightCount: weights.length,
    redistributed, redistributedAmount: redistributed ? (100 - initialSum) : 0
  };
};

// ============================================================================
// Storage with cross-version migration
// ============================================================================

const STORAGE_VERSION = 'v8';
// V8: single key for all prices instead of N keys per ticker.
// Restore: 2 writes total instead of N+1 (massive speedup over V5-V7).

const loadAllStorage = async () => {
  let portfolios = null;
  let prices = {};
  try {
    const r = await window.storage.get(`portfolios:v8`);
    if (r?.value) portfolios = JSON.parse(r.value);
  } catch (e) {}
  try {
    const r = await window.storage.get(`prices:v8`);
    if (r?.value) prices = JSON.parse(r.value);
  } catch (e) {}
  return { portfolios, prices };
};
const savePortfolios = async (p) => {
  try { await window.storage.set(`portfolios:v8`, JSON.stringify(p)); }
  catch (e) {}
};
const savePricesAll = async (prices) => {
  try { await window.storage.set(`prices:v8`, JSON.stringify(prices)); }
  catch (e) {}
};

// One-time migration from older versions (v5/v6/v7 used per-ticker keys)
// Reads old keys in parallel, then writes a single combined key
const migrateToV8 = async () => {
  try {
    const v8Pf = await window.storage.get(`portfolios:v8`);
    const v8Pr = await window.storage.get(`prices:v8`);
    if (v8Pf?.value && v8Pr?.value) return { migrated: false };

    for (const oldVer of ['v7', 'v6', 'v5']) {
      const oldPf = await window.storage.get(`portfolios:${oldVer}`);
      if (!oldPf?.value) continue;

      if (!v8Pf?.value) {
        await window.storage.set(`portfolios:v8`, oldPf.value);
      }

      if (!v8Pr?.value) {
        const oldKeys = await window.storage.list(`price:${oldVer}:`);
        const allPrices = {};
        if (oldKeys?.keys && oldKeys.keys.length > 0) {
          // Parallel reads — much faster than sequential
          const fetches = oldKeys.keys.map(async (oldKey) => {
            const ticker = oldKey.replace(`price:${oldVer}:`, '');
            try {
              const val = await window.storage.get(oldKey);
              if (val?.value) {
                const parsed = JSON.parse(val.value);
                const priceMap = parsed?.data || parsed;
                if (priceMap && typeof priceMap === 'object') {
                  allPrices[ticker] = priceMap;
                }
              }
            } catch (e) {}
          });
          await Promise.all(fetches);
        }
        await window.storage.set(`prices:v8`, JSON.stringify(allPrices));
      }
      return { migrated: true, fromVersion: oldVer };
    }
    return { migrated: false };
  } catch (e) { return { migrated: false }; }
};

// ============================================================================
// Computation
// ============================================================================

// Filter out holdings the user has hidden via the eye toggle.
// `disabledHoldings` is { portfolioId: Set<TICKER_UPPER> } and lives only in memory.
const getActiveHoldings = (portfolio, disabledHoldings) => {
  const disabled = disabledHoldings?.[portfolio.id];
  if (!disabled?.size) return portfolio.holdings;
  return portfolio.holdings.filter(h => !disabled.has(h.ticker.trim().toUpperCase()));
};

// Static (single-snapshot) computation: original behaviour, used when a portfolio has no history.
const computeStaticSeries = (holdings, allPrices) => {
  if (!holdings?.length) return null;
  const valid = holdings.filter(h => allPrices[h.ticker.toUpperCase()]);
  if (!valid.length) return null;
  const dateSets = valid.map(h => new Set(Object.keys(allPrices[h.ticker.toUpperCase()])));
  const commonDates = [...dateSets[0]].filter(d => dateSets.every(s => s.has(d))).sort();
  if (commonDates.length < 2) return null;
  const startDate = commonDates[0];
  const totalWeight = valid.reduce((s, h) => s + h.weight, 0);
  if (totalWeight === 0) return null;
  return commonDates.map(date => {
    let val = 0;
    for (const h of valid) {
      const startPx = allPrices[h.ticker.toUpperCase()][startDate];
      const currPx = allPrices[h.ticker.toUpperCase()][date];
      val += (h.weight / totalWeight) * (currPx / startPx);
    }
    return { date, value: val * 100 };
  });
};

// Chain-linked computation: each snapshot defines a buy-and-hold segment from its asOf to the next
// snapshot's asOf. On each boundary the running portfolio value carries over into the next snapshot
// (rebalance with no leakage). `portfolio.holdings` is treated as the most recent snapshot, with an
// implicit asOf one quarter after the latest history entry.
const computeSeries = (portfolio, allPrices) => {
  if (!portfolio.holdings?.length) return null;
  if (!portfolio.history?.length) return computeStaticSeries(portfolio.holdings, allPrices);

  // Sort history ascending and append current holdings as the last snapshot.
  const sortedHistory = [...portfolio.history].sort((a, b) => a.asOf.localeCompare(b.asOf));
  const lastAsOf = sortedHistory[sortedHistory.length - 1].asOf;
  const [y, m] = lastAsOf.split('-').map(Number);
  const nm = m + 3;
  const ny = y + Math.floor((nm - 1) / 12);
  const nmm = ((nm - 1) % 12) + 1;
  const lastDay = new Date(ny, nmm, 0).getDate();
  const currentAsOf = `${ny}-${String(nmm).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;
  const snapshots = [...sortedHistory, { asOf: currentAsOf, holdings: portfolio.holdings }];

  // Union of all dates across every ticker referenced in any snapshot.
  const dateSet = new Set();
  snapshots.forEach(s => s.holdings.forEach(h => {
    const px = allPrices[h.ticker.toUpperCase()];
    if (px) Object.keys(px).forEach(d => dateSet.add(d));
  }));
  const allDates = [...dateSet].sort();
  if (allDates.length < 2) return null;

  // Closest available date ≤ target — quarter-end boundaries land on the nearest monthly point.
  const closestLE = (target) => {
    let lo = 0, hi = allDates.length - 1, ans = -1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (allDates[mid] <= target) { ans = mid; lo = mid + 1; } else hi = mid - 1;
    }
    return ans >= 0 ? allDates[ans] : null;
  };

  // Build segments. Each segment owns dates [fromDate, nextFromDate) — the boundary belongs to the
  // next segment so chain-linked rebalance happens cleanly.
  // The first segment ALWAYS starts at the earliest available price, regardless of where its
  // snapshot's asOf falls. The first snapshot's holdings apply retrospectively to anything before
  // their asOf — a fair buy-and-hold approximation, and it keeps history portfolios visually
  // aligned with non-history ones (which always start at allDates[0]).
  const segs = [];
  for (let i = 0; i < snapshots.length; i++) {
    const fromDate = i === 0 ? allDates[0] : closestLE(snapshots[i].asOf);
    if (!fromDate) continue;
    let toDate;
    if (i + 1 < snapshots.length) {
      toDate = closestLE(snapshots[i + 1].asOf);
      if (!toDate || toDate <= fromDate) continue;
    } else {
      toDate = allDates[allDates.length - 1];
    }
    segs.push({ holdings: snapshots[i].holdings, fromDate, toDate, isLast: i === snapshots.length - 1 });
  }
  if (!segs.length) return null;

  const result = [];
  let cumulative = 1.0;

  for (const seg of segs) {
    // Renormalize over holdings that have a price at fromDate — missing tickers contribute 0.
    const valid = seg.holdings.filter(h => {
      const px = allPrices[h.ticker.toUpperCase()];
      return px && px[seg.fromDate] !== undefined;
    });
    if (!valid.length) continue;
    const totalWeight = valid.reduce((s, h) => s + h.weight, 0);
    if (totalWeight === 0) continue;

    const startPx = {};
    valid.forEach(h => { startPx[h.ticker.toUpperCase()] = allPrices[h.ticker.toUpperCase()][seg.fromDate]; });

    const segDates = allDates.filter(d => d >= seg.fromDate && (seg.isLast ? d <= seg.toDate : d < seg.toDate));
    for (const date of segDates) {
      let factor = 0;
      for (const h of valid) {
        const T = h.ticker.toUpperCase();
        const currPx = allPrices[T][date];
        if (currPx === undefined) continue;
        factor += (h.weight / totalWeight) * (currPx / startPx[T]);
      }
      result.push({ date, value: cumulative * factor });
    }

    // Carry value across the boundary using THIS segment's holdings — that's the actual final
    // value just before rebalancing into the next snapshot's weights.
    if (!seg.isLast) {
      let boundaryFactor = 0;
      for (const h of valid) {
        const T = h.ticker.toUpperCase();
        const endPx = allPrices[T][seg.toDate];
        if (endPx === undefined) continue;
        boundaryFactor += (h.weight / totalWeight) * (endPx / startPx[T]);
      }
      cumulative = cumulative * boundaryFactor;
    }
  }

  if (!result.length) return null;
  const first = result[0].value;
  return result.map(r => ({ date: r.date, value: r.value / first * 100 }));
};

const formatDateNice = (s) => {
  const [y, m, d] = s.split('-');
  return new Date(parseInt(y), parseInt(m) - 1, parseInt(d))
    .toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: '2-digit' });
};
const formatDateShort = (s) => {
  const [y, m] = s.split('-');
  return new Date(parseInt(y), parseInt(m) - 1, 1)
    .toLocaleDateString('en-US', { month: 'short', year: '2-digit' });
};
const buildLinks = (ticker) => {
  const t = ticker.trim();
  if (!t) return null;
  const tLower = t.toLowerCase();
  const isLikelyEtf = /^(VOO|VT|VTI|SPY|QQQ|VXUS|VEA|VWO|BND|TLT|IVV|VGT|SCHD|VUG|VYM)$/i.test(t);
  return {
    stockanalysis: `https://stockanalysis.com/${isLikelyEtf ? 'etf' : 'stocks'}/${tLower}/history/`,
    yahoo: `https://finance.yahoo.com/quote/${t}/history/`
  };
};

// ============================================================================
// PORTFOLIO ROW
// ============================================================================

const PortfolioRow = ({
  portfolio, onToggle, onEdit, performance, missingTickers, coveragePct, disabledSet,
  onDragStart, onDragOver, onDragLeave, onDrop, onDragEnd, isDragging, isDropTarget
}) => {
  const lastValue = performance?.[performance.length - 1]?.value;
  const pctReturn = lastValue ? lastValue - 100 : null;
  const positive = pctReturn !== null && pctReturn >= 0;
  const stockCount = portfolio.holdings?.filter(h => !disabledSet?.has(h.ticker.trim().toUpperCase())).length || 0;
  return (
    <div
      draggable
      onDragStart={(e) => {
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', portfolio.id);
        onDragStart?.(portfolio.id);
      }}
      onDragOver={(e) => onDragOver?.(e, portfolio.id)}
      onDragLeave={onDragLeave}
      onDrop={(e) => onDrop?.(e, portfolio.id)}
      onDragEnd={onDragEnd}
      className={`group relative px-4 py-3 border-b border-stone-200/80 hover:bg-stone-100/60 transition-colors ${
        isDragging ? 'opacity-30' : ''
      } ${isDropTarget ? 'bg-amber-50 border-t-2 border-t-amber-600' : ''}`}
      style={{ cursor: isDragging ? 'grabbing' : 'grab' }}
    >
      <div className="flex items-center gap-3">
        <GripVertical size={12} className="text-stone-300 group-hover:text-stone-500 transition-colors flex-shrink-0" />
        <button onClick={(e) => { e.stopPropagation(); onToggle(portfolio.id, e); }}
          title={portfolio.visible ? 'Click to hide · Ctrl/⌘/Shift+click to isolate' : 'Click to show · Ctrl/⌘/Shift+click to isolate'}
          className="flex-shrink-0 hover:opacity-70 p-1 -m-1">
          <div className="w-3 h-3 rounded-full" style={{
            backgroundColor: portfolio.visible ? portfolio.color : 'transparent',
            border: `1.5px solid ${portfolio.color}`,
            opacity: portfolio.visible ? 1 : 0.4
          }} />
        </button>
        <div
          className="flex-1 min-w-0 select-none"
          onClick={(e) => { e.stopPropagation(); onToggle(portfolio.id, e); }}
          title={portfolio.visible ? 'Click to hide · Ctrl/⌘/Shift+click to isolate' : 'Click to show · Ctrl/⌘/Shift+click to isolate'}
          style={{ cursor: isDragging ? 'grabbing' : 'pointer' }}
        >
          <div className="flex items-baseline gap-2 flex-wrap">
            <span className={`text-[15px] tracking-tight font-serif ${!portfolio.visible ? 'line-through' : ''}`} style={{
              fontWeight: 500, color: portfolio.visible ? 'var(--text-primary)' : 'var(--text-muted)'
            }}>{portfolio.name}</span>
            <span className="text-[10px] font-mono text-stone-400 tabular-nums">·{stockCount}</span>
            {portfolio.kind === 'mine' && <span className="text-[9px] tracking-[0.18em] uppercase font-mono px-1.5 py-0.5 bg-stone-900 text-stone-50 rounded-sm">YOU</span>}
            {portfolio.kind === 'benchmark' && <span className="text-[9px] tracking-[0.18em] uppercase font-mono text-stone-500">bench</span>}
          </div>
          {portfolio.subtitle && <div className="text-[11px] text-stone-500 mt-0.5 font-mono tracking-tight truncate">{portfolio.subtitle}</div>}
          {missingTickers?.length > 0 && (
            <div className="text-[10px] text-amber-700 mt-0.5 font-mono">
              missing: {missingTickers.join(', ')} <span className="text-stone-500">({coveragePct}% covered)</span>
            </div>
          )}
        </div>
        <div className="flex items-center gap-3">
          {pctReturn !== null && (
            <button
              onClick={(e) => { e.stopPropagation(); onEdit(portfolio); }}
              title="Edit portfolio"
              className="text-right font-mono cursor-pointer hover:opacity-70 transition-opacity">
              <div className="text-[13px] tabular-nums font-medium" style={{ color: positive ? 'var(--success)' : 'var(--danger)' }}>
                {positive ? '+' : ''}{pctReturn.toFixed(2)}%
              </div>
            </button>
          )}
          {!performance && stockCount === 0 && <div className="text-[10px] text-stone-400 italic font-mono">empty</div>}
          {!performance && stockCount > 0 && <div className="text-[10px] text-stone-400 italic font-mono">no data</div>}
          <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
            <button onClick={(e) => { e.stopPropagation(); onEdit(portfolio); }} className="p-1.5 hover:bg-stone-200 rounded text-stone-500 hover:text-stone-800" title="Edit portfolio">
              <Pencil size={12} />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

// ============================================================================
// PORTFOLIO EDITOR
// ============================================================================

const asOfLabel = (iso) => {
  const [y, m] = iso.split('-').map(Number);
  const q = Math.floor((m - 1) / 3) + 1;
  return `Q${q} '${String(y).slice(2)}`;
};

const PortfolioEditModal = ({ portfolio, onSave, onClose, onDelete, disabledSet, onToggleDisabled, prices, vooPortfolio }) => {
  const isNew = !portfolio?.holdings;
  const [name, setName] = useState(portfolio?.name || '');
  const [subtitle, setSubtitle] = useState(portfolio?.subtitle || '');
  const [holdings, setHoldings] = useState(
    portfolio?.holdings?.length > 0 ? portfolio.holdings.map(h => ({ ...h })) : [{ ticker: '', weight: 0 }]
  );
  const [color, setColor] = useState(portfolio?.color || PALETTE[0]);
  const [showPaste, setShowPaste] = useState(isNew);
  const [pasteText, setPasteText] = useState('');
  const [pastePreview, setPastePreview] = useState(null);
  // Quarter switcher: 'current' edits portfolio.holdings; numeric idx shows portfolio.history[idx] read-only.
  const historySnapshots = portfolio?.history || [];
  const [viewIdx, setViewIdx] = useState('current');
  const isReadonly = viewIdx !== 'current';
  const displayedHoldings = isReadonly ? (historySnapshots[viewIdx]?.holdings || []) : holdings;
  const totalWeight = displayedHoldings.reduce((s, h) => s + (parseFloat(h.weight) || 0), 0);
  const enabledWeight = displayedHoldings.filter(h => !disabledSet?.has(h.ticker.trim().toUpperCase())).reduce((s, h) => s + (parseFloat(h.weight) || 0), 0);
  const disabledCount = displayedHoldings.filter(h => h.ticker.trim() && disabledSet?.has(h.ticker.trim().toUpperCase())).length;

  // Diff vs previous quarter — for each visible holding, compute Δ weight; also collect tickers that
  // existed last quarter but disappeared (sold). For the earliest snapshot (Q1) there is no prev.
  const allSnapshotsForDiff = [...historySnapshots, { asOf: 'current', holdings }];
  const currentSnapIdx = isReadonly ? viewIdx : historySnapshots.length;
  const prevSnap = currentSnapIdx > 0 ? allSnapshotsForDiff[currentSnapIdx - 1] : null;
  const prevByTicker = {};
  prevSnap?.holdings.forEach(h => {
    const t = h.ticker.trim().toUpperCase();
    if (t) prevByTicker[t] = parseFloat(h.weight) || 0;
  });
  const soldThisQuarter = prevSnap
    ? prevSnap.holdings
        .map(h => ({ ticker: h.ticker.trim().toUpperCase(), weight: parseFloat(h.weight) || 0 }))
        .filter(p => p.ticker && !displayedHoldings.some(d => d.ticker.trim().toUpperCase() === p.ticker))
    : [];

  // Mini-chart: edited current holdings (with eye toggle applied) vs VOO over the available history.
  // Recomputes live as the user edits weights or toggles eyes — it's the "what does this change do?"
  // companion to the big chart on the page.
  const miniChartData = useMemo(() => {
    if (!prices || !vooPortfolio) return null;
    const liveHoldings = holdings
      .filter(h => h.ticker.trim() && parseFloat(h.weight) > 0)
      .map(h => ({ ticker: h.ticker.trim().toUpperCase(), weight: parseFloat(h.weight) }));
    if (!liveHoldings.length) return null;
    const filterDisabled = (hs) => disabledSet?.size
      ? (hs || []).filter(h => !disabledSet.has(h.ticker.trim().toUpperCase()))
      : hs;
    const probe = {
      ...portfolio,
      holdings: filterDisabled(liveHoldings),
      history: portfolio?.history ? portfolio.history.map(s => ({ ...s, holdings: filterDisabled(s.holdings) })) : undefined,
    };
    const series = computeSeries(probe, prices);
    const vooSeries = computeSeries(vooPortfolio, prices);
    if (!series || !vooSeries) return null;
    const vooByDate = new Map(vooSeries.map(d => [d.date, d.value]));
    const merged = series.filter(d => vooByDate.has(d.date))
      .map(d => ({ date: d.date, ratio: d.value / vooByDate.get(d.date) }));
    if (merged.length < 2) return null;
    const first = merged[0].ratio;
    return merged.map(d => ({ date: d.date, value: d.ratio / first * 100 }));
  }, [holdings, disabledSet, portfolio, prices, vooPortfolio]);
  const miniLast = miniChartData?.[miniChartData.length - 1]?.value;
  const miniDelta = miniLast != null ? miniLast - 100 : null;

  const updateHolding = (i, field, value) => {
    const next = [...holdings];
    next[i] = { ...next[i], [field]: field === 'ticker' ? value.toUpperCase() : value };
    setHoldings(next);
  };
  const addHolding = () => setHoldings([...holdings, { ticker: '', weight: 0 }]);
  const removeHolding = (i) => setHoldings(holdings.filter((_, idx) => idx !== i));
  const normalize = () => {
    const total = holdings.reduce((s, h) => s + (parseFloat(h.weight) || 0), 0);
    if (total === 0) return;
    setHoldings(holdings.map(h => ({ ...h, weight: parseFloat(((parseFloat(h.weight) || 0) / total * 100).toFixed(2)) })));
  };
  const handleSave = () => {
    const clean = holdings.filter(h => h.ticker.trim() && parseFloat(h.weight) > 0)
      .map(h => ({ ticker: h.ticker.trim().toUpperCase(), weight: parseFloat(h.weight) }));
    onSave({ ...portfolio, name: name.trim() || 'Untitled', subtitle: subtitle.trim(), color, holdings: clean });
  };
  const tryPasteParse = (text) => {
    setPasteText(text);
    if (!text.trim()) { setPastePreview(null); return; }
    setPastePreview(parsePortfolioInput(text));
  };
  const applyPaste = () => {
    if (!pastePreview?.holdings) return;
    setHoldings(pastePreview.holdings.map(h => ({ ...h, weight: parseFloat(h.weight.toFixed(2)) })));
    setShowPaste(false);
    setPasteText('');
    setPastePreview(null);
    if (!name && pastePreview.holdings.length > 0) setName(`Portfolio (${pastePreview.holdings.length} stocks)`);
  };

  return (
    // Pin near the top so the modal does not jump vertically when content height changes
    // (e.g. switching quarters with different holdings counts).
    <div className="fixed inset-0 bg-stone-900/40 backdrop-blur-sm z-50 flex items-start justify-center p-4 pt-12 overflow-y-auto">
      <div className="bg-stone-50 border border-stone-300 rounded-lg max-w-[44rem] w-full max-h-[calc(100vh-4rem)] overflow-hidden flex flex-col shadow-2xl">
        <div className="px-6 py-4 border-b border-stone-200 flex items-center justify-between">
          <h2 className="text-xl tracking-tight font-serif" style={{ color: 'var(--text-primary)' }}>{isNew ? 'New Portfolio' : 'Edit Portfolio'}</h2>
          <button onClick={onClose} className="text-stone-500 hover:text-stone-800"><X size={20} /></button>
        </div>
        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-5">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="text-[10px] tracking-[0.15em] uppercase text-stone-500 font-mono mb-1.5 block">Name</label>
              <input value={name} onChange={(e) => setName(e.target.value)}
                className="w-full bg-white border border-stone-300 rounded px-3 py-2 text-sm font-serif focus:border-stone-700 focus:outline-none" />
            </div>
            <div>
              <label className="text-[10px] tracking-[0.15em] uppercase text-stone-500 font-mono mb-1.5 block">Color</label>
              <div className="flex flex-wrap gap-1.5 pt-1.5 items-center">
                {PALETTE.map(c => (
                  <button key={c} onClick={() => setColor(c)} className="w-6 h-6 rounded-full hover:scale-110 transition-transform"
                    style={{ backgroundColor: c, border: color === c ? '2px solid var(--border-selected)' : '2px solid transparent', boxShadow: color === c ? '0 0 0 1px white inset' : 'none' }} />
                ))}
                <span className="w-px h-5 bg-stone-300 mx-0.5" />
                <label className="relative w-6 h-6 cursor-pointer group" title="Pick any color">
                  <input type="color" value={color} onChange={(e) => setColor(e.target.value)}
                    className="absolute inset-0 w-full h-full opacity-0 cursor-pointer" />
                  <div className="w-6 h-6 rounded-full border-2 border-dashed border-stone-400 group-hover:border-stone-700 flex items-center justify-center bg-white transition-colors"
                    style={!PALETTE.includes(color) ? { backgroundColor: color, borderStyle: 'solid', borderColor: 'var(--border-selected)', boxShadow: '0 0 0 1px white inset' } : undefined}>
                    {PALETTE.includes(color) && <Pipette size={11} className="text-stone-500 group-hover:text-stone-800" />}
                  </div>
                </label>
              </div>
            </div>
          </div>
          <div>
            <label className="text-[10px] tracking-[0.15em] uppercase text-stone-500 font-mono mb-1.5 block">Subtitle</label>
            <input value={subtitle} onChange={(e) => setSubtitle(e.target.value)} placeholder="e.g. Q1 2025 · Top 5"
              className="w-full bg-white border border-stone-300 rounded px-3 py-2 text-xs text-stone-700 font-mono focus:border-stone-700 focus:outline-none" />
          </div>
          {miniChartData && (
            <div className="flex items-center gap-3">
              <div className="flex flex-col text-[10px] font-mono leading-tight">
                <span className="text-stone-500 tracking-[0.1em] uppercase">vs VOO</span>
                <span className="tabular-nums font-medium"
                  style={{ color: miniDelta >= 0 ? 'var(--success)' : 'var(--danger)' }}>
                  {miniDelta >= 0 ? '+' : ''}{miniDelta.toFixed(2)}%
                </span>
              </div>
              <div className="flex-1 h-12">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={miniChartData} margin={{ top: 4, right: 4, bottom: 4, left: 4 }}>
                    <YAxis hide domain={['auto', 'auto']} />
                    <XAxis hide dataKey="date" />
                    <ReferenceLine y={100} stroke="var(--ref-line)" strokeDasharray="3 3" strokeOpacity={0.3} />
                    <Line type="monotone" dataKey="value" stroke={color || '#1a1815'} strokeWidth={1.5} dot={false} isAnimationActive={false} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </div>
          )}
          <div className="border border-amber-700/30 bg-amber-50/40 rounded-lg overflow-hidden">
            <button onClick={() => setShowPaste(!showPaste)} className="w-full px-4 py-2.5 flex items-center justify-between hover:bg-amber-50/60 transition-colors">
              <div className="flex items-center gap-2">
                <Wand2 size={13} className="text-amber-800" />
                <span className="text-[11px] tracking-[0.1em] uppercase font-mono text-amber-900">Smart paste</span>
              </div>
              <span className="text-stone-500 text-xs">{showPaste ? '−' : '+'}</span>
            </button>
            {showPaste && (
              <div className="px-4 pb-4 pt-1 space-y-2">
                <textarea value={pasteText} onChange={(e) => tryPasteParse(e.target.value)}
                  placeholder={"TKO - TKO Group Holdings Inc. GOOGL - Alphabet Inc. ...  15.75 15.63 ..."}
                  rows={4}
                  className="w-full bg-white border border-stone-300 rounded px-3 py-2 text-[11px] text-stone-800 font-mono focus:border-amber-700/60 focus:outline-none resize-none" />
                {pastePreview?.error && (
                  <div className="text-[11px] font-mono text-red-800 flex items-center gap-1.5">
                    <AlertCircle size={11} /> {pastePreview.error}
                  </div>
                )}
                {pastePreview?.holdings && (
                  <div className="space-y-1.5">
                    <div className="text-[11px] font-mono text-emerald-900 flex items-center gap-1.5">
                      <Check size={11} /> Detected {pastePreview.tickerCount} tickers, {pastePreview.weightCount} weights
                    </div>
                    {pastePreview.redistributed && (
                      <div className="text-[10px] font-mono text-amber-800">
                        Sum was {pastePreview.initialSum.toFixed(2)}% — distributed remaining {pastePreview.redistributedAmount.toFixed(2)}% evenly
                      </div>
                    )}
                    <div className="bg-white border border-stone-200 rounded p-2 max-h-32 overflow-y-auto">
                      <table className="w-full text-[10px] font-mono">
                        <tbody>
                          {pastePreview.holdings.slice(0, 20).map((h, i) => (
                            <tr key={i}>
                              <td className="py-0.5 text-stone-800">{h.ticker}</td>
                              <td className="py-0.5 text-right tabular-nums text-stone-600">{h.weight.toFixed(2)}%</td>
                            </tr>
                          ))}
                          {pastePreview.holdings.length > 20 && (
                            <tr><td colSpan={2} className="text-stone-500 italic">… +{pastePreview.holdings.length - 20} more</td></tr>
                          )}
                        </tbody>
                      </table>
                    </div>
                    <button onClick={applyPaste}
                      className="w-full text-[11px] tracking-[0.15em] uppercase font-mono bg-amber-700 text-white rounded py-2 hover:bg-amber-800">
                      Apply ({pastePreview.holdings.length} holdings)
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>
          <div>
            <div className="flex items-center justify-between mb-2 flex-wrap gap-2">
              <div className="flex items-center gap-2 flex-wrap">
                <label className="text-[10px] tracking-[0.15em] uppercase text-stone-500 font-mono">Holdings</label>
                {historySnapshots.length > 0 && (
                  <div className="flex items-center gap-1">
                    {historySnapshots.map((s, idx) => (
                      <button key={s.asOf} onClick={() => setViewIdx(idx)}
                        className={`text-[10px] font-mono px-2 py-0.5 rounded border transition-colors ${
                          viewIdx === idx
                            ? 'bg-stone-900 text-stone-50 border-stone-900'
                            : 'bg-transparent text-stone-500 hover:text-stone-900 hover:border-stone-500 border-stone-300'
                        }`}
                        title={`13F snapshot · ${s.asOf} · read-only`}>
                        {asOfLabel(s.asOf)}
                      </button>
                    ))}
                    <button onClick={() => setViewIdx('current')}
                      className={`text-[10px] font-mono px-2 py-0.5 rounded border transition-colors ${
                        viewIdx === 'current'
                          ? 'bg-stone-900 text-stone-50 border-stone-900'
                          : 'bg-transparent text-stone-500 hover:text-stone-900 hover:border-stone-500 border-stone-300'
                      }`}
                      title="Current — editable">
                      Now
                    </button>
                  </div>
                )}
              </div>
              <div className="flex items-center gap-3">
                <span className={`text-[11px] font-mono tabular-nums ${
                  totalWeight >= 99.5 && totalWeight <= 100.5 ? 'text-emerald-700' : totalWeight > 100.5 ? 'text-red-700' : 'text-amber-700'
                }`}>Σ {totalWeight >= 99.5 && totalWeight <= 100.5 ? '100.00' : totalWeight.toFixed(2)}%</span>
                {disabledCount > 0 && (
                  <span className="text-[10px] font-mono text-stone-400" title="Weight of enabled holdings (disabled excluded)">
                    active {enabledWeight >= 99.5 && enabledWeight <= 100.5 ? '100.00' : enabledWeight.toFixed(2)}%
                  </span>
                )}
                {!isReadonly && (
                  <button onClick={normalize} className="text-[10px] tracking-[0.1em] uppercase text-stone-700 hover:text-stone-900 font-mono underline-offset-4 hover:underline">
                    Normalize → 100%
                  </button>
                )}
              </div>
            </div>
            <div className="space-y-1.5">
              {[
                ...displayedHoldings.map((h, i) => ({ kind: 'live', h, i })),
                ...soldThisQuarter.map(s => ({ kind: 'sold', h: { ticker: s.ticker, weight: 0 }, prevWeight: s.weight }))
              ].map((row, rowKey) => {
                const isSold = row.kind === 'sold';
                const h = row.h;
                const w = parseFloat(h.weight) || 0;
                const ticker = h.ticker.trim().toUpperCase();
                // Eye toggle is global across all snapshots (transient, never saved). A ticker may
                // only appear in earlier quarters — let the user disable/enable it from any view,
                // including the sold/read-only states.
                const isDisabled = ticker && disabledSet?.has(ticker);
                // For visual diff bar, normalize against the larger of the two snapshots' totals so
                // Δ segments stay consistent across rows.
                const prevW = isSold ? row.prevWeight : (ticker ? prevByTicker[ticker] : undefined);
                const refTotal = totalWeight > 0 ? totalWeight : 100;
                const pct = Math.min(100, (w / refTotal) * 100);
                const prevPct = prevW !== undefined ? Math.min(100, (prevW / refTotal) * 100) : null;
                const isIncrease = !isSold && prevPct !== null && pct > prevPct + 0.01;
                const isDecrease = !isSold && prevPct !== null && pct < prevPct - 0.01;
                const isNewPosition = !isSold && prevSnap && prevW === undefined && pct > 0;
                // base = the "kept" / unchanged portion of the bar (gray)
                const baseWidth = isSold
                  ? 0
                  : isNewPosition
                    ? 0
                    : prevPct !== null
                      ? Math.min(pct, prevPct)
                      : pct;
                return (
                  <div key={rowKey} className={`flex items-center gap-2 ${isDisabled ? 'opacity-40' : ''} ${isSold ? 'opacity-60' : ''}`}>
                    {onToggleDisabled && (ticker ? (
                      <button onClick={() => onToggleDisabled(portfolio.id, ticker)}
                        className="w-[29px] h-[29px] flex-shrink-0 flex items-center justify-center text-stone-400 hover:text-stone-700"
                        title={isDisabled ? 'Enable holding' : 'Disable holding (excluded from chart)'}>
                        {isDisabled ? <EyeOff size={13} /> : <Eye size={13} />}
                      </button>
                    ) : <div className="w-[29px] h-[29px] flex-shrink-0" />)}
                    <div className="flex-1 relative bg-white border border-stone-300 rounded overflow-hidden focus-within:border-stone-700 transition-colors">
                      {/* base/kept bar — gray */}
                      {baseWidth > 0 && (
                        <div className="absolute inset-y-0 left-0 transition-all duration-200 pointer-events-none"
                          style={{ width: `${baseWidth}%`, background: 'var(--weight-bar)' }} />
                      )}
                      {/* increase: green sliver from prev to current */}
                      {isIncrease && (
                        <div className="absolute inset-y-0 transition-all duration-200 pointer-events-none"
                          style={{ left: `${prevPct}%`, width: `${pct - prevPct}%`, background: 'var(--success)', opacity: 0.22 }} />
                      )}
                      {/* decrease: red ghost from current to prev (where the position used to extend) */}
                      {isDecrease && (
                        <div className="absolute inset-y-0 transition-all duration-200 pointer-events-none"
                          style={{ left: `${pct}%`, width: `${prevPct - pct}%`, background: 'var(--danger)', opacity: 0.25 }} />
                      )}
                      {/* fully new position: green from 0 to current */}
                      {isNewPosition && (
                        <div className="absolute inset-y-0 left-0 transition-all duration-200 pointer-events-none"
                          style={{ width: `${pct}%`, background: 'var(--success)', opacity: 0.22 }} />
                      )}
                      {/* sold: red ghost spanning what the position used to be */}
                      {isSold && prevPct !== null && (
                        <div className="absolute inset-y-0 left-0 transition-all duration-200 pointer-events-none"
                          style={{ width: `${prevPct}%`, background: 'var(--danger)', opacity: 0.25 }} />
                      )}
                      <input value={h.ticker} readOnly={isReadonly || isSold}
                        onChange={(e) => !isReadonly && !isSold && updateHolding(row.i, 'ticker', e.target.value)} placeholder="TICKER"
                        className={`relative w-full bg-transparent px-3 py-2 text-sm font-mono uppercase focus:outline-none ${isSold ? 'text-stone-500 line-through' : isDisabled ? 'text-stone-400 line-through' : 'text-stone-900'} ${(isReadonly || isSold) ? 'cursor-default' : ''}`} />
                    </div>
                    <input type="number" step="0.01" value={h.weight} readOnly={isReadonly || isSold}
                      onChange={(e) => !isReadonly && !isSold && updateHolding(row.i, 'weight', e.target.value)} placeholder="0.00"
                      className={`w-24 bg-white border border-stone-300 rounded px-3 py-2 text-sm font-mono text-right tabular-nums focus:border-stone-700 focus:outline-none ${isSold ? 'text-stone-500' : 'text-stone-900'} ${(isReadonly || isSold) ? 'cursor-default' : ''}`} />
                    <span className="text-stone-500 text-xs font-mono">%</span>
                    {(!isReadonly && !isSold)
                      ? <button onClick={() => removeHolding(row.i)} className="p-1.5 text-stone-400 hover:text-red-600"><X size={14} /></button>
                      : <div className="w-[26px] flex-shrink-0" />}
                  </div>
                );
              })}
            </div>
            {!isReadonly && (
              <button onClick={addHolding} className="mt-3 flex items-center gap-2 text-[11px] tracking-[0.1em] uppercase text-stone-600 hover:text-stone-900 font-mono">
                <Plus size={12} /> Add holding
              </button>
            )}
          </div>
        </div>
        <div className="px-6 py-4 border-t border-stone-200 flex items-center justify-between gap-3 bg-stone-100/50">
          <div>
            {!isNew && !portfolio.locked && onDelete && (
              <button onClick={() => onDelete(portfolio.id)}
                className="flex items-center gap-1.5 px-3 py-2 text-[11px] tracking-[0.15em] uppercase font-mono text-red-700 hover:text-red-900 hover:bg-red-50 rounded transition-colors">
                <Trash2 size={12} /> Delete
              </button>
            )}
          </div>
          <div className="flex items-center gap-3">
            <button onClick={onClose} className="px-4 py-2 text-[11px] tracking-[0.15em] uppercase text-stone-600 hover:text-stone-900 font-mono">Cancel</button>
            <button onClick={handleSave} className="px-5 py-2 text-[11px] tracking-[0.15em] uppercase font-mono bg-stone-900 text-stone-50 rounded hover:bg-stone-800">Save</button>
          </div>
        </div>
      </div>
    </div>
  );
};

// ============================================================================
// PRICE IMPORT MODAL
// ============================================================================

const ImportModal = ({ tickerHint, onSave, onClose }) => {
  const [ticker, setTicker] = useState(tickerHint || '');
  const [text, setText] = useState('');
  const [preview, setPreview] = useState(null);
  const [error, setError] = useState(null);
  const [warning, setWarning] = useState(null);
  const tryParse = (input) => {
    setText(input);
    if (!input.trim()) { setPreview(null); setError(null); setWarning(null); return; }
    const result = parsePriceInput(input);
    if (result.error) { setPreview(null); setError(result.error); setWarning(null); }
    else { setPreview(result); setError(null); setWarning(result.warning || null); }
  };
  const handleImport = () => {
    if (!ticker.trim() || !preview) return;
    onSave(ticker.trim().toUpperCase(), preview.data);
  };
  const links = buildLinks(ticker);
  return (
    <div className="fixed inset-0 bg-stone-900/40 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="bg-stone-50 border border-stone-300 rounded-lg max-w-3xl w-full max-h-[90vh] overflow-hidden flex flex-col shadow-2xl">
        <div className="px-6 py-4 border-b border-stone-200 flex items-center justify-between">
          <div>
            <h2 className="text-xl tracking-tight font-serif" style={{ color: 'var(--text-primary)' }}>Import prices</h2>
            <p className="text-[11px] text-stone-500 font-mono mt-1">Paste any text containing dates and prices</p>
          </div>
          <button onClick={onClose} className="text-stone-500 hover:text-stone-800"><X size={20} /></button>
        </div>
        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-4">
          <div>
            <label className="text-[10px] tracking-[0.15em] uppercase text-stone-500 font-mono mb-1.5 block">Ticker</label>
            <input value={ticker} onChange={(e) => setTicker(e.target.value.toUpperCase())} placeholder="e.g. AAPL, BRK.B, REMEDY.HE"
              className="w-full bg-white border border-stone-300 rounded px-3 py-2 text-sm font-mono uppercase focus:border-stone-700 focus:outline-none" autoFocus />
            {links && (
              <div className="mt-2 flex items-center gap-3 text-[11px] font-mono">
                <a href={links.stockanalysis} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5 text-stone-700 hover:text-amber-700 underline-offset-4 hover:underline">
                  <ExternalLink size={11} /> stockanalysis.com
                </a>
                <a href={links.yahoo} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5 text-stone-700 hover:text-amber-700 underline-offset-4 hover:underline">
                  <ExternalLink size={11} /> finance.yahoo.com
                </a>
              </div>
            )}
          </div>
          <div>
            <label className="text-[10px] tracking-[0.15em] uppercase text-stone-500 font-mono mb-1.5 block">Pasted data</label>
            <textarea value={text} onChange={(e) => tryParse(e.target.value)} placeholder={"Apr 2026 Mar 2026 Feb 2026 ...\n254.08 262.41 260.03 ..."}
              rows={12}
              className="w-full bg-white border border-stone-300 rounded px-3 py-2 text-[11px] text-stone-800 font-mono focus:border-stone-700 focus:outline-none resize-none" />
          </div>
          {error && (
            <div className="p-3 bg-red-50 border border-red-300 rounded text-[11px] font-mono text-red-900 flex items-start gap-2">
              <AlertCircle size={13} className="flex-shrink-0 mt-0.5" /><div>{error}</div>
            </div>
          )}
          {preview && (
            <div className={`p-3 rounded text-[11px] font-mono border ${warning ? 'bg-red-50 border-red-300' : 'bg-emerald-50 border-emerald-300'}`}>
              <div className={`flex items-center gap-2 mb-1.5 ${warning ? 'text-red-900' : 'text-emerald-900'}`}>
                {warning ? <AlertCircle size={13} /> : <Check size={13} />}
                <span className="font-medium">Parsed {preview.parsed} points</span>
                <span className="text-stone-500 text-[10px]">({preview.mode})</span>
              </div>
              <div className="text-stone-700 mb-1">
                Range: <span className="text-stone-900">{formatDateNice(preview.dateRange.from)} → {formatDateNice(preview.dateRange.to)}</span>
              </div>
              <div className="text-stone-600 text-[10px]">Column: {preview.columnUsed}</div>
              {warning && <div className="mt-2 pt-2 border-t border-red-200 text-red-800 text-[10px]">⚠ {warning}</div>}
            </div>
          )}
        </div>
        <div className="px-6 py-4 border-t border-stone-200 flex items-center justify-end gap-3 bg-stone-100/50">
          <button onClick={onClose} className="px-4 py-2 text-[11px] tracking-[0.15em] uppercase text-stone-600 hover:text-stone-900 font-mono">Cancel</button>
          <button onClick={handleImport} disabled={!ticker.trim() || !preview}
            className="px-5 py-2 text-[11px] tracking-[0.15em] uppercase font-mono bg-stone-900 text-stone-50 rounded hover:bg-stone-800 disabled:bg-stone-400 disabled:cursor-not-allowed">
            Import
          </button>
        </div>
      </div>
    </div>
  );
};

// ============================================================================
// BACKUP MODAL — lenient parsing + preview + progress
// ============================================================================

const BackupModal = ({ portfolios, prices, onRestore, onClose }) => {
  const fileInputRef = useRef(null);
  const [restorePreview, setRestorePreview] = useState(null);
  const [restoring, setRestoring] = useState(false);
  const [restoreProgress, setRestoreProgress] = useState({ current: 0, total: 0, label: '' });
  const [restoreError, setRestoreError] = useState(null);

  const handleExport = () => {
    const data = { version: STORAGE_VERSION, exportedAt: new Date().toISOString(), portfolios, prices };
    const json = JSON.stringify(data, null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    const stamp = new Date().toISOString().slice(0, 10);
    a.href = url;
    a.download = `portfolio-comparator-${stamp}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 100);
  };

  // LENIENT PARSER — accept any data that looks vaguely correct, skip the rest
  const parseBackupFile = (raw) => {
    const skipped = { portfolios: 0, prices: 0, priceEntries: 0 };

    // Portfolios
    const validPortfolios = [];
    if (Array.isArray(raw.portfolios)) {
      raw.portfolios.forEach((p, idx) => {
        if (!p || typeof p !== 'object') { skipped.portfolios++; return; }
        const id = (typeof p.id === 'string' && p.id) || `imported-${Date.now()}-${idx}`;
        const name = (typeof p.name === 'string' && p.name.trim()) || 'Unnamed';
        const subtitle = typeof p.subtitle === 'string' ? p.subtitle : '';
        const kind = ['mine', 'benchmark', 'guru', 'custom'].includes(p.kind) ? p.kind : 'custom';
        const color = (typeof p.color === 'string' && /^#[0-9a-fA-F]{6}$/.test(p.color)) ? p.color : PALETTE[idx % PALETTE.length];
        const visible = typeof p.visible === 'boolean' ? p.visible : true;
        const locked = typeof p.locked === 'boolean' ? p.locked : false;
        const holdings = Array.isArray(p.holdings)
          ? p.holdings
              .filter(h => h && typeof h === 'object' && typeof h.ticker === 'string' && h.ticker.trim() && (typeof h.weight === 'number' || typeof h.weight === 'string'))
              .map(h => ({ ticker: h.ticker.trim().toUpperCase(), weight: parseFloat(h.weight) || 0 }))
              .filter(h => h.weight > 0)
          : [];
        validPortfolios.push({ id, name, subtitle, kind, color, visible, locked, holdings });
      });
    }

    // Prices — handle unwrapped {date: price}, wrapped {data: {date: price}, importedAt}, and array form
    const cleanPrices = {};
    const rawPrices = (raw.prices && typeof raw.prices === 'object' && !Array.isArray(raw.prices)) ? raw.prices : {};
    Object.entries(rawPrices).forEach(([ticker, priceData]) => {
      if (typeof ticker !== 'string' || !ticker.trim()) { skipped.prices++; return; }
      let priceMap = priceData;
      if (priceData && typeof priceData === 'object' && priceData.data && typeof priceData.data === 'object') {
        priceMap = priceData.data;
      }
      if (!priceMap || typeof priceMap !== 'object') { skipped.prices++; return; }
      const cleaned = {};
      Object.entries(priceMap).forEach(([date, price]) => {
        if (typeof date !== 'string') { skipped.priceEntries++; return; }
        const isoDate = /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : null;
        const numPrice = typeof price === 'number' ? price : parseFloat(price);
        if (isoDate && !isNaN(numPrice) && numPrice > 0) cleaned[isoDate] = numPrice;
        else skipped.priceEntries++;
      });
      if (Object.keys(cleaned).length > 0) cleanPrices[ticker.trim().toUpperCase()] = cleaned;
      else skipped.prices++;
    });

    return { portfolios: validPortfolios, prices: cleanPrices, skipped };
  };

  const handleFileSelect = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setRestoreError(null);
    setRestorePreview(null);
    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const raw = JSON.parse(ev.target.result);
        const parsed = parseBackupFile(raw);
        if (parsed.portfolios.length === 0 && Object.keys(parsed.prices).length === 0) {
          throw new Error('No valid portfolios or prices found in this file');
        }
        const totalPoints = Object.values(parsed.prices).reduce((s, p) => s + Object.keys(p).length, 0);
        setRestorePreview({
          fileName: file.name,
          fileSize: file.size,
          version: raw.version || 'unknown',
          exportedAt: raw.exportedAt,
          portfolios: parsed.portfolios,
          prices: parsed.prices,
          totalPoints,
          skipped: parsed.skipped
        });
      } catch (err) {
        setRestoreError(`${err.message}`);
      }
    };
    reader.onerror = () => setRestoreError('Could not read file');
    reader.readAsText(file);
    // Allow re-selecting same file later
    e.target.value = '';
  };

  const performRestore = async () => {
    if (!restorePreview) return;
    setRestoring(true);
    setRestoreError(null);
    setRestoreProgress({ current: 0, total: Object.keys(restorePreview.prices).length, label: 'Saving portfolios...' });
    try {
      await onRestore(restorePreview, (current, total, label) => {
        setRestoreProgress({ current, total, label });
      });
      setRestoring(false);
      onClose();
    } catch (err) {
      setRestoreError(`Restore failed: ${err.message || err}`);
      setRestoring(false);
    }
  };

  const portfolioCount = portfolios.length;
  const tickerCount = Object.keys(prices).length;
  const totalPointsCurrent = Object.values(prices).reduce((s, p) => s + Object.keys(p).length, 0);

  return (
    <div className="fixed inset-0 bg-stone-900/40 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="bg-stone-50 border border-stone-300 rounded-lg max-w-md w-full overflow-hidden shadow-2xl">
        <div className="px-6 py-4 border-b border-stone-200 flex items-center justify-between">
          <h2 className="text-xl tracking-tight font-serif" style={{ color: 'var(--text-primary)' }}>Backup & Restore</h2>
          <button onClick={onClose} disabled={restoring} className="text-stone-500 hover:text-stone-800 disabled:opacity-30"><X size={20} /></button>
        </div>
        <div className="px-6 py-5 space-y-5">
          <div className="bg-white border border-stone-200 rounded p-3 text-[11px] font-mono text-stone-700">
            <div>Current state:</div>
            <div className="mt-1 text-stone-500">
              · {portfolioCount} portfolios<br />
              · {tickerCount} tickers · {totalPointsCurrent.toLocaleString()} price points
            </div>
          </div>

          <div>
            <button onClick={handleExport} disabled={restoring}
              className="w-full flex items-center justify-center gap-2 px-4 py-3 text-[11px] tracking-[0.15em] uppercase font-mono bg-stone-900 text-stone-50 rounded hover:bg-stone-800 disabled:bg-stone-400">
              <Download size={13} /> Download backup file
            </button>
          </div>

          <div className="border-t border-stone-200 pt-5 space-y-3">
            <input type="file" accept=".json,application/json" ref={fileInputRef} onChange={handleFileSelect} className="hidden" />

            {!restorePreview && !restoring && (
              <button onClick={() => fileInputRef.current?.click()}
                className="w-full flex items-center justify-center gap-2 px-4 py-3 text-[11px] tracking-[0.15em] uppercase font-mono bg-white border border-stone-400 text-stone-800 rounded hover:bg-stone-100">
                <Upload size={13} /> Restore from backup file
              </button>
            )}

            {restorePreview && !restoring && (
              <div className="space-y-3">
                <div className="bg-emerald-50 border border-emerald-300 rounded p-3">
                  <div className="flex items-center gap-2 text-[12px] font-mono text-emerald-900 font-medium mb-2">
                    <Check size={13} /> File loaded
                  </div>
                  <div className="text-[11px] font-mono text-stone-700 space-y-0.5">
                    <div className="truncate">· {restorePreview.fileName}</div>
                    <div>· Version <span className="text-stone-900">{restorePreview.version}</span> · exported {restorePreview.exportedAt ? new Date(restorePreview.exportedAt).toLocaleDateString() : 'unknown date'}</div>
                    <div>· <span className="text-stone-900 font-medium">{restorePreview.portfolios.length}</span> portfolios</div>
                    <div>· <span className="text-stone-900 font-medium">{Object.keys(restorePreview.prices).length}</span> tickers · {restorePreview.totalPoints.toLocaleString()} price points</div>
                    {(restorePreview.skipped.portfolios > 0 || restorePreview.skipped.prices > 0 || restorePreview.skipped.priceEntries > 0) && (
                      <div className="text-amber-700 mt-1.5 pt-1.5 border-t border-emerald-200">
                        ⚠ Skipped during parsing: {restorePreview.skipped.portfolios} bad portfolios, {restorePreview.skipped.prices} bad tickers, {restorePreview.skipped.priceEntries} bad price entries
                      </div>
                    )}
                  </div>
                </div>
                <div className="text-[11px] font-mono text-amber-800 bg-amber-50 border border-amber-200 rounded p-2.5">
                  ⚠ This replaces all current data. Download a backup of current state first if you want to preserve it.
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <button onClick={() => { setRestorePreview(null); setRestoreError(null); }}
                    className="px-4 py-2.5 text-[11px] tracking-[0.15em] uppercase font-mono bg-white border border-stone-400 text-stone-800 rounded hover:bg-stone-100">
                    Cancel
                  </button>
                  <button onClick={performRestore}
                    className="px-4 py-2.5 text-[11px] tracking-[0.15em] uppercase font-mono bg-amber-700 text-white rounded hover:bg-amber-800">
                    Confirm restore
                  </button>
                </div>
              </div>
            )}

            {restoring && (
              <div className="space-y-3">
                <div className="text-[12px] font-mono text-stone-800 flex items-center gap-2">
                  <Loader2 size={14} className="animate-spin" /> {restoreProgress.label}
                </div>
                {restoreProgress.total > 0 && (
                  <div>
                    <div className="h-2 bg-stone-200 rounded-full overflow-hidden">
                      <div className="h-full bg-amber-700 transition-all duration-150"
                        style={{ width: `${(restoreProgress.current / restoreProgress.total) * 100}%` }} />
                    </div>
                    <div className="text-[10px] font-mono text-stone-500 mt-1 tabular-nums">
                      {restoreProgress.current} / {restoreProgress.total}
                    </div>
                  </div>
                )}
              </div>
            )}

            {restoreError && (
              <div className="text-[11px] font-mono text-red-800 bg-red-50 border border-red-300 rounded p-2.5 flex items-start gap-1.5">
                <AlertCircle size={11} className="mt-0.5 flex-shrink-0" /> <div>{restoreError}</div>
              </div>
            )}
          </div>
        </div>
        <div className="px-6 py-4 border-t border-stone-200 flex items-center justify-end bg-stone-100/50">
          <button onClick={onClose} disabled={restoring} className="px-4 py-2 text-[11px] tracking-[0.15em] uppercase text-stone-600 hover:text-stone-900 font-mono disabled:opacity-30">Close</button>
        </div>
      </div>
    </div>
  );
};

// ============================================================================
// DATA AUDIT MODAL — heatmap of tickers × months for data validation
// ============================================================================

const DataAuditModal = ({ prices, onClose }) => {
  // Collect all tickers that have data
  const tickers = Object.keys(prices).filter(t => Object.keys(prices[t]).length > 0).sort();

  // Collect all unique months across all tickers
  const allMonthsSet = new Set();
  const tickerMonths = {};  // ticker -> Set<YYYY-MM>
  const tickerDates = {};   // ticker -> sorted array of YYYY-MM-DD
  tickers.forEach(t => {
    const dates = Object.keys(prices[t]).sort();
    tickerDates[t] = dates;
    const months = new Set(dates.map(d => d.slice(0, 7)));
    tickerMonths[t] = months;
    months.forEach(m => allMonthsSet.add(m));
  });
  const allMonths = [...allMonthsSet].sort();

  // Majority range — what most tickers cover
  const rangeCounts = {};  // "startMonth|endMonth" -> count
  tickers.forEach(t => {
    const months = [...tickerMonths[t]].sort();
    if (months.length === 0) return;
    const key = `${months[0]}|${months[months.length - 1]}`;
    rangeCounts[key] = (rangeCounts[key] || 0) + 1;
  });
  const majorityRange = Object.entries(rangeCounts).sort((a, b) => b[1] - a[1])[0];
  const [majorityStart, majorityEnd] = majorityRange ? majorityRange[0].split('|') : ['', ''];
  const majorityMonths = allMonths.filter(m => m >= majorityStart && m <= majorityEnd);
  const majorityPointCount = majorityMonths.length;

  // Classify tickers
  const issues = [];  // { ticker, type, detail }
  tickers.forEach(t => {
    const months = [...tickerMonths[t]].sort();
    if (months.length === 0) return;
    const start = months[0];
    const end = months[months.length - 1];
    // Different range than majority
    if (start !== majorityStart || end !== majorityEnd) {
      issues.push({ ticker: t, type: 'range', detail: `${formatMonthLabel(start)} → ${formatMonthLabel(end)} (expected ${formatMonthLabel(majorityStart)} → ${formatMonthLabel(majorityEnd)})` });
    }
    // Gaps — missing months within range
    const expectedInRange = allMonths.filter(m => m >= start && m <= end);
    const gaps = expectedInRange.filter(m => !tickerMonths[t].has(m));
    if (gaps.length > 0) {
      issues.push({ ticker: t, type: 'gap', detail: `missing ${gaps.map(formatMonthLabel).join(', ')}` });
    }
    // Different point count than majority
    if (months.length !== majorityPointCount && start === majorityStart && end === majorityEnd) {
      issues.push({ ticker: t, type: 'count', detail: `${months.length} pts vs expected ${majorityPointCount}` });
    }
  });

  const issueTickerSet = new Set(issues.map(i => i.ticker));

  return (
    <div className="fixed inset-0 bg-black/40 flex items-start justify-center z-50 p-4 overflow-y-auto" onClick={onClose}>
      <div className="bg-[#fdfbf6] rounded-lg shadow-xl border border-stone-300 w-full max-w-[95vw] my-8" onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div className="px-6 py-4 border-b border-stone-300 flex items-center justify-between">
          <div>
            <div className="text-[10px] tracking-[0.2em] uppercase text-stone-500 font-mono">Data audit</div>
            <div className="text-[15px] font-serif text-stone-900 mt-0.5">
              {tickers.length} tickers · {allMonths.length} months · {issues.length === 0 ? 'all clear' : `${issues.length} issue${issues.length > 1 ? 's' : ''}`}
            </div>
          </div>
          <button onClick={onClose} className="p-2 hover:bg-stone-200 rounded text-stone-500 hover:text-stone-800"><X size={16} /></button>
        </div>

        {/* Issues summary */}
        {issues.length > 0 && (
          <div className="px-6 py-3 bg-amber-50/80 border-b border-stone-300">
            <div className="text-[10px] tracking-[0.15em] uppercase text-amber-800 font-mono font-medium mb-2">Issues found</div>
            <div className="space-y-1">
              {issues.map((iss, i) => (
                <div key={i} className="text-[11px] font-mono text-amber-900 flex items-start gap-2">
                  <AlertCircle size={11} className="flex-shrink-0 mt-0.5 text-amber-600" />
                  <span><span className="font-medium">{iss.ticker}</span> — {iss.type}: {iss.detail}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Heatmap grid */}
        <div className="overflow-auto max-h-[70vh]">
          <table className="w-full border-collapse" style={{ minWidth: allMonths.length * 44 + 90 }}>
            <thead className="sticky top-0 z-10">
              <tr className="bg-stone-100">
                <th className="text-left text-[10px] font-mono text-stone-600 uppercase tracking-wider px-3 py-2 border-b border-r border-stone-300 sticky left-0 bg-stone-100 z-20 min-w-[80px]">Ticker</th>
                {allMonths.map(m => (
                  <th key={m} className="text-center text-[9px] font-mono text-stone-500 px-1 py-2 border-b border-stone-300 whitespace-nowrap min-w-[40px]">{formatMonthLabel(m)}</th>
                ))}
                <th className="text-center text-[10px] font-mono text-stone-600 px-2 py-2 border-b border-l border-stone-300 min-w-[36px]">Pts</th>
              </tr>
            </thead>
            <tbody>
              {tickers.map(t => {
                const months = tickerMonths[t];
                const hasIssue = issueTickerSet.has(t);
                return (
                  <tr key={t} className={`${hasIssue ? 'bg-amber-50/50' : 'hover:bg-stone-50'} transition-colors`}>
                    <td className={`text-[11px] font-mono px-3 py-1.5 border-b border-r border-stone-200 sticky left-0 z-10 ${hasIssue ? 'bg-amber-50/80 text-amber-900 font-medium' : 'bg-[#fdfbf6] text-stone-800'}`}>{t}</td>
                    {allMonths.map(m => {
                      const has = months.has(m);
                      const inMajority = m >= majorityStart && m <= majorityEnd;
                      // Cell color logic
                      let cellClass = '';
                      if (has) {
                        cellClass = 'bg-emerald-200/70';  // has data
                      } else if (inMajority) {
                        cellClass = 'bg-red-200/60';  // expected but missing
                      } else {
                        cellClass = '';  // outside range, no data expected
                      }
                      return (
                        <td key={m} className={`border-b border-stone-200 p-0`}>
                          <div className={`w-full h-6 ${cellClass}`} title={`${t} · ${m} · ${has ? 'has data' : 'no data'}`} />
                        </td>
                      );
                    })}
                    <td className={`text-[10px] font-mono text-center px-2 py-1.5 border-b border-l border-stone-200 tabular-nums ${[...months].length !== majorityPointCount ? 'text-amber-700 font-medium' : 'text-stone-500'}`}>
                      {[...months].length}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {/* Legend */}
        <div className="px-6 py-3 border-t border-stone-300 bg-stone-50/60 flex items-center gap-5 flex-wrap">
          <div className="flex items-center gap-1.5 text-[10px] font-mono text-stone-600">
            <div className="w-3 h-3 rounded-sm bg-emerald-200/70 border border-emerald-300" /> has data
          </div>
          <div className="flex items-center gap-1.5 text-[10px] font-mono text-stone-600">
            <div className="w-3 h-3 rounded-sm bg-red-200/60 border border-red-300" /> expected, missing
          </div>
          <div className="flex items-center gap-1.5 text-[10px] font-mono text-stone-600">
            <div className="w-3 h-3 rounded-sm bg-white border border-stone-300" /> outside range
          </div>
          <div className="ml-auto text-[10px] font-mono text-stone-500">
            majority range: {formatMonthLabel(majorityStart)} → {formatMonthLabel(majorityEnd)} · {majorityPointCount} pts
          </div>
        </div>
      </div>
    </div>
  );
};

const formatMonthLabel = (ym) => {
  if (!ym) return '?';
  const [y, m] = ym.split('-');
  const names = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  return `${names[parseInt(m) - 1]} ${y.slice(2)}`;
};

// ============================================================================
// DATA MANAGER
// ============================================================================

const DataManager = ({ neededTickers, prices, onImport, onDelete }) => {
  const [showAudit, setShowAudit] = useState(false);
  const status = neededTickers.map(t => ({
    ticker: t,
    hasData: !!prices[t],
    pointCount: prices[t] ? Object.keys(prices[t]).length : 0,
    range: prices[t] ? (() => {
      const dates = Object.keys(prices[t]).sort();
      return `${formatDateNice(dates[0])} → ${formatDateNice(dates[dates.length - 1])}`;
    })() : null
  }));
  status.sort((a, b) => {
    if (a.hasData !== b.hasData) return a.hasData ? 1 : -1;
    return a.ticker.localeCompare(b.ticker);
  });
  const haveCount = status.filter(s => s.hasData).length;
  const missingCount = status.length - haveCount;

  return (
    <div className="bg-white/70 border border-stone-300 rounded-lg overflow-hidden flex flex-col shadow-sm sticky top-6 max-h-[calc(100vh-3rem)]">
      <div className="px-4 py-3 border-b border-stone-300 bg-stone-100/60">
        <div className="text-[10px] tracking-[0.2em] uppercase text-stone-700 font-mono flex items-center gap-2">
          Price data · {haveCount}/{neededTickers.length}
          <button onClick={() => setShowAudit(true)} className="ml-auto p-1 hover:bg-stone-200 rounded text-stone-500 hover:text-stone-800 transition-colors" title="Audit price data">
            <LayoutGrid size={12} />
          </button>
        </div>
        {missingCount > 0 && <div className="text-[10px] font-mono text-amber-700 mt-1">{missingCount} missing — shown at top</div>}
      </div>
      {showAudit && <DataAuditModal prices={prices} onClose={() => setShowAudit(false)} />}
      <div className="flex-1 overflow-y-auto min-h-0">
        {status.map(s => (
          <div key={s.ticker} className="group px-4 py-2 border-b border-stone-200/60 hover:bg-stone-100/40 flex items-center gap-3">
            <div className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${s.hasData ? 'bg-emerald-600' : 'bg-amber-500'}`} />
            <div className="flex-1 min-w-0">
              <div className={`text-[12px] font-mono ${s.hasData ? 'text-stone-800' : 'text-stone-900 font-medium'}`}>{s.ticker}</div>
              <div className="text-[10px] font-mono text-stone-500 truncate">
                {s.hasData ? `${s.pointCount} pts · ${s.range}` : 'no data — needs import'}
              </div>
            </div>
            <div className="opacity-0 group-hover:opacity-100 transition-opacity flex items-center gap-1 flex-shrink-0">
              {s.hasData && (
                <button onClick={() => onDelete(s.ticker)} className="p-1 hover:bg-stone-200 rounded text-stone-400 hover:text-red-600">
                  <Trash2 size={10} />
                </button>
              )}
              <button onClick={() => onImport(s.ticker)}
                className="text-[9px] tracking-[0.1em] uppercase font-mono text-stone-700 hover:text-amber-800 px-2 py-1 hover:bg-stone-200 rounded">
                {s.hasData ? 'Replace' : 'Import'}
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

// ============================================================================
// CONSENSUS PANEL — toggleable portfolios + merge dual-class + insights
// ============================================================================

const ConsensusPanel = ({ portfolios, disabledHoldings, onSetVisibility, onIsolate }) => {
  const [mergeMode, setMergeMode] = useState(true);
  const [showMergedDetails, setShowMergedDetails] = useState(false);
  // 'held' = aggregate current weights (consensus by holdings).
  // 'bought' = aggregate positive Δ vs the last history snapshot (consensus by recent buying).
  const [viewMode, setViewMode] = useState('held');

  // Investor portfolios only — benchmarks are comparison instruments, not investment choices.
  // (A non-benchmark portfolio holding VOO as a stock still contributes that ticker normally.)
  const allWithHoldings = portfolios.filter(p => p.kind !== 'benchmark' && p.holdings.length > 0);
  // Only visible+with-holdings — used for consensus computation
  const visibleNonEmpty = allWithHoldings.filter(p => p.visible);
  // A portfolio with every holding disabled by the eye toggle has no signal to contribute.
  const hasActiveHoldings = (p) => getActiveHoldings(p, disabledHoldings).length > 0;
  // For 'bought' mode we additionally need a prior snapshot to diff against.
  const hasPrevSnapshot = (p) => Array.isArray(p.history) && p.history.length > 0;

  // Pool chip click is the same gesture as Portfolios list / chart legend: toggle p.visible.
  // Modifier (Ctrl/Cmd/Shift) isolates. One source of truth — no per-panel "include" state.
  const handlePoolChipClick = (p, e) => {
    if (e && (e.ctrlKey || e.metaKey || e.shiftKey)) {
      onIsolate?.(p.id);
      return;
    }
    onSetVisibility?.(p.id, !p.visible);
  };
  // Drop portfolios whose every holding is eye-toggled-off — they shouldn't count toward N.
  // In 'bought' mode also drop portfolios without history (no prior snapshot to diff against).
  const includedPortfolios = visibleNonEmpty
    .filter(hasActiveHoldings)
    .filter(p => viewMode !== 'held' ? hasPrevSnapshot(p) : true);
  const N = includedPortfolios.length;

  // Build a {normalizedTicker → renormalized 100%-sum weight} map for an arbitrary holdings array,
  // applying eye-toggle filter and dual-class merging in one place.
  const contribFor = (holdings, p, originalsAcc) => {
    const disabled = disabledHoldings[p.id];
    const active = disabled?.size
      ? (holdings || []).filter(h => !disabled.has(h.ticker.trim().toUpperCase()))
      : (holdings || []);
    const sum = active.reduce((s, h) => s + h.weight, 0);
    const out = {};
    if (sum === 0) return out;
    active.forEach(h => {
      const orig = h.ticker.toUpperCase();
      const norm = normalizeTicker(orig, mergeMode);
      const w = (h.weight / sum) * 100;
      out[norm] = (out[norm] || 0) + w;
      if (originalsAcc) {
        if (!originalsAcc[norm]) originalsAcc[norm] = new Set();
        originalsAcc[norm].add(orig);
      }
    });
    return out;
  };

  const stats = useMemo(() => {
    const result = {};
    includedPortfolios.forEach(p => {
      const portfolioOriginals = {};
      const currContrib = contribFor(getActiveHoldings(p, disabledHoldings), p, portfolioOriginals);

      // Each portfolio's per-ticker contribution depends on the mode.
      let contrib;
      if ((viewMode === 'bought' || viewMode === 'sold') && p.history?.length) {
        // Latest history entry by asOf is the previous quarter.
        const prev = [...p.history].sort((a, b) => a.asOf.localeCompare(b.asOf))[p.history.length - 1];
        // For 'sold' the originals tracker is also fed from prev so fully-exited tickers keep names.
        const prevContrib = contribFor(prev.holdings, p, viewMode === 'sold' ? portfolioOriginals : null);
        contrib = {};
        if (viewMode === 'bought') {
          Object.keys(currContrib).forEach(t => {
            const delta = currContrib[t] - (prevContrib[t] || 0);
            if (delta > 0) contrib[t] = delta;
          });
        } else {
          // 'sold': aggregate magnitudes of weight reductions and full exits (positions in prev,
          // not in current). The score for a fully-sold ticker is its previous weight.
          const allTickers = new Set([...Object.keys(prevContrib), ...Object.keys(currContrib)]);
          allTickers.forEach(t => {
            const delta = (prevContrib[t] || 0) - (currContrib[t] || 0);
            if (delta > 0) contrib[t] = delta;
          });
        }
      } else {
        contrib = currContrib;
      }

      Object.entries(contrib).forEach(([t, weight]) => {
        if (!result[t]) result[t] = { ticker: t, total: 0, count: 0, holders: [], originals: new Set(), maxSingle: 0 };
        result[t].total += weight;
        result[t].count += 1;
        result[t].holders.push({ portfolio: p, weight });
        result[t].maxSingle = Math.max(result[t].maxSingle, weight);
        portfolioOriginals[t]?.forEach(o => result[t].originals.add(o));
      });
    });
    Object.values(result).forEach(s => {
      s.combined = N > 0 ? s.total / N : 0;
      const originalsList = [...s.originals].sort();
      s.merged = originalsList.length > 1 || (originalsList.length === 1 && originalsList[0] !== s.ticker);
      s.originalsList = originalsList;
    });
    return result;
  }, [includedPortfolios, mergeMode, N, viewMode, disabledHoldings]);

  if (visibleNonEmpty.length < 1) {
    return (
      <div className="bg-white/70 border border-stone-300 rounded-lg p-6 text-center text-[11px] font-mono text-stone-500 shadow-sm">
        Show at least 1 portfolio to see analytics
      </div>
    );
  }

  const sorted = Object.values(stats).sort((a, b) => b.combined - a.combined);
  const consensusTop = sorted.slice(0, 15);
  const consensusMax = consensusTop[0]?.combined || 1;
  // Ticker column width fits the longest ticker among shown rows — saves space on mobile.
  // Min 4ch keeps short-ticker portfolios from collapsing the column too tight.
  const tickerColWidth = `${Math.max(4, ...consensusTop.map(s => s.ticker.length)) + 0.5}ch`;

  // High-conviction insights: held by 1-2 portfolios but with weight ≥ 10%
  // Only meaningful when N >= 2 (otherwise everything is "high conviction")
  const highConviction = N >= 2 ? sorted
    .filter(s => s.count <= Math.max(1, Math.floor(N / 3)) && s.maxSingle >= 10)
    .sort((a, b) => b.maxSingle - a.maxSingle)
    .slice(0, 8) : [];

  const totalUnique = sorted.length;
  const heldByAll = sorted.filter(s => s.count === N).length;
  const heldByMultiple = sorted.filter(s => s.count >= 2).length;
  const mergedCount = sorted.filter(s => s.merged).length;
  const singlePortfolio = N === 1 ? includedPortfolios[0] : null;

  return (
    <div className="space-y-4">
      <div className="bg-white/70 border border-stone-300 rounded-lg overflow-hidden shadow-sm">
        <div className="px-5 py-4 border-b border-stone-300 bg-stone-100/60">
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div className="text-[15px] font-serif tracking-tight text-stone-900" style={{ fontWeight: 500 }}>
              {viewMode === 'bought'
                ? (N === 1 ? `Recent buys · ${singlePortfolio.name}` : 'Recent buys')
                : viewMode === 'sold'
                  ? (N === 1 ? `Recent sells · ${singlePortfolio.name}` : 'Recent sells')
                  : (N === 1 ? `Holdings of ${singlePortfolio.name}` : 'Consensus picks')}
            </div>
            <div className="flex items-center gap-4 flex-wrap">
              <label className="flex items-center gap-1.5 text-[10px] font-mono text-stone-700 cursor-pointer select-none">
                <input type="checkbox" checked={mergeMode} onChange={(e) => setMergeMode(e.target.checked)}
                  className="accent-amber-700" />
                <span>Merge dual-class</span>
              </label>
              <div className="flex items-center gap-3 text-[10px] font-mono text-stone-700">
                <div><span className="tabular-nums text-stone-900 font-medium">{totalUnique}</span> unique</div>
                {mergeMode && mergedCount > 0 && (
                  <div className="relative">
                    <button onClick={() => setShowMergedDetails(s => !s)}
                      className="hover:text-stone-900 transition-colors cursor-pointer">
                      <span className="tabular-nums text-amber-800 font-medium">{mergedCount}</span> merged
                    </button>
                    {showMergedDetails && (
                      <>
                        <div className="fixed inset-0 z-10" onClick={() => setShowMergedDetails(false)} />
                        <div className="absolute right-0 top-full mt-1.5 z-20 bg-white border border-stone-300 rounded shadow-lg p-3 min-w-[240px] max-w-[320px]">
                          <div className="text-[9px] tracking-[0.15em] uppercase text-stone-500 font-mono mb-2 flex items-center gap-1.5">
                            <Link2 size={10} className="text-amber-700" />
                            <span>{mergedCount} merged ticker{mergedCount > 1 ? 's' : ''}</span>
                          </div>
                          <div className="space-y-1 max-h-64 overflow-y-auto">
                            {sorted.filter(s => s.merged).map(s => (
                              <div key={s.ticker} className="text-[11px] font-mono flex items-center gap-2">
                                <span className="text-stone-900 font-medium tabular-nums min-w-[3.5rem]">{s.ticker}</span>
                                <span className="text-stone-400">←</span>
                                <span className="text-amber-800">{s.originalsList.join(' + ')}</span>
                              </div>
                            ))}
                          </div>
                        </div>
                      </>
                    )}
                  </div>
                )}
                {N >= 2 && <div><span className="tabular-nums text-stone-900 font-medium">{heldByMultiple}</span> shared</div>}
                {N >= 2 && <div><span className="tabular-nums text-amber-700 font-medium">{heldByAll}</span> ★ all</div>}
              </div>
              <div className="flex items-center gap-0.5 bg-stone-200/60 rounded p-0.5">
                {[
                  { id: 'held',   label: 'Held',   tip: 'Aggregate current weights' },
                  { id: 'bought', label: 'Bought', tip: 'Aggregate positive Δ vs last quarter' },
                  { id: 'sold',   label: 'Sold',   tip: 'Aggregate weight cuts and full exits vs last quarter' },
                ].map(opt => (
                  <button key={opt.id} onClick={() => setViewMode(opt.id)}
                    className={`px-2.5 py-0.5 text-[10px] tracking-[0.05em] uppercase font-mono rounded transition-all ${
                      viewMode === opt.id ? 'bg-white text-stone-900 shadow-sm' : 'text-stone-600 hover:text-stone-800'
                    }`}
                    title={opt.tip}>
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>
          </div>
          <div className="text-[11px] text-stone-600 font-mono mt-1.5">
            {N === 0
              ? (viewMode === 'held'
                  ? 'No portfolios included — toggle below'
                  : 'No portfolios with quarterly history are included — toggle below')
              : viewMode === 'bought'
                ? `Sum of positive Δ since last quarter, across ${N} portfolio${N === 1 ? '' : 's'} with history`
                : viewMode === 'sold'
                  ? `Sum of weight cuts and full exits since last quarter, across ${N} portfolio${N === 1 ? '' : 's'} with history`
                  : (N === 1
                      ? `Sorted by weight · pool more portfolios below to compute consensus`
                      : `Combined weight from ${N} portfolios — what they collectively believe in`)}
          </div>
        </div>

        {N >= 1 ? (
          <div className="divide-y divide-stone-200/60">
            {consensusTop.map(s => (
              <div key={s.ticker} className="px-5 py-2.5 hover:bg-stone-100/40 transition-colors">
                <div className="flex items-center gap-3">
                  <div style={{ '--mobile-tw': tickerColWidth }}
                    className="w-20 max-[499px]:w-[var(--mobile-tw)] text-[12px] font-mono text-stone-800 font-medium flex items-center gap-1.5 flex-shrink-0">
                    <span>{s.ticker}</span>
                    {N >= 2 && s.count === N && <span className="text-amber-600 text-[11px]">★</span>}
                  </div>
                  <div className="flex-1 relative h-5 bg-stone-100 rounded overflow-hidden flex">
                    {s.holders.map((h, i) => {
                      const segWidth = (h.weight / N) / consensusMax * 100;
                      return (
                        <div key={i} className="h-full transition-all"
                          style={{ width: `${segWidth}%`, backgroundColor: h.portfolio.color, opacity: 0.85 }}
                          title={`${h.portfolio.name}: ${h.weight.toFixed(2)}%`} />
                      );
                    })}
                  </div>
                  <div className="text-[12px] font-mono tabular-nums text-stone-800 font-medium w-14 text-right flex-shrink-0">
                    {s.combined.toFixed(2)}%
                  </div>
                  {N >= 2 && <div className="text-[10px] font-mono text-stone-500 w-10 text-right flex-shrink-0">{s.count}/{N}</div>}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="p-6 text-center text-[11px] font-mono text-stone-500">
            No portfolios included — toggle some below
          </div>
        )}

        <div className="px-5 py-3 bg-stone-100/40">
          <div className="text-[9px] tracking-[0.2em] uppercase text-stone-600 font-mono mb-2">Pool <span className="normal-case tracking-normal text-stone-400">· click to hide / show · Ctrl/⌘/Shift+click to isolate</span></div>
          <div className="flex items-center gap-1.5 flex-wrap">
            {allWithHoldings.map(p => {
              const hidden = !p.visible;
              const cls = hidden
                ? 'bg-transparent border-stone-200 text-stone-400 line-through hover:text-stone-700 hover:border-stone-400'
                : 'bg-white border-stone-300 text-stone-800 hover:border-stone-500';
              const tip = hidden
                ? 'Click to show · Ctrl/⌘/Shift+click to isolate'
                : 'Click to hide · Ctrl/⌘/Shift+click to isolate';
              return (
                <button key={p.id} onClick={(e) => handlePoolChipClick(p, e)}
                  className={`flex items-center gap-1.5 text-[11px] font-mono px-2.5 py-1 rounded border transition-all ${cls}`}
                  title={tip}>
                  <div className="w-2 h-2 rounded-full" style={{
                    backgroundColor: p.color,
                    opacity: hidden ? 0.3 : 1
                  }} />
                  <span>{p.name}</span>
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {/* High-conviction picks (orthogonal to consensus) */}
      {highConviction.length > 0 && (
        <div className="bg-white/70 border border-stone-300 rounded-lg overflow-hidden shadow-sm">
          <div className="px-5 py-4 border-b border-stone-300 bg-stone-100/60">
            <div className="text-[15px] font-serif tracking-tight text-stone-900" style={{ fontWeight: 500 }}>
              {viewMode === 'bought' ? 'Concentrated buys'
                : viewMode === 'sold' ? 'Concentrated sells'
                : 'High-conviction bets'}
            </div>
            <div className="text-[11px] text-stone-600 font-mono mt-0.5">
              {viewMode === 'bought'
                ? 'Big add by 1–2 investors — non-consensus, concentrated buying signal'
                : viewMode === 'sold'
                  ? 'Big trim or full exit by 1–2 investors — non-consensus, concentrated selling signal'
                  : 'Held by few investors but with significant weight — non-consensus, high-conviction picks'}
            </div>
          </div>
          <div className="divide-y divide-stone-200/60">
            {highConviction.map(s => (
              <div key={s.ticker} className="px-5 py-2.5 hover:bg-stone-100/40 transition-colors">
                <div className="flex items-center gap-3">
                  <div style={{ '--mobile-tw': tickerColWidth }}
                    className="w-20 max-[499px]:w-[var(--mobile-tw)] text-[12px] font-mono text-stone-800 font-medium flex-shrink-0">
                    {s.ticker}
                  </div>
                  <div className="flex-1 flex items-center gap-1.5 flex-wrap">
                    {s.holders.map((h, i) => (
                      <div key={i} className="flex items-center gap-1 text-[11px] font-mono px-1.5 py-0.5 rounded bg-stone-100"
                        style={{ borderLeft: `2px solid ${h.portfolio.color}` }}>
                        <span className="text-stone-700">{h.portfolio.name}</span>
                        <span className="text-stone-900 tabular-nums font-medium">{h.weight.toFixed(1)}%</span>
                      </div>
                    ))}
                  </div>
                  <div className="text-[10px] font-mono text-stone-500 flex-shrink-0">
                    max <span className="text-stone-900 font-medium tabular-nums">{s.maxSingle.toFixed(1)}%</span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

// ============================================================================
// MAIN APP
// ============================================================================

const PERIOD_OPTIONS = [
  { id: '3M',  label: '3M' },
  { id: '6M',  label: '6M' },
  { id: 'YTD', label: 'YTD' },
  { id: '1Y',  label: '1Y' },
  { id: 'ALL', label: 'ALL' },
];

export default function PortfolioTracker() {
  const [portfolios, setPortfolios] = useState([]);
  const [prices, setPrices] = useState({});
  const [editing, setEditing] = useState(null);
  const [importing, setImporting] = useState(null);
  const [showBackup, setShowBackup] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [chartMode, setChartMode] = useState('absolute');
  const [chartPeriod, setChartPeriod] = useState('ALL');
  const [draggedId, setDraggedId] = useState(null);
  const [dragOverId, setDragOverId] = useState(null);
  const [defaultDataHash, setDefaultDataHash] = useState(null);
  const [saving, setSaving] = useState(false);
  const [disabledHoldings, setDisabledHoldings] = useState({});  // { portfolioId: Set<TICKER> } — transient, not saved
  const [darkMode, setDarkMode] = useState(() => {
    try { return localStorage.getItem('theme') === 'dark'; } catch { return false; }
  });

  useEffect(() => {
    document.documentElement.classList.toggle('dark', darkMode);
    try { localStorage.setItem('theme', darkMode ? 'dark' : 'light'); } catch {}
  }, [darkMode]);

  const toggleHoldingDisabled = (portfolioId, ticker) => {
    setDisabledHoldings(prev => {
      const next = { ...prev };
      const set = new Set(prev[portfolioId] || []);
      if (set.has(ticker)) set.delete(ticker);
      else set.add(ticker);
      next[portfolioId] = set;
      return next;
    });
  };

  // Simple hash for comparing data snapshots
  const computeHash = (portfolios, prices) => {
    const p = JSON.stringify(portfolios.map(p => ({ id: p.id, name: p.name, holdings: p.holdings, kind: p.kind })));
    const pr = JSON.stringify(Object.keys(prices).sort().map(t => [t, Object.keys(prices[t]).length]));
    let h = 0;
    const s = p + pr;
    for (let i = 0; i < s.length; i++) { h = ((h << 5) - h + s.charCodeAt(i)) | 0; }
    return h;
  };

  // Single source for the bundled default state. Used both for the "Save" hash comparison
  // and for bootstrapping when localStorage is empty / on Reset.
  const fetchDefaultData = async () => {
    try {
      const res = await fetch(import.meta.env.BASE_URL + 'default-data.json');
      if (!res.ok) return null;
      const raw = await res.json();
      return {
        portfolios: Array.isArray(raw.portfolios) ? raw.portfolios : null,
        prices: (raw.prices && typeof raw.prices === 'object') ? raw.prices : {}
      };
    } catch { return null; }
  };

  useEffect(() => {
    (async () => {
      await migrateToV8();
      const { portfolios: stored, prices: storedPrices } = await loadAllStorage();
      if (stored) {
        // Existing local state — keep it untouched.
        setPortfolios(stored);
        setPrices(storedPrices);
        // Still grab the default hash so the Save button reflects unsaved changes.
        const def = await fetchDefaultData();
        if (def?.portfolios) setDefaultDataHash(computeHash(def.portfolios, def.prices));
      } else {
        // First-time visit / cleared storage — bootstrap from default-data.json so the user's
        // Save target is what gets read back. DEFAULT_PORTFOLIOS stays as a hardcoded fallback
        // for the case where the JSON is unreachable.
        const def = await fetchDefaultData();
        if (def?.portfolios) {
          setPortfolios(def.portfolios);
          setPrices(def.prices || {});
          await savePortfolios(def.portfolios);
          if (def.prices && Object.keys(def.prices).length > 0) {
            await savePricesAll(def.prices);
          }
          setDefaultDataHash(computeHash(def.portfolios, def.prices));
        } else {
          setPortfolios(DEFAULT_PORTFOLIOS);
          setPrices({});
        }
      }
      setLoaded(true);
    })();
  }, []);

  const currentDataHash = useMemo(() => {
    if (!loaded) return null;
    return computeHash(portfolios, prices);
  }, [portfolios, prices, loaded]);

  const hasUnsavedChanges = loaded && defaultDataHash !== null && currentDataHash !== defaultDataHash;

  const handleSaveDefault = async () => {
    if (saving) return;
    setSaving(true);
    try {
      const data = { version: STORAGE_VERSION, exportedAt: new Date().toISOString(), portfolios, prices };
      const res = await fetch('/api/save-default', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data)
      });
      if (!res.ok) throw new Error('Save failed');
      // Update the hash to match what we just saved
      setDefaultDataHash(currentDataHash);
    } catch (err) {
      console.error('[save] Failed to save default data:', err);
      alert('Failed to save: ' + err.message);
    } finally {
      setSaving(false);
    }
  };

  useEffect(() => { if (loaded) savePortfolios(portfolios); }, [portfolios, loaded]);

  // A ticker is "needed" only if it's enabled (not eye-toggled-off) in at least one portfolio.
  // Considers BOTH current holdings and historical snapshots — a ticker that only ever appears in
  // an old quarter still drives the chain-linked chart and so must be in the price coverage list.
  const neededTickers = useMemo(() => {
    const set = new Set();
    portfolios.forEach(p => {
      const disabled = disabledHoldings[p.id];
      const allHoldings = [
        ...(p.holdings || []),
        ...(p.history || []).flatMap(s => s.holdings || [])
      ];
      allHoldings.forEach(h => {
        const t = h.ticker.toUpperCase();
        if (!disabled?.has(t)) set.add(t);
      });
    });
    return [...set].sort();
  }, [portfolios, disabledHoldings]);

  const portfolioSeries = useMemo(() => {
    const result = {};
    portfolios.forEach(p => {
      const disabled = disabledHoldings[p.id];
      // Filter the eye-toggled tickers out of CURRENT and EVERY history snapshot — the user wants
      // the portfolio to behave as if the disabled position never existed at any point in time.
      // computeSeries renormalizes weights per snapshot, so the freed weight redistributes onto
      // the remaining positions (the Amazon/Google example).
      const filterHoldings = (hs) => disabled?.size
        ? (hs || []).filter(h => !disabled.has(h.ticker.trim().toUpperCase()))
        : hs;
      const filtered = {
        ...p,
        holdings: filterHoldings(p.holdings),
        history: p.history ? p.history.map(s => ({ ...s, holdings: filterHoldings(s.holdings) })) : undefined,
      };
      result[p.id] = computeSeries(filtered, prices);
    });
    return result;
  }, [portfolios, prices, disabledHoldings]);

  const availableBenchmarks = useMemo(
    () => portfolios.filter(p => p.kind === 'benchmark' && portfolioSeries[p.id]),
    [portfolios, portfolioSeries]
  );

  // Investor portfolios = everything that's not a benchmark.
  // Benchmarks are comparison instruments; they appear in the chart in absolute mode and
  // as `vs X` mode buttons, but not in the portfolios list, consensus, high-conviction, or vs-mode legend.
  const investorPortfolios = useMemo(
    () => portfolios.filter(p => p.kind !== 'benchmark'),
    [portfolios]
  );

  const benchmarkPortfolio = useMemo(() => {
    if (chartMode === 'absolute') return null;
    return portfolios.find(p => p.id === chartMode && portfolioSeries[p.id]) || null;
  }, [chartMode, portfolios, portfolioSeries]);

  const effectiveMode = benchmarkPortfolio ? 'vs' : 'absolute';

  // Legend shows all portfolios in absolute mode; only investor portfolios in vs mode
  // (benchmarks are the baseline — drawing them in vs mode is silly).
  const legendPortfolios = effectiveMode === 'vs' ? investorPortfolios : portfolios;

  // Step 1: build full chart data (in chosen mode)
  const fullChartData = useMemo(() => {
    const visible = portfolios.filter(p => p.visible && portfolioSeries[p.id]);
    if (!visible.length) return [];

    // vs-mode: a date is plottable only when the benchmark itself has a point for it. Each
    // portfolio still appears only on dates where IT has a point — Recharts handles the gaps.
    if (effectiveMode === 'vs' && benchmarkPortfolio) {
      const benchSeries = portfolioSeries[benchmarkPortfolio.id];
      const benchByDate = new Map(benchSeries.map(d => [d.date, d.value]));
      const allDates = new Set();
      visible.forEach(p => portfolioSeries[p.id].forEach(d => { if (benchByDate.has(d.date)) allDates.add(d.date); }));
      return [...allDates].sort().map(date => {
        const benchValue = benchByDate.get(date);
        const row = { date };
        visible.forEach(p => {
          const point = portfolioSeries[p.id].find(d => d.date === date);
          if (point && benchValue) row[p.id] = (point.value / benchValue) * 100;
        });
        return row;
      });
    }

    // Absolute mode: union of all dates across visible portfolios. Each portfolio appears only
    // on dates where it has data — earlier portfolios start earlier on the chart. Without union,
    // adding a single chain-linked portfolio (Taras Guk with Q3 history) used to compress the
    // common date range and silently truncate the others' history.
    const allDates = new Set();
    visible.forEach(p => portfolioSeries[p.id].forEach(d => allDates.add(d.date)));
    return [...allDates].sort().map(date => {
      const row = { date };
      visible.forEach(p => {
        const point = portfolioSeries[p.id].find(d => d.date === date);
        if (point) row[p.id] = point.value;
      });
      return row;
    });
  }, [portfolios, portfolioSeries, effectiveMode, benchmarkPortfolio]);

  // Step 2: filter by period and re-normalize so first row = 100
  const chartData = useMemo(() => {
    if (!fullChartData.length) return fullChartData;
    // Slice by period (ALL keeps everything).
    let filtered = fullChartData;
    if (chartPeriod !== 'ALL') {
      const lastDate = new Date(fullChartData[fullChartData.length - 1].date);
      let cutoff;
      if (chartPeriod === '3M') { cutoff = new Date(lastDate); cutoff.setMonth(cutoff.getMonth() - 3); }
      else if (chartPeriod === '6M') { cutoff = new Date(lastDate); cutoff.setMonth(cutoff.getMonth() - 6); }
      else if (chartPeriod === 'YTD') { cutoff = new Date(lastDate.getFullYear(), 0, 1); }
      else if (chartPeriod === '1Y') { cutoff = new Date(lastDate); cutoff.setFullYear(cutoff.getFullYear() - 1); }
      if (cutoff) {
        const sliced = fullChartData.filter(d => new Date(d.date) >= cutoff);
        if (sliced.length >= 2) filtered = sliced;
      }
    }
    // Each portfolio is rebased to 100 at ITS OWN first available data point inside the slice,
    // not at the first row of the slice. This keeps every line starting at 100 even when
    // portfolios have different start dates (e.g. Taras Guk's chain-link begins later than VT).
    const firstByKey = {};
    for (const row of filtered) {
      for (const k of Object.keys(row)) {
        if (k === 'date') continue;
        if (firstByKey[k] === undefined && typeof row[k] === 'number') {
          firstByKey[k] = row[k];
        }
      }
    }
    return filtered.map(row => {
      const newRow = { date: row.date };
      Object.keys(row).forEach(k => {
        if (k === 'date') return;
        if (typeof row[k] === 'number' && firstByKey[k]) {
          newRow[k] = (row[k] / firstByKey[k]) * 100;
        }
      });
      return newRow;
    });
  }, [fullChartData, chartPeriod]);

  const getMissingTickers = (p) => getActiveHoldings(p, disabledHoldings)
    .filter(h => !prices[h.ticker.toUpperCase()]).map(h => h.ticker);
  const getCoveragePct = (p) => {
    const active = getActiveHoldings(p, disabledHoldings);
    const total = active.reduce((s, h) => s + h.weight, 0);
    const covered = active.filter(h => prices[h.ticker.toUpperCase()]).reduce((s, h) => s + h.weight, 0);
    return total > 0 ? Math.round(covered / total * 100) : 0;
  };

  const togglePortfolio = (id) => setPortfolios(prev => prev.map(p => p.id === id ? { ...p, visible: !p.visible } : p));
  const setPortfolioVisibility = (id, visible) => setPortfolios(prev => prev.map(p => p.id === id ? { ...p, visible } : p));

  // All/None/isolate operate only on what's shown in the legend.
  // In vs mode, that excludes benchmarks (their visibility is irrelevant since they're not drawn anyway).
  const selectAllPortfolios = () => {
    const ids = new Set(legendPortfolios.map(p => p.id));
    setPortfolios(prev => prev.map(p => ids.has(p.id) ? { ...p, visible: true } : p));
  };
  const deselectAllPortfolios = () => {
    const ids = new Set(legendPortfolios.map(p => p.id));
    setPortfolios(prev => prev.map(p => ids.has(p.id) ? { ...p, visible: false } : p));
  };

  // Shared isolate logic: when modifier-clicking, toggle "isolated to this one" ↔ "all visible".
  // `scopePortfolios` defines which portfolios get touched (others stay as they are).
  const isolatePortfolio = (id, scopePortfolios) => {
    const ids = new Set(scopePortfolios.map(p => p.id));
    const onlyThisVisible = scopePortfolios.every(p => p.id === id ? p.visible : !p.visible);
    if (onlyThisVisible) {
      // Already isolated → restore all in scope
      setPortfolios(prev => prev.map(p => ids.has(p.id) ? { ...p, visible: true } : p));
    } else {
      // Isolate this one within scope
      setPortfolios(prev => prev.map(p => ids.has(p.id) ? { ...p, visible: p.id === id } : p));
    }
  };

  const isModifier = (e) => !!(e && (e.ctrlKey || e.metaKey || e.shiftKey));

  // Modifier+click on legend chip: toggle isolation (only this visible) ↔ all visible.
  // Modifier = Ctrl on Win/Linux, Cmd on Mac, plus Shift as a universal alias.
  // Plain click: normal toggle.
  const handleLegendClick = (id, e) => {
    if (isModifier(e)) isolatePortfolio(id, legendPortfolios);
    else togglePortfolio(id);
  };

  // Same isolate logic for the Portfolios list (right-side card).
  // Scope = investor portfolios (benchmarks aren't shown here, so isolation doesn't touch them).
  const handleListToggle = (id, e) => {
    if (isModifier(e)) isolatePortfolio(id, investorPortfolios);
    else togglePortfolio(id);
  };

  // For consensus pool footer: scope = investor portfolios with holdings (what the panel shows).
  const isolateInConsensus = (id) => {
    const scope = investorPortfolios.filter(p => p.holdings.length > 0);
    isolatePortfolio(id, scope);
  };
  const startNew = () => setEditing({
    id: `custom-${Date.now()}`, name: '', subtitle: '', kind: 'custom',
    color: PALETTE[(portfolios.length + 1) % PALETTE.length], visible: true, locked: false, holdings: null
  });
  const saveEdit = (updated) => {
    if (portfolios.find(p => p.id === updated.id)) {
      setPortfolios(portfolios.map(p => p.id === updated.id ? updated : p));
    } else {
      setPortfolios([...portfolios, updated]);
    }
    setEditing(null);
  };
  const deletePortfolio = (id) => {
    if (!confirm('Delete this portfolio?')) return false;
    setPortfolios(portfolios.filter(p => p.id !== id));
    return true;
  };

  const handleImportPrice = async (ticker, data) => {
    const upper = ticker.toUpperCase();
    const newPrices = { ...prices, [upper]: data };
    setPrices(newPrices);
    await savePricesAll(newPrices);
    setImporting(null);
  };

  const handleDeletePrice = async (ticker) => {
    if (!confirm(`Delete stored prices for ${ticker}?`)) return;
    const upper = ticker.toUpperCase();
    const newPrices = { ...prices };
    delete newPrices[upper];
    setPrices(newPrices);
    await savePricesAll(newPrices);
  };

  const handleRestore = async (data, onProgress) => {
    onProgress?.(0, 2, 'Saving portfolios...');
    setPortfolios(data.portfolios);
    await savePortfolios(data.portfolios);

    onProgress?.(1, 2, `Saving ${Object.keys(data.prices).length} tickers...`);
    setPrices(data.prices);
    await savePricesAll(data.prices);

    onProgress?.(2, 2, 'Done');
  };

  // Reload everything (portfolios + prices) from the bundled default-data.json — the same source
  // that "Save" writes to. Discards any local edits, including any prices the user imported since.
  const resetToDefaults = async () => {
    if (saving) return;
    if (!confirm('Discard local changes and reload portfolios + prices from default-data.json?')) return;
    const def = await fetchDefaultData();
    if (!def?.portfolios) {
      alert('Could not reach default-data.json. Nothing changed.');
      return;
    }
    setPortfolios(def.portfolios);
    setPrices(def.prices || {});
  };

  const handleDragStart = (id) => setDraggedId(id);
  const handleDragOver = (e, id) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    if (id !== draggedId) setDragOverId(id);
  };
  const handleDragLeave = () => {};
  const handleDrop = (e, targetId) => {
    e.preventDefault();
    if (!draggedId || draggedId === targetId) {
      setDraggedId(null); setDragOverId(null); return;
    }
    const next = [...portfolios];
    const fromIdx = next.findIndex(p => p.id === draggedId);
    const toIdx = next.findIndex(p => p.id === targetId);
    if (fromIdx < 0 || toIdx < 0) return;
    const [moved] = next.splice(fromIdx, 1);
    next.splice(toIdx, 0, moved);
    setPortfolios(next);
    setDraggedId(null); setDragOverId(null);
  };
  const handleDragEnd = () => { setDraggedId(null); setDragOverId(null); };

  const dateRangeText = chartData.length > 0
    ? `${formatDateNice(chartData[0].date)} → ${formatDateNice(chartData[chartData.length - 1].date)}`
    : 'No data yet';
  const totalLoaded = neededTickers.filter(t => prices[t]).length;

  const vsVooDomain = useMemo(() => {
    if (effectiveMode !== 'vs' || chartData.length === 0) return ['auto', 'auto'];
    let min = 100, max = 100;
    chartData.forEach(row => {
      Object.entries(row).forEach(([k, v]) => {
        if (k === 'date' || typeof v !== 'number') return;
        min = Math.min(min, v);
        max = Math.max(max, v);
      });
    });
    const pad = Math.max(2, (max - min) * 0.1);
    return [Math.floor(min - pad), Math.ceil(max + pad)];
  }, [chartData, effectiveMode]);

  return (
    <div className="min-h-screen w-full" style={{
      background: darkMode
        ? 'linear-gradient(180deg, #0c0a09 0%, #1c1917 100%)'
        : 'linear-gradient(180deg, #faf7ee 0%, #f5f0e1 100%)',
      color: darkMode ? '#e7e5e4' : '#1a1815',
      fontFamily: "'Geist', -apple-system, sans-serif"
    }}>
      <link href="https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,300..600&family=Geist:wght@300;400;500;600&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet" />
      <style>{`
        * { font-family: inherit; }
        .font-mono { font-family: 'JetBrains Mono', ui-monospace, monospace !important; }
        .font-serif { font-family: 'Fraunces', ui-serif, Georgia, serif !important; font-optical-sizing: auto; }
        .recharts-cartesian-axis-tick-value { fill: ${darkMode ? '#78716c' : '#6b6660'}; font-family: 'JetBrains Mono', monospace; font-size: 10px; }
        input::placeholder, textarea::placeholder { color: ${darkMode ? '#57534e' : '#b8b3aa'}; }
      `}</style>

      <div className="max-w-[1600px] mx-auto px-6 py-8">
        <div className="mb-6">
          <div className="border-b border-stone-900 pb-1 mb-1">
            <div className="flex items-center justify-between">
              <div className="text-[10px] tracking-[0.3em] uppercase font-mono text-stone-700">Portfolio Comparator · Vol. 1</div>
              <div className="text-[10px] tracking-[0.2em] uppercase font-mono text-stone-600">
                {new Date().toLocaleDateString('en-US', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}
              </div>
            </div>
          </div>
          <div className="border-b-2 border-stone-900 pb-3">
            <div className="flex items-end justify-between flex-wrap gap-4">
              <div>
                <h1 className="text-4xl md:text-5xl tracking-[-0.025em] font-serif leading-[0.95]" style={{ fontWeight: 400 }}>
                  Performance,
                  <br />
                  <em style={{ color: darkMode ? '#d4a843' : '#a06b1c', fontWeight: 500 }}>side by side.</em>
                </h1>
                <div className="text-xs text-stone-600 mt-3 font-mono tracking-tight">
                  {dateRangeText} · base = 100 · {totalLoaded}/{neededTickers.length} tickers loaded
                </div>
              </div>
              <div className="flex items-center gap-2 flex-wrap">
                {hasUnsavedChanges && !saving && (
                  <button onClick={resetToDefaults}
                    className="flex items-center gap-2 px-3 py-2 text-[10px] tracking-[0.15em] uppercase text-stone-700 hover:text-stone-900 font-mono border border-stone-400 hover:border-stone-700 bg-white/60 rounded"
                    title="Discard local changes and reload from default-data.json">
                    <RotateCcw size={11} /> Reset
                  </button>
                )}
                <button onClick={handleSaveDefault} disabled={!hasUnsavedChanges || saving}
                  className="flex items-center gap-2 px-3 py-2 text-[10px] tracking-[0.15em] uppercase text-stone-700 hover:text-stone-900 font-mono border border-stone-400 hover:border-stone-700 bg-white/60 rounded disabled:text-stone-400 disabled:border-stone-300 disabled:bg-white/40 disabled:cursor-not-allowed disabled:hover:text-stone-400 disabled:hover:border-stone-300"
                  title={hasUnsavedChanges ? 'Save current data as default (overwrites default-data.json)' : 'No changes to save'}>
                  {saving ? <Loader2 size={11} className="animate-spin" /> : <HardDriveDownload size={11} />}
                  {saving ? 'Saving…' : 'Save'}
                </button>
                <button onClick={() => setShowBackup(true)}
                  className="flex items-center gap-2 px-3 py-2 text-[10px] tracking-[0.15em] uppercase text-stone-700 hover:text-stone-900 font-mono border border-stone-400 hover:border-stone-700 bg-white/60 rounded">
                  <Save size={11} /> Backup
                </button>
                <button onClick={() => setImporting('')}
                  className="flex items-center gap-2 px-3 py-2 text-[10px] tracking-[0.15em] uppercase text-stone-700 hover:text-stone-900 font-mono border border-stone-400 hover:border-stone-700 bg-white/60 rounded">
                  <Upload size={11} /> Import prices
                </button>
                <button onClick={startNew}
                  className="flex items-center gap-2 px-4 py-2 text-[10px] tracking-[0.15em] uppercase font-mono rounded transition-colors"
                  style={{
                    backgroundColor: darkMode ? '#fafaf9' : '#1c1917',
                    color: darkMode ? '#1c1917' : '#fafaf9'
                  }}
                  onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = darkMode ? '#e7e5e4' : '#292524'; }}
                  onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = darkMode ? '#fafaf9' : '#1c1917'; }}>
                  <Plus size={12} /> New portfolio
                </button>
                <button onClick={() => setDarkMode(!darkMode)}
                  className="p-2 text-stone-500 hover:text-stone-900 rounded border border-stone-300 hover:border-stone-700 bg-white/60 transition-colors"
                  title={darkMode ? 'Switch to light mode' : 'Switch to dark mode'}>
                  {darkMode ? <Sun size={13} /> : <Moon size={13} />}
                </button>
              </div>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-[1fr_380px] gap-6 items-start">
          <div className="space-y-6">
            <div className="bg-white/70 border border-stone-300 rounded-lg shadow-sm overflow-hidden">
              <div className="px-5 py-3 border-b border-stone-200 flex items-center justify-between flex-wrap gap-3">
                <div className="flex items-center gap-3">
                  <div className="text-[10px] tracking-[0.2em] uppercase text-stone-700 font-mono">
                    {effectiveMode === 'vs' ? `vs ${benchmarkPortfolio?.name || 'benchmark'}` : 'Absolute return'}
                  </div>
                  <div className="flex items-center gap-0.5 bg-stone-100 rounded p-0.5">
                    {PERIOD_OPTIONS.map(opt => (
                      <button key={opt.id} onClick={() => setChartPeriod(opt.id)}
                        className={`px-2.5 py-0.5 text-[10px] tracking-[0.05em] uppercase font-mono rounded transition-all ${
                          chartPeriod === opt.id ? 'bg-white text-stone-900 shadow-sm' : 'text-stone-600 hover:text-stone-800'
                        }`}>
                        {opt.label}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="flex items-center gap-1 bg-stone-100 rounded p-0.5">
                  <button onClick={() => setChartMode('absolute')}
                    className={`px-3 py-1 text-[10px] tracking-[0.1em] uppercase font-mono rounded transition-all ${
                      effectiveMode === 'absolute' ? 'bg-white text-stone-900 shadow-sm' : 'text-stone-600 hover:text-stone-800'
                    }`}>Absolute</button>
                  {availableBenchmarks.map(b => (
                    <button key={b.id} onClick={() => setChartMode(b.id)}
                      className={`px-3 py-1 text-[10px] tracking-[0.1em] uppercase font-mono rounded transition-all ${
                        chartMode === b.id ? 'bg-white text-stone-900 shadow-sm' : 'text-stone-600 hover:text-stone-800'
                      }`}>vs {b.name}</button>
                  ))}
                </div>
              </div>
              {legendPortfolios.length > 0 && (
                <div className="px-5 py-2.5 border-b border-stone-200 flex items-center gap-1.5 flex-wrap bg-stone-50/40">
                  <button onClick={selectAllPortfolios}
                    className="text-[10px] tracking-[0.1em] uppercase font-mono text-stone-500 hover:text-stone-900 px-2 py-1 transition-colors">
                    All
                  </button>
                  <button onClick={deselectAllPortfolios}
                    className="text-[10px] tracking-[0.1em] uppercase font-mono text-stone-500 hover:text-stone-900 px-2 py-1 transition-colors">
                    None
                  </button>
                  <span className="text-stone-300 mx-0.5 select-none">|</span>
                  {legendPortfolios.map(p => (
                    <button key={p.id} onClick={(e) => handleLegendClick(p.id, e)}
                      className={`flex items-center gap-1.5 text-[11px] font-mono px-2 py-1 rounded transition-all ${
                        p.visible ? 'text-stone-800 hover:bg-stone-200/60' : 'text-stone-400 line-through hover:bg-stone-100'
                      }`}
                      title={p.visible ? 'Click to hide · Ctrl/⌘/Shift+click to isolate' : 'Click to show · Ctrl/⌘/Shift+click to isolate'}>
                      <div className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{
                        backgroundColor: p.visible ? p.color : 'transparent',
                        border: `1.5px solid ${p.color}`,
                        opacity: p.visible ? 1 : 0.4
                      }} />
                      <span>{p.name}</span>
                    </button>
                  ))}
                </div>
              )}
              <div className="p-5 min-h-[280px] min-[500px]:min-h-[480px]">
                {chartMode !== 'absolute' && !benchmarkPortfolio && (
                  <div className="mb-3 px-3 py-2 bg-amber-50 border border-amber-300 rounded text-[10px] font-mono text-amber-800 flex items-center gap-2">
                    <AlertCircle size={11} /> Selected benchmark has no price data — showing absolute mode.
                  </div>
                )}
                {chartData.length === 0 ? (
                  <div className="h-full flex items-center justify-center text-stone-500 text-sm font-mono py-32 text-center">
                    <div>
                      <div className="mb-2">No data to chart yet.</div>
                      <div className="text-[10px] text-stone-400">Import prices for at least one ticker →</div>
                    </div>
                  </div>
                ) : (
                  <div className="h-[260px] min-[500px]:h-[460px]">
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={chartData} margin={{ top: 20, right: 30, left: 10, bottom: 10 }}>
                      <CartesianGrid strokeDasharray="2 4" stroke={darkMode ? '#292524' : '#e6e0d3'} vertical={false} />
                      <XAxis dataKey="date" tickFormatter={formatDateShort} stroke={darkMode ? '#57534e' : '#a8a39a'} tick={{ fontSize: 10 }} minTickGap={50} />
                      <YAxis domain={effectiveMode === 'vs' ? vsVooDomain : ['auto', 'auto']} hide={true} />
                      {effectiveMode === 'vs' && (
                        <>
                          <ReferenceArea y1={100} y2={vsVooDomain[1]} fill="#16a34a" fillOpacity={0.06} />
                          <ReferenceArea y1={vsVooDomain[0]} y2={100} fill="#dc2626" fillOpacity={0.06} />
                        </>
                      )}
                      <ReferenceLine y={100} stroke="var(--ref-line)" strokeDasharray="3 3" strokeOpacity={effectiveMode === 'vs' ? 0.5 : 0.3} />
                      <Tooltip
                        contentStyle={{ backgroundColor: darkMode ? '#292524' : '#fdfbf6', border: `1px solid ${darkMode ? '#44403c' : '#d6cfc0'}`, borderRadius: '4px', fontFamily: 'JetBrains Mono, monospace', fontSize: '11px', padding: '10px 12px', boxShadow: darkMode ? '0 4px 12px rgba(0,0,0,0.3)' : '0 4px 12px rgba(0,0,0,0.08)' }}
                        labelStyle={{ color: darkMode ? '#a8a29e' : '#6b6660', marginBottom: '6px', fontSize: '10px' }}
                        labelFormatter={formatDateNice}
                        formatter={(value, name) => {
                          const p = portfolios.find(p => p.id === name);
                          const pct = value - 100;
                          return [
                            <span key="v" style={{ color: pct >= 0 ? 'var(--success)' : 'var(--danger)', fontWeight: 500 }}>
                              {value.toFixed(2)} ({pct >= 0 ? '+' : ''}{pct.toFixed(2)}%)
                            </span>,
                            p?.name || name
                          ];
                        }}
                      />
                      {portfolios
                        .filter(p => p.visible && portfolioSeries[p.id])
                        .filter(p => effectiveMode !== 'vs' || p.kind !== 'benchmark')
                        // Recharts draws Lines in array order — later ones render on top.
                        // Benchmarks last so they sit above investor lines; VT above VOO.
                        .slice()
                        .sort((a, b) => {
                          const pri = (p) => p.id === 'vt' ? 3 : p.id === 'voo' ? 2 : p.kind === 'benchmark' ? 1 : 0;
                          return pri(a) - pri(b);
                        })
                        .map(p => (
                        <Line key={p.id} type="monotone" dataKey={p.id} stroke={p.color}
                          strokeWidth={p.kind === 'mine' ? 2.5 : 1.75} dot={false}
                          strokeDasharray={p.kind === 'benchmark' ? '8 3 1 3' : undefined}
                          activeDot={{ r: 4, strokeWidth: 0 }} isAnimationActive={false} />
                      ))}
                    </LineChart>
                  </ResponsiveContainer>
                  </div>
                )}
              </div>
            </div>

            <div className="bg-white/70 border border-stone-300 rounded-lg overflow-hidden shadow-sm">
              <div className="px-4 py-3 border-b border-stone-300 bg-stone-100/60 flex items-center justify-between">
                <div className="text-[10px] tracking-[0.2em] uppercase text-stone-700 font-mono">
                  Portfolios · {investorPortfolios.length} <span className="text-stone-400 normal-case tracking-normal">· drag to reorder</span>
                </div>
                <div className="text-[10px] tracking-[0.2em] uppercase text-stone-700 font-mono tabular-nums">return</div>
              </div>
              <div>
                {investorPortfolios.map(p => (
                  <PortfolioRow key={p.id} portfolio={p} performance={portfolioSeries[p.id]}
                    missingTickers={getMissingTickers(p)} coveragePct={getCoveragePct(p)}
                    disabledSet={disabledHoldings[p.id]}
                    onToggle={handleListToggle} onEdit={setEditing}
                    onDragStart={handleDragStart} onDragOver={handleDragOver}
                    onDragLeave={handleDragLeave} onDrop={handleDrop} onDragEnd={handleDragEnd}
                    isDragging={draggedId === p.id} isDropTarget={dragOverId === p.id && draggedId !== p.id} />
                ))}
                {investorPortfolios.length === 0 && (
                  <div className="px-4 py-6 text-center text-[11px] font-mono text-stone-500">
                    No investor portfolios yet — click "+ New portfolio" above
                  </div>
                )}
              </div>
            </div>

            <ConsensusPanel portfolios={portfolios} disabledHoldings={disabledHoldings} onSetVisibility={setPortfolioVisibility} onIsolate={isolateInConsensus} />
          </div>

          <DataManager neededTickers={neededTickers} prices={prices}
            onImport={(ticker) => setImporting(ticker || '')} onDelete={handleDeletePrice} />
        </div>

        <div className="mt-6 text-[10px] text-stone-500 font-mono leading-relaxed max-w-3xl">
          Bring-your-own data · stored locally · partial coverage OK · use Backup regularly · drag portfolios to reorder · not investment advice
        </div>
      </div>

      {editing && <PortfolioEditModal portfolio={editing} onSave={saveEdit} onClose={() => setEditing(null)}
        onDelete={(id) => { if (deletePortfolio(id)) setEditing(null); }}
        disabledSet={disabledHoldings[editing.id]} onToggleDisabled={toggleHoldingDisabled}
        prices={prices} vooPortfolio={portfolios.find(p => p.id === 'voo')} />}
      {importing !== null && <ImportModal tickerHint={importing} onSave={handleImportPrice} onClose={() => setImporting(null)} />}
      {showBackup && <BackupModal portfolios={portfolios} prices={prices} onRestore={handleRestore} onClose={() => setShowBackup(false)} />}
    </div>
  );
}
