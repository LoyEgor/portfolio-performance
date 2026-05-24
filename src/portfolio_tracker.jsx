import React, { useState, useEffect, useMemo, useRef } from 'react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine, ReferenceArea } from 'recharts';
import { Pencil, Trash2, AlertCircle, X, Upload, Check, Save, RotateCcw, GripVertical, Loader2, Link2, Pipette, HardDriveDownload, Eye, EyeOff, Moon, Sun } from 'lucide-react';

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

// Single source of truth for an investor's color across every component (portfolio
// row dot, chart line, matrix column dot, etc.). Priority:
//   1. activePortfolio.color (what the chart already draws with, Save persists).
//   2. customization[id].color (saved override in default-data.json).
//   3. Deterministic PALETTE pick by hash(id) — stable per id across components.
const getInvestorColor = (id, activePortfolio, customization) => {
  if (activePortfolio?.color) return activePortfolio.color;
  if (customization?.[id]?.color) return customization[id].color;
  let h = 0;
  for (let i = 0; i < id.length; i++) h = ((h << 5) - h + id.charCodeAt(i)) | 0;
  return PALETTE[Math.abs(h) % PALETTE.length];
};

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

// Display-layer dual-class grouping. Returns same shape as input + per-row meta:
//   { ticker, weight, mergedFrom: ['BRK.A','BRK.B'] }  // mergedFrom set only when > 1 origin
// When mergeMode === false, returns the original list as-is with no meta.
const mergeHoldingsDisplay = (holdings, mergeMode) => {
  if (!mergeMode || !holdings?.length) return (holdings || []).map(h => ({ ...h }));
  const groups = new Map();
  for (const h of holdings) {
    const orig = String(h.ticker || '').trim().toUpperCase();
    if (!orig) continue;
    const canon = normalizeTicker(orig, true);
    if (!groups.has(canon)) {
      groups.set(canon, { ticker: canon, weight: 0, mergedFrom: [] });
    }
    const g = groups.get(canon);
    g.weight += parseFloat(h.weight) || 0;
    if (!g.mergedFrom.includes(orig)) g.mergedFrom.push(orig);
  }
  // After merging dual-class pairs, re-sort by combined weight descending —
  // a merged position (BRK.A 7% + BRK.B 6% → BRK 13%) belongs at its NEW rank,
  // not at the rank of whichever class came first in the source array.
  //
  // `mergedFrom` is ALWAYS an array of the underlying original tickers (sorted),
  // even when a position has only one class. Downstream code uses it to look up
  // shares and prices in the original (un-canonicalized) holdings/prices data —
  // for example, Li Lu holds only BRK.B; canonical ticker is "BRK" but shares
  // and prices are keyed by "BRK.B". Returning ['BRK.B'] keeps that lookup
  // working. The "X + Y" badge in the modal still checks length > 1, so single-
  // class rows don't show a merge indicator.
  return [...groups.values()]
    .sort((a, b) => b.weight - a.weight)
    .map(g => ({
      ticker: g.ticker,
      weight: Math.round(g.weight * 1e6) / 1e6,
      mergedFrom: [...g.mergedFrom].sort(),
    }));
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

  // Drop snapshots that fall ENTIRELY outside the price window (asOf < allDates[0]).
  // They can't form a valid segment because closestLE(nextSnapshot.asOf) would be null
  // and the segment would be skipped, leaving the chart starting later than allDates[0].
  // KEEP the latest such "outside" snapshot as the effective starting holdings — its
  // composition extends forward through allDates[0] until the first in-range snapshot.
  // This is the desired "missing data = composition didn't change" behaviour.
  const earliestPriceDate = allDates[0];
  const firstInRange = snapshots.findIndex(s => s.asOf >= earliestPriceDate);
  const effectiveSnaps = firstInRange === -1
    ? [snapshots[snapshots.length - 1]]              // all snapshots predate the price window
    : firstInRange > 0
      ? snapshots.slice(firstInRange - 1)            // keep the snapshot just before, drop earlier
      : snapshots;                                    // all snapshots already in range

  // Build segments. Each segment owns dates [fromDate, nextFromDate) — the boundary belongs to the
  // next segment so chain-linked rebalance happens cleanly.
  // The first segment ALWAYS starts at the earliest available price, regardless of where its
  // snapshot's asOf falls. The first snapshot's holdings apply retrospectively to anything before
  // their asOf — a fair buy-and-hold approximation, and it keeps history portfolios visually
  // aligned with non-history ones (which always start at allDates[0]).
  const segs = [];
  for (let i = 0; i < effectiveSnaps.length; i++) {
    const fromDate = i === 0 ? allDates[0] : closestLE(effectiveSnaps[i].asOf);
    if (!fromDate) continue;
    let toDate;
    if (i + 1 < effectiveSnaps.length) {
      toDate = closestLE(effectiveSnaps[i + 1].asOf);
      if (!toDate || toDate <= fromDate) continue;
    } else {
      toDate = allDates[allDates.length - 1];
    }
    segs.push({ holdings: effectiveSnaps[i].holdings, fromDate, toDate, isLast: i === effectiveSnaps.length - 1 });
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

// Live viewport-media-query subscription. Returns boolean that updates whenever the match state
// changes, so the component re-renders on breakpoint crossings (e.g. resizing past 1200px).
const useMediaQuery = (query) => {
  const [matches, setMatches] = useState(() =>
    typeof window !== 'undefined' && typeof window.matchMedia === 'function'
      ? window.matchMedia(query).matches : false
  );
  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;
    const mql = window.matchMedia(query);
    const handler = (e) => setMatches(e.matches);
    mql.addEventListener('change', handler);
    setMatches(mql.matches); // sync initial value (SSR / first paint)
    return () => mql.removeEventListener('change', handler);
  }, [query]);
  return matches;
};

// Closest available date ≤ target in a sorted ISO-date array. Used for both chart math
// and activity-delta computation when a snapshot's asOf may not exactly match a price key.
const closestLEDate = (sortedDates, target) => {
  let lo = 0, hi = sortedDates.length - 1, ans = null;
  while (lo <= hi) {
    const m = (lo + hi) >> 1;
    if (sortedDates[m] <= target) { ans = sortedDates[m]; lo = m + 1; } else hi = m - 1;
  }
  return ans;
};

// Weighted average price ratio of every prev-quarter holding from prevAsOf → currAsOf.
// "What the portfolio would have grown to if the investor did nothing." Used to
// decompose weight changes into (price drift) + (real trading).
const computePortfolioGrowth = (prevHoldings, prevAsOf, currAsOf, prices) => {
  let weightedRatio = 0;
  let coveredWeight = 0;
  for (const h of (prevHoldings || [])) {
    const px = prices[(h.ticker || '').toUpperCase()];
    if (!px) continue;
    const dates = Object.keys(px).sort();
    const pK = closestLEDate(dates, prevAsOf);
    const cK = closestLEDate(dates, currAsOf);
    if (!pK || !cK) continue;
    const pP = px[pK], cP = px[cK];
    if (!pP || pP <= 0 || !cP || cP <= 0) continue;
    weightedRatio += (h.weight || 0) * (cP / pP);
    coveredWeight += (h.weight || 0);
  }
  return coveredWeight > 0 ? (weightedRatio / coveredWeight) : 1;
};

// Activity delta for one ticker (or merged ticker group). Two output modes:
//
//   mode='portfolio' — delta in pp of investor's portfolio (used for consensus aggregation
//                      across multiple investors; summable in a meaningful way)
//   mode='asset'     — delta in % of the position's own share count (DataRoma-style:
//                      "Add 203%", "Reduce 35%"; intuitive for single-investor views)
//
// Confidence levels:
//   'real'  — shares-based or new/exit. Exact.
//   'rough' — anything else (price-corrected estimate, or raw weight delta fallback).
//             Visually dimmed; tooltip explains it's an approximation.
//
// origTickers: array of original tickers (single, or members of a merged group).
const computeActivityDelta = (
  origTickers, currWeight, prevWeight,
  currHoldings, prevHoldings,
  prevAsOf, currAsOf,
  prices, portfolioGrowth,
  mode = 'portfolio'
) => {
  const upper = origTickers.map(t => t.toUpperCase());

  // Sum shares across the group (returns null if any constituent lacks shares).
  const sumShares = (rawHoldings) => {
    let total = 0;
    for (const t of upper) {
      const orig = (rawHoldings || []).find(x => (x.ticker || '').toUpperCase() === t);
      if (orig?.shares == null) return null;
      total += orig.shares;
    }
    return total;
  };

  // Average price of the group at a given asOf (equal-weighted across original tickers).
  const avgPriceAt = (asOf) => {
    let total = 0;
    let n = 0;
    for (const t of upper) {
      const px = prices[t];
      if (!px) continue;
      const dates = Object.keys(px).sort();
      const k = closestLEDate(dates, asOf);
      const v = k ? px[k] : null;
      if (v && v > 0) { total += v; n += 1; }
    }
    return n > 0 ? total / n : null;
  };

  // For new/exit, asset-mode returns ±100% (full new / full sold);
  // portfolio-mode returns the position's weight (its contribution in pp).
  if (currWeight > 0 && (prevWeight === 0 || prevWeight === undefined)) {
    return { delta: mode === 'asset' ? 100 : currWeight, confidence: 'real' };
  }
  if (prevWeight > 0 && (currWeight === 0 || currWeight === undefined)) {
    return { delta: mode === 'asset' ? -100 : -prevWeight, confidence: 'real' };
  }

  // Both quarters present — prefer share-based delta.
  const currShares = sumShares(currHoldings);
  const prevShares = sumShares(prevHoldings);
  if (currShares != null && prevShares != null && prevShares > 0) {
    const sharesRatio = (currShares - prevShares) / prevShares;  // e.g. +0.50 = "Add 50%"
    return {
      delta: mode === 'asset' ? sharesRatio * 100 : sharesRatio * currWeight,
      confidence: 'real',
    };
  }

  // Estimate via price correction.
  // assumed-no-trade hypothesis: currShares/prevShares = priceRatio_position / priceRatio_portfolio
  // Anything beyond that is interpreted as actual trading. Derived without knowing absolute shares.
  const prevP = avgPriceAt(prevAsOf);
  const currP = avgPriceAt(currAsOf);
  if (prevP && currP && portfolioGrowth && prevWeight > 0) {
    const priceRatio = currP / prevP;
    // Portfolio-mode: weight delta the investor wouldn't have without trading.
    const expectedCurrWeight = prevWeight * priceRatio / portfolioGrowth;
    const portfolioDelta = currWeight - expectedCurrWeight;
    // Asset-mode: implied shares ratio. If investor didn't trade, sharesRatio = 1.
    // sharesRatio = (currShares / prevShares) = (currWeight × portfolioGrowth) / (prevWeight × priceRatio)
    const impliedSharesRatio = (currWeight * portfolioGrowth) / (prevWeight * priceRatio);
    const assetDelta = (impliedSharesRatio - 1) * 100;
    return {
      delta: mode === 'asset' ? assetDelta : portfolioDelta,
      confidence: 'rough',
    };
  }

  // No prices either — last-resort raw weight delta. Asset-mode can't be computed
  // meaningfully without prices, so just use the same number.
  return { delta: currWeight - prevWeight, confidence: 'rough' };
};

// Period cutoff as an ISO date string ("YYYY-MM-DD") — relies on the fact that all
// price keys in this app are YYYY-MM-DD, which sort lexicographically the same as
// chronologically. Returns null for 'ALL' or unrecognized periods.
const periodCutoffIso = (period, lastIso) => {
  if (!period || period === 'ALL' || !lastIso) return null;
  const d = new Date(lastIso);
  if (period === '3M') d.setMonth(d.getMonth() - 3);
  else if (period === '6M') d.setMonth(d.getMonth() - 6);
  else if (period === 'YTD') return `${d.getFullYear()}-01-01`;
  else if (period === '1Y') d.setFullYear(d.getFullYear() - 1);
  else return null;
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
// ============================================================================
// PORTFOLIO ROW
// ============================================================================

const PortfolioRow = ({
  portfolio, onToggle, onEdit, pctReturn, missingTickers, coveragePct, disabledSet,
  onDragStart, onDragOver, onDrop, onDragEnd, isDragging, isDropTarget, dropPosition, isLast,
  mergeMode
}) => {
  // `pctReturn` is passed in from the parent (computed for the current chart period + mode).
  // Treat undefined as "no number yet", but null/0 as legitimate values.
  const hasReturn = pctReturn !== null && pctReturn !== undefined && Number.isFinite(pctReturn);
  const positive = hasReturn && pctReturn >= 0;
  // Count active holdings; when mergeMode is ON, count each dual-class pair as a single issuer.
  const stockCount = (() => {
    const active = (portfolio.holdings || []).filter(h => !disabledSet?.has(h.ticker.trim().toUpperCase()));
    if (!mergeMode) return active.length;
    const seen = new Set();
    for (const h of active) seen.add(normalizeTicker(h.ticker.trim().toUpperCase(), true));
    return seen.size;
  })();
  return (
    <div
      draggable
      onDragStart={(e) => {
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', portfolio.id);
        onDragStart?.(portfolio.id);
      }}
      onDragOver={(e) => onDragOver?.(e, portfolio.id)}
      onDrop={(e) => onDrop?.(e, portfolio.id)}
      onDragEnd={onDragEnd}
      className={`group relative px-4 py-3 ${isLast ? '' : 'border-b border-subtle'} hover-surface transition-colors ${
        isDragging ? 'opacity-30' : ''
      } ${isDropTarget ? (dropPosition === 'after' ? 'accent-tint-mild border-b-2 border-b-accent-brand' : 'accent-tint-mild border-t-2 border-t-accent-brand') : ''}`}
      style={{ cursor: isDragging ? 'grabbing' : 'grab' }}
    >
      <div className="flex items-center gap-3">
        <GripVertical size={12} className="text-muted group-hover-text-secondary transition-colors flex-shrink-0" />
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
            <span className="text-micro font-mono text-muted tabular-nums">·{stockCount}</span>
            {portfolio.id === 'mine' && <span className="text-micro tracking-[0.18em] uppercase font-mono px-1.5 py-0.5 bg-contrast-pill text-on-contrast-pill rounded-sm">YOU</span>}
            {portfolio.kind === 'benchmark' && <span className="text-micro tracking-[0.18em] uppercase font-mono text-tertiary">bench</span>}
          </div>
          {portfolio.subtitle && <div className="text-body text-tertiary mt-0.5 font-mono tracking-tight truncate">{portfolio.subtitle}</div>}
          {missingTickers?.length > 0 && (
            <div className="text-micro text-accent-brand mt-0.5 font-mono">
              missing: {missingTickers.join(', ')} <span className="text-tertiary">({coveragePct}% covered)</span>
            </div>
          )}
        </div>
        <div className="flex items-center gap-3">
          {hasReturn && (
            <button
              onClick={(e) => { e.stopPropagation(); onEdit(portfolio); }}
              title="Edit portfolio"
              className="text-right font-mono cursor-pointer hover:opacity-70 transition-opacity">
              <div className="text-prom tabular-nums font-medium" style={{ color: positive ? 'var(--success)' : 'var(--danger)' }}>
                {positive ? '+' : ''}{pctReturn.toFixed(2)}%
              </div>
            </button>
          )}
          {!hasReturn && stockCount === 0 && <div className="text-micro text-muted italic font-mono">empty</div>}
          {!hasReturn && stockCount > 0 && <div className="text-micro text-muted italic font-mono">no data</div>}
          <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
            <button onClick={(e) => { e.stopPropagation(); onEdit(portfolio); }} className="p-1.5 hover-surface rounded text-tertiary hover-text-primary" title="Edit portfolio">
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

const PortfolioEditModal = ({ portfolio, onSave, onClose, onDelete, disabledSet, onToggleDisabled, prices, vooPortfolio, mergeMode, setMergeMode, isFromBase = false }) => {
  const [name, setName] = useState(portfolio?.name || '');
  const [subtitle, setSubtitle] = useState(portfolio?.subtitle || '');
  const [holdings] = useState(
    portfolio?.holdings?.length > 0 ? portfolio.holdings.map(h => ({ ...h })) : []
  );
  const [color, setColor] = useState(portfolio?.color || PALETTE[0]);
  // Quarter switcher: 'current' shows portfolio.holdings; numeric idx shows portfolio.history[idx]. Both read-only.
  const historySnapshots = portfolio?.history || [];
  const [viewIdx, setViewIdx] = useState('current');
  const isReadonly = viewIdx !== 'current';
  const displayedHoldings = isReadonly ? (historySnapshots[viewIdx]?.holdings || []) : holdings;
  // Used as the bar's baseline (so per-row width math is consistent even if weights don't sum to 100).
  const totalWeight = displayedHoldings.reduce((s, h) => s + (parseFloat(h.weight) || 0), 0);

  // Diff vs previous quarter — for each visible holding, compute Δ weight; also collect tickers that
  // existed last quarter but disappeared (sold). For the earliest snapshot (Q1) there is no prev.
  // When mergeMode is ON, dual-class deltas net out (e.g. selling all GOOGL and buying the same
  // dollar amount of GOOG → net delta 0 for the merged "GOOGL" row).
  const allSnapshotsForDiff = [...historySnapshots, { asOf: 'current', holdings }];
  const currentSnapIdx = isReadonly ? viewIdx : historySnapshots.length;
  const prevSnap = currentSnapIdx > 0 ? allSnapshotsForDiff[currentSnapIdx - 1] : null;
  // asOf of the snapshot currently displayed. For "current" (editable) view, derive it from
  // the latest history asOf + one quarter — same logic as computeSeries' implicit asOf.
  const currAsOfForDelta = (() => {
    if (isReadonly) return historySnapshots[viewIdx]?.asOf || null;
    if (!historySnapshots.length) return null;
    const last = historySnapshots[historySnapshots.length - 1].asOf;
    const [y, m] = last.split('-').map(Number);
    const nm = m + 3;
    const ny = y + Math.floor((nm - 1) / 12);
    const nmm = ((nm - 1) % 12) + 1;
    const lastDay = new Date(ny, nmm, 0).getDate();
    return `${ny}-${String(nmm).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;
  })();
  // Portfolio growth between prevSnap.asOf → currAsOf, weighted by prev holdings using
  // the price data we already have. Used by computeActivityDelta's price-corrected branch.
  const portfolioGrowthForPrev = useMemo(() => {
    if (!prevSnap || !currAsOfForDelta) return 1;
    return computePortfolioGrowth(prevSnap.holdings, prevSnap.asOf, currAsOfForDelta, prices);
  }, [prevSnap, currAsOfForDelta, prices]);

  // Merge-aware prev → weight map; key is normalized canonical when mergeMode is ON.
  const prevByTicker = {};
  if (prevSnap) {
    const prevMerged = mergeHoldingsDisplay(prevSnap.holdings, mergeMode);
    prevMerged.forEach(h => {
      const t = h.ticker.trim().toUpperCase();
      if (t) prevByTicker[t] = parseFloat(h.weight) || 0;
    });
  }
  // For the rendered row list and "sold this quarter" detection, also work on the merged view.
  const mergedDisplayed = mergeHoldingsDisplay(displayedHoldings, mergeMode);
  const soldThisQuarter = prevSnap
    ? mergeHoldingsDisplay(prevSnap.holdings, mergeMode)
        .map(h => ({ ticker: h.ticker.trim().toUpperCase(), weight: parseFloat(h.weight) || 0, mergedFrom: h.mergedFrom }))
        .filter(p => p.ticker && !mergedDisplayed.some(d => d.ticker.trim().toUpperCase() === p.ticker))
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
  // Symmetric Y-domain around the 100 baseline so the dashed reference line stays anchored at the
  // same vertical position across quarter switches (otherwise Recharts auto-fits and the X axis
  // visually jumps). 1.2× padding keeps the line from kissing the chart edges.
  const miniYDomain = useMemo(() => {
    if (!miniChartData?.length) return [98, 102];
    let maxDev = 0;
    for (const d of miniChartData) {
      const dev = Math.abs(d.value - 100);
      if (dev > maxDev) maxDev = dev;
    }
    const pad = Math.max(maxDev * 1.2, 2);
    return [100 - pad, 100 + pad];
  }, [miniChartData]);

  const handleSave = () => {
    onSave({ ...portfolio, name: name.trim() || 'Untitled', subtitle: subtitle.trim(), color });
  };

  return (
    // Pin near the top so the modal does not jump vertically when content height changes
    // (e.g. switching quarters with different holdings counts).
    <div className="fixed inset-0 modal-backdrop backdrop-blur-sm z-50 flex items-start justify-center p-4 pt-12 overflow-y-auto">
      <div className="surface-card-elevated border border-subtle rounded-lg max-w-[44rem] w-full max-h-[calc(100vh-4rem)] overflow-hidden flex flex-col shadow-2xl">
        <div className="px-6 py-4 border-b border-subtle flex items-center justify-between">
          <h2 className="text-xl tracking-tight font-serif" style={{ color: 'var(--text-primary)' }}>Edit Portfolio</h2>
          <button onClick={onClose} className="text-tertiary hover-text-primary"><X size={20} /></button>
        </div>
        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-5">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {/* On mobile: Color first, then Name. On desktop: Name | Color side by side. */}
            <div className="order-2 sm:order-1">
              <label className="text-micro tracking-[0.15em] uppercase text-tertiary font-mono mb-1.5 block">
                Name {isFromBase && <span className="text-muted normal-case tracking-normal">· from base, read-only</span>}
              </label>
              <input value={name} onChange={(e) => setName(e.target.value)} readOnly={isFromBase}
                title={isFromBase ? 'Name comes from public/data/investors-index.json (maintained by goals). Not editable from UI.' : undefined}
                style={isFromBase ? { background: 'var(--row-stripe)' } : undefined}
                className={`w-full border border-subtle rounded px-3 py-2 text-prom font-serif focus:outline-none ${
                  isFromBase ? 'text-muted cursor-not-allowed' : 'surface-input focus-border'
                }`} />
            </div>
            <div className="order-1 sm:order-2">
              <label className="text-micro tracking-[0.15em] uppercase text-tertiary font-mono mb-1.5 block">Color</label>
              <div className="flex flex-wrap gap-1.5 pt-1.5 items-center">
                {PALETTE.map(c => {
                  // The near-black swatch (#1a1815) blends into the dark theme's canvas when not
                  // selected — give it a CSS-only outline visible only in dark mode.
                  const needsDarkRing = c === '#1a1815';
                  return (
                    <button key={c} onClick={() => setColor(c)}
                      className={`w-6 h-6 rounded-full hover:scale-110 transition-transform ${needsDarkRing ? 'swatch-near-black' : ''}`}
                      style={{ backgroundColor: c, border: color === c ? '2px solid var(--border-selected)' : '2px solid transparent', boxShadow: color === c ? '0 0 0 1px white inset' : 'none' }} />
                  );
                })}
                <span className="w-px h-5 bg-border-subtle mx-0.5" />
                <label className="relative w-6 h-6 cursor-pointer group" title="Pick any color">
                  <input type="color" value={color} onChange={(e) => setColor(e.target.value)}
                    className="absolute inset-0 w-full h-full opacity-0 cursor-pointer" />
                  <div className="w-6 h-6 rounded-full border-2 border-dashed border-strong group-hover-border-focus flex items-center justify-center surface-card-elevated transition-colors"
                    style={!PALETTE.includes(color) ? { backgroundColor: color, borderStyle: 'solid', borderColor: 'var(--border-selected)', boxShadow: '0 0 0 1px white inset' } : undefined}>
                    {PALETTE.includes(color) && <Pipette size={11} className="text-tertiary group-hover-text-primary" />}
                  </div>
                </label>
              </div>
            </div>
          </div>
          <div>
            <label className="text-micro tracking-[0.15em] uppercase text-tertiary font-mono mb-1.5 block">
              Subtitle {isFromBase && <span className="text-muted normal-case tracking-normal">· from base, read-only</span>}
            </label>
            <input value={subtitle} onChange={(e) => setSubtitle(e.target.value)} placeholder="e.g. Q1 2025 · Top 5"
              readOnly={isFromBase}
              title={isFromBase ? 'Subtitle comes from public/data/investors-index.json (maintained by goals). Not editable from UI.' : undefined}
              style={isFromBase ? { background: 'var(--row-stripe)' } : undefined}
              className={`w-full border border-subtle rounded px-3 py-2 text-prom font-mono focus:outline-none ${
                isFromBase ? 'text-muted cursor-not-allowed' : 'surface-input text-secondary focus-border'
              }`} />
          </div>
          {miniChartData && (
            <div className="flex items-center gap-3">
              <div className="flex flex-col text-micro font-mono leading-tight">
                <span className="text-tertiary tracking-[0.1em] uppercase">vs VOO</span>
                <span className="tabular-nums font-medium"
                  style={{ color: miniDelta >= 0 ? 'var(--success)' : 'var(--danger)' }}>
                  {miniDelta >= 0 ? '+' : ''}{miniDelta.toFixed(2)}%
                </span>
              </div>
              <div className="flex-1 h-12">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={miniChartData} margin={{ top: 4, right: 4, bottom: 4, left: 4 }}>
                    <YAxis hide domain={miniYDomain} />
                    <XAxis hide dataKey="date" />
                    <ReferenceLine y={100} stroke="var(--text-primary)" strokeDasharray="3 3" strokeOpacity={0.55} />
                    <Line type="monotone" dataKey="value" stroke={color || '#1a1815'} strokeWidth={1.5} dot={false} isAnimationActive={false} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </div>
          )}
          <div>
            {/* Header is padded to match the holding bar's horizontal extent:
                left = eye-toggle slot (29px) + gap (8px), right = weight column (56px) + gap (8px).
                So both Merge toggle and quarter switcher align with the bar, leaving the area above
                the percent column empty. */}
            <div className="flex items-center justify-between mb-2 gap-3 pl-[37px] pr-16">
              <label className="flex items-center gap-1.5 text-micro font-mono text-secondary cursor-pointer select-none"
                title="Display BRK.A/BRK.B, GOOG/GOOGL etc. as a single ticker. Merged rows are read-only — uncheck to edit individual share classes.">
                <input type="checkbox" checked={mergeMode} onChange={(e) => setMergeMode(e.target.checked)}
                  className="accent-on-bg-color" />
                <span>Merge dual-class</span>
              </label>
              {historySnapshots.length > 0 && (
                <div className="flex items-center gap-1 flex-wrap justify-end">
                  {historySnapshots.map((s, idx) => (
                    <button key={s.asOf} onClick={() => setViewIdx(idx)}
                      className={`text-micro font-mono px-2 py-0.5 rounded border transition-colors ${
                        viewIdx === idx
                          ? 'bg-contrast-pill text-on-contrast-pill border-contrast-pill'
                          : 'bg-transparent text-tertiary hover-text-primary hover-border-strong border-subtle'
                      }`}
                      title={`13F snapshot · ${s.asOf} · read-only`}>
                      {asOfLabel(s.asOf)}
                    </button>
                  ))}
                  <button onClick={() => setViewIdx('current')}
                    className={`text-micro font-mono px-2 py-0.5 rounded border transition-colors ${
                      viewIdx === 'current'
                        ? 'bg-contrast-pill text-on-contrast-pill border-contrast-pill'
                        : 'bg-transparent text-tertiary hover-text-primary hover-border-strong border-subtle'
                    }`}
                    title="Current quarter">
                    Now
                  </button>
                </div>
              )}
            </div>
            <div className="space-y-1.5">
              {[
                ...mergedDisplayed.map((h, i) => ({ kind: 'live', h, i })),
                ...soldThisQuarter.map(s => ({ kind: 'sold', h: { ticker: s.ticker, weight: 0, mergedFrom: s.mergedFrom }, prevWeight: s.weight }))
              ].map((row, rowKey) => {
                const isSold = row.kind === 'sold';
                const h = row.h;
                const w = parseFloat(h.weight) || 0;
                const ticker = h.ticker.trim().toUpperCase();
                const isMerged = Array.isArray(h.mergedFrom) && h.mergedFrom.length > 1;
                // A merged display row aggregates two underlying entries — controls are disabled
                // (user must turn off Merge dual-class to edit individual classes).
                const lockedByMerge = isMerged && mergeMode;
                // Eye toggle is global across all snapshots (transient, never saved). A ticker may
                // only appear in earlier quarters — let the user disable/enable it from any view,
                // including the sold/read-only states.
                // When merged, treat the row as disabled iff EVERY original class is disabled.
                const isDisabled = isMerged
                  ? h.mergedFrom.every(o => disabledSet?.has(o))
                  : (ticker && disabledSet?.has(ticker));
                // For visual diff bar, normalize against the larger of the two snapshots' totals so
                // Δ segments stay consistent across rows.
                const prevW = isSold ? row.prevWeight : (ticker ? prevByTicker[ticker] : undefined);
                const refTotal = totalWeight > 0 ? totalWeight : 100;
                const pct = Math.min(100, (w / refTotal) * 100);
                const prevPct = prevW !== undefined ? Math.min(100, (prevW / refTotal) * 100) : null;
                const isIncrease = !isSold && prevPct !== null && pct > prevPct + 0.01;
                const isDecrease = !isSold && prevPct !== null && pct < prevPct - 0.01;
                const isNewPosition = !isSold && prevSnap && prevW === undefined && pct > 0;
                // Unified bar geometry. Brown base = the kept/unchanged portion. Green overlay = what
                // grew vs prev. Red overlay = what shrank vs prev. All three layers are ALWAYS mounted
                // so that switching quarters (or even flipping direction green↔red) transitions
                // smoothly via CSS width — no DOM unmount/mount kills the animation.
                // Special cases:
                //   no prev (initial quarter):    effPrev = pct          → brown=pct, no overlays
                //   sold (pct=0, prev>0):         effPrev = prevPct      → red overlay 0→prevPct
                //   new position (prev undef):    effPrev = 0            → green overlay 0→pct
                const hasPrev = prevSnap !== null;
                const effPrev = !hasPrev
                  ? pct
                  : isSold
                    ? prevPct
                    : isNewPosition
                      ? 0
                      : (prevPct ?? pct);
                const baseWidth = Math.min(pct, effPrev);
                const growthWidth = Math.max(0, pct - effPrev);
                const declineWidth = Math.max(0, effPrev - pct);
                /* --- Legacy 4-conditional bar geometry (commented out, kept for reference) ---
                 *   const baseWidth = isSold
                 *     ? 0
                 *     : isNewPosition
                 *       ? 0
                 *       : prevPct !== null
                 *         ? Math.min(pct, prevPct)
                 *         : pct;
                 */
                return (
                  <div key={rowKey} className={`flex items-center gap-2 ${isDisabled ? 'opacity-40' : ''} ${isSold ? 'opacity-60' : ''}`}>
                    {onToggleDisabled && (ticker ? (
                      <button
                        onClick={() => {
                          if (lockedByMerge) {
                            // Toggle every original class in lockstep — anyOn → disable all; allOff → enable all.
                            const anyOn = h.mergedFrom.some(o => !disabledSet?.has(o));
                            for (const o of h.mergedFrom) {
                              const isOff = disabledSet?.has(o);
                              if (anyOn && !isOff) onToggleDisabled(portfolio.id, o);
                              if (!anyOn && isOff) onToggleDisabled(portfolio.id, o);
                            }
                          } else {
                            onToggleDisabled(portfolio.id, ticker);
                          }
                        }}
                        className="w-[29px] h-[29px] flex-shrink-0 flex items-center justify-center text-muted hover-text-secondary"
                        title={isDisabled ? 'Enable holding' : 'Disable holding (excluded from chart)'}>
                        {isDisabled ? <EyeOff size={13} /> : <Eye size={13} />}
                      </button>
                    ) : <div className="w-[29px] h-[29px] flex-shrink-0" />)}
                    <div className="flex-1 relative surface-card-elevated border border-subtle rounded overflow-hidden">
                      {/* Brown base — kept/unchanged portion. Always mounted. */}
                      <div className="absolute inset-y-0 left-0 transition-all duration-300 pointer-events-none"
                        style={{ width: `${baseWidth}%`, background: 'var(--weight-bar)' }} />
                      {/* Green overlay — what GREW vs prev. Always mounted (width=0 when nothing grew). */}
                      <div className="absolute inset-y-0 transition-all duration-300 pointer-events-none"
                        style={{ left: `${baseWidth}%`, width: `${growthWidth}%`, background: 'var(--success)', opacity: 0.22 }} />
                      {/* Red overlay — what SHRANK vs prev. Always mounted (width=0 when nothing shrank). */}
                      <div className="absolute inset-y-0 transition-all duration-300 pointer-events-none"
                        style={{ left: `${baseWidth}%`, width: `${declineWidth}%`, background: 'var(--danger)', opacity: 0.25 }} />
                      {/* --- Legacy 4-conditional bars (commented out, see notes above) ---
                       *   {baseWidth > 0 && (
                       *     <div className="absolute inset-y-0 left-0 transition-all duration-200 pointer-events-none"
                       *       style={{ width: `${baseWidth}%`, background: 'var(--weight-bar)' }} />
                       *   )}
                       *   {isIncrease && (
                       *     <div className="absolute inset-y-0 transition-all duration-200 pointer-events-none"
                       *       style={{ left: `${prevPct}%`, width: `${pct - prevPct}%`, background: 'var(--success)', opacity: 0.22 }} />
                       *   )}
                       *   {isDecrease && (
                       *     <div className="absolute inset-y-0 transition-all duration-200 pointer-events-none"
                       *       style={{ left: `${pct}%`, width: `${prevPct - pct}%`, background: 'var(--danger)', opacity: 0.25 }} />
                       *   )}
                       *   {isNewPosition && (
                       *     <div className="absolute inset-y-0 left-0 transition-all duration-200 pointer-events-none"
                       *       style={{ width: `${pct}%`, background: 'var(--success)', opacity: 0.22 }} />
                       *   )}
                       *   {isSold && prevPct !== null && (
                       *     <div className="absolute inset-y-0 left-0 transition-all duration-200 pointer-events-none"
                       *       style={{ width: `${prevPct}%`, background: 'var(--danger)', opacity: 0.25 }} />
                       *   )}
                       */}
                      <div className="relative flex items-center">
                        <div className={`relative flex-1 px-3 py-2 text-prom font-mono uppercase ${isSold ? 'text-tertiary line-through' : isDisabled ? 'text-muted line-through' : 'text-primary'}`}>
                          {h.ticker}
                        </div>
                        {isMerged && (
                          <span className="relative mr-2 text-micro tracking-[0.08em] uppercase font-mono px-1.5 py-0.5 rounded-sm accent-tint-strong text-accent-brand border border-accent-brand whitespace-nowrap"
                            title="Merged display row">
                            {h.mergedFrom.join(' + ')}
                          </span>
                        )}
                        {/* Real buy/sell activity vs the previous quarter.
                            Tries shares-delta (exact); falls back to price-corrected weight delta
                            (which separates price drift from real trading); last resort is raw
                            weight delta with a "~" rough marker. Noise (|Δ| < 1pp) is hidden
                            entirely for real/price confidence — those numbers reflect actual
                            trading, so "no trade" should literally show nothing. */}
                        {(() => {
                          if (!prevSnap) return null;
                          // mergedFrom is always an array (even for single-class rows like BRK.B
                          // where canonical = "BRK"), so shares/prices lookups find the right keys.
                          const origTickers = h.mergedFrom || [h.ticker.toUpperCase()];
                          // Asset-level metric: % change in shares of this position (DataRoma-style).
                          // Independent of how big the position is in the portfolio.
                          const { delta, confidence } = computeActivityDelta(
                            origTickers, w, prevW || 0,
                            displayedHoldings, prevSnap.holdings,
                            prevSnap.asOf, currAsOfForDelta,
                            prices, portfolioGrowthForPrev,
                            'asset'
                          );
                          if (delta === null || delta === undefined) return null;

                          // Noise thresholds: real has 1% floor (exact data — small signals are real);
                          // rough has 15% floor — picks up mid-range real trades (Reduce ~11-20%)
                          // while still hiding most monthly-price approximation noise. Accepts a few
                          // more false positives in exchange for catching smaller real moves.
                          const abs = Math.abs(delta);
                          const isRough = confidence === 'rough';
                          if (abs < (isRough ? 15 : 1)) return null;

                          const cls = isRough
                            ? (delta >= 0 ? 'text-success-faded' : 'text-danger-faded')
                            : (delta >= 0 ? 'text-success' : 'text-danger');
                          const label = `${delta >= 0 ? '+' : '−'}${Math.round(abs)}%`;
                          const title = isRough
                            ? 'Approximate: estimated from prices (price-corrected weight delta). Exact share counts will appear after INVESTORS-BACKFILL fills shares for this quarter.'
                            : 'Real trading activity — change in share count vs previous quarter.';
                          return (
                            <span className={`relative mr-3 text-prom font-mono tabular-nums ${cls}`}
                              title={title}>
                              {label}
                            </span>
                          );
                        })()}
                      </div>
                    </div>
                    <div className={`w-14 text-prom font-mono text-right tabular-nums ${isSold ? 'text-tertiary' : 'text-primary'}`}>
                      {(parseFloat(h.weight) || 0).toFixed(2)}%
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
        <div className="px-6 py-4 border-t border-subtle flex items-center justify-between gap-3 surface-card-elevated">
          <div>
            {!portfolio.locked && onDelete && (
              <button onClick={() => onDelete(portfolio.id)}
                style={{ color: 'var(--danger)' }}
                className="flex items-center gap-1.5 px-3 py-2 text-body tracking-[0.15em] uppercase font-mono hover-text-danger-strong hover-danger-tint rounded transition-colors">
                <Trash2 size={12} /> Delete
              </button>
            )}
          </div>
          <div className="flex items-center gap-3">
            <button onClick={onClose} className="px-4 py-2 text-body tracking-[0.15em] uppercase text-tertiary hover-text-primary font-mono">Cancel</button>
            <button onClick={handleSave} className="px-5 py-2 text-body tracking-[0.15em] uppercase font-mono bg-contrast-pill text-on-contrast-pill rounded hover-contrast-pill-soft">Save</button>
          </div>
        </div>
      </div>
    </div>
  );
};

// ============================================================================
// BACKUP MODAL — upload a JSON snapshot to restore an older state for comparison
// ============================================================================

const BackupModal = ({ onRestore, onClose }) => {
  const fileInputRef = useRef(null);
  const [restorePreview, setRestorePreview] = useState(null);
  const [restoreError, setRestoreError] = useState(null);

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

    // Prices — flat {date: price} per ticker (the v8 backup format).
    const cleanPrices = {};
    const rawPrices = (raw.prices && typeof raw.prices === 'object' && !Array.isArray(raw.prices)) ? raw.prices : {};
    Object.entries(rawPrices).forEach(([ticker, priceMap]) => {
      if (typeof ticker !== 'string' || !ticker.trim()) { skipped.prices++; return; }
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

  const performRestore = () => {
    if (!restorePreview) return;
    try {
      onRestore(restorePreview);
      onClose();
    } catch (err) {
      setRestoreError(`Restore failed: ${err.message || err}`);
    }
  };

  return (
    <div className="fixed inset-0 modal-backdrop backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="surface-card-elevated border border-subtle rounded-lg max-w-md w-full overflow-hidden shadow-2xl">
        <div className="px-6 py-4 border-b border-subtle flex items-center justify-between">
          <h2 className="text-xl tracking-tight font-serif" style={{ color: 'var(--text-primary)' }}>Restore from file</h2>
          <button onClick={onClose} className="text-tertiary hover-text-primary"><X size={20} /></button>
        </div>
        <div className="px-6 py-5 space-y-5">
          <div className="text-body font-mono text-tertiary">
            Upload a JSON snapshot to view an older state. The restored data is held in memory only — reloading the page returns to the bundled default.
          </div>

          <div className="space-y-3">
            <input type="file" accept=".json,application/json" ref={fileInputRef} onChange={handleFileSelect} className="hidden" />

            {!restorePreview && (
              <button onClick={() => fileInputRef.current?.click()}
                className="w-full flex items-center justify-center gap-2 px-4 py-3 text-body tracking-[0.15em] uppercase font-mono surface-card-elevated border border-strong text-primary rounded hover-surface">
                <Upload size={13} /> Restore from backup file
              </button>
            )}

            {restorePreview && (
              <div className="space-y-3">
                <div className="success-tint border border-success rounded p-3">
                  <div className="flex items-center gap-2 text-body font-mono text-success-strong font-medium mb-2">
                    <Check size={13} /> File loaded
                  </div>
                  <div className="text-body font-mono text-secondary space-y-0.5">
                    <div className="truncate">· {restorePreview.fileName}</div>
                    <div>· Version <span className="text-primary">{restorePreview.version}</span> · exported {restorePreview.exportedAt ? new Date(restorePreview.exportedAt).toLocaleDateString() : 'unknown date'}</div>
                    <div>· <span className="text-primary font-medium">{restorePreview.portfolios.length}</span> portfolios</div>
                    <div>· <span className="text-primary font-medium">{Object.keys(restorePreview.prices).length}</span> tickers · {restorePreview.totalPoints.toLocaleString()} price points</div>
                    {(restorePreview.skipped.portfolios > 0 || restorePreview.skipped.prices > 0 || restorePreview.skipped.priceEntries > 0) && (
                      <div className="text-accent-brand mt-1.5 pt-1.5 border-t border-success">
                        ⚠ Skipped during parsing: {restorePreview.skipped.portfolios} bad portfolios, {restorePreview.skipped.prices} bad tickers, {restorePreview.skipped.priceEntries} bad price entries
                      </div>
                    )}
                  </div>
                </div>
                <div className="text-body font-mono text-accent-brand accent-tint-mild border border-accent-brand rounded p-2.5">
                  ⚠ This replaces all current data in memory. Reload the page to return to the bundled default.
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <button onClick={() => { setRestorePreview(null); setRestoreError(null); }}
                    className="px-4 py-2.5 text-body tracking-[0.15em] uppercase font-mono surface-card-elevated border border-strong text-primary rounded hover-surface">
                    Cancel
                  </button>
                  <button onClick={performRestore}
                    className="px-4 py-2.5 text-body tracking-[0.15em] uppercase font-mono bg-accent-on-bg text-on-accent rounded hover-accent-darker">
                    Confirm restore
                  </button>
                </div>
              </div>
            )}

            {restoreError && (
              <div className="text-body font-mono text-danger-strong danger-tint border border-danger rounded p-2.5 flex items-start gap-1.5">
                <AlertCircle size={11} className="mt-0.5 flex-shrink-0" /> <div>{restoreError}</div>
              </div>
            )}
          </div>
        </div>
        <div className="px-6 py-4 border-t border-subtle flex items-center justify-end surface-card-elevated">
          <button onClick={onClose} className="px-4 py-2 text-body tracking-[0.15em] uppercase text-tertiary hover-text-primary font-mono">Close</button>
        </div>
      </div>
    </div>
  );
};

// ============================================================================
// CONSENSUS PANEL — toggleable portfolios + merge dual-class + insights
// ============================================================================

// Pool strip — the row of clickable portfolio chips that toggles visibility for the consensus
// computation. Same chip gesture as the chart legend (click toggles, Ctrl/Cmd/Shift isolates).
// Lives outside ConsensusPanel so the wide 3-column layout can render it once below the grid
// instead of duplicating it under every column.
const ConsensusPool = ({ portfolios, onSetVisibility, onIsolate }) => {
  const allWithHoldings = portfolios.filter(p => p.kind !== 'benchmark' && p.holdings.length > 0);
  const handleClick = (p, e) => {
    if (e && (e.ctrlKey || e.metaKey || e.shiftKey)) {
      onIsolate?.(p.id);
      return;
    }
    onSetVisibility?.(p.id, !p.visible);
  };
  return (
    <div className="surface-card border border-subtle rounded-lg px-5 py-3 shadow-sm">
      <div className="text-micro tracking-[0.2em] uppercase text-tertiary font-mono mb-2">Pool <span className="normal-case tracking-normal text-muted">· click to hide / show · Ctrl/⌘/Shift+click to isolate</span></div>
      <div className="flex items-center gap-1.5 flex-wrap">
        {allWithHoldings.map(p => {
          const hidden = !p.visible;
          const cls = hidden
            ? 'bg-transparent border-subtle text-muted line-through hover-text-secondary hover-border-strong'
            : 'surface-card-elevated border-subtle text-primary hover-border-strong';
          const tip = hidden
            ? 'Click to show · Ctrl/⌘/Shift+click to isolate'
            : 'Click to hide · Ctrl/⌘/Shift+click to isolate';
          return (
            <button key={p.id} onClick={(e) => handleClick(p, e)}
              className={`flex items-center gap-1.5 text-body font-mono px-2.5 py-1 rounded border transition-all ${cls}`}
              title={tip}>
              <div className="w-2 h-2 rounded-full" style={{ backgroundColor: p.color, opacity: hidden ? 0.3 : 1 }} />
              <span>{p.name}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
};

const ConsensusPanel = ({ portfolios, disabledHoldings, onSetVisibility, onIsolate, onEdit, prices, mergeMode, setMergeMode, forcedViewMode, hideMergeToggle, hidePool }) => {
  const [showMergedDetails, setShowMergedDetails] = useState(false);
  // 'held' = aggregate current weights (consensus by holdings).
  // 'bought' = aggregate positive Δ vs the last history snapshot (consensus by recent buying).
  const [localViewMode, setLocalViewMode] = useState('held');
  // When `forcedViewMode` is passed (e.g. from the 3-column grid on wide screens), it overrides
  // local state and the mode-tabs are hidden — each instance shows a single fixed mode.
  const viewMode = forcedViewMode ?? localViewMode;
  const setViewMode = forcedViewMode ? () => {} : setLocalViewMode;

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

  // Group an investor's holdings by normalized ticker (handles dual-class merging) and
  // renormalize weights to 100. Also rolls up shares across original tickers in the group;
  // hasShares=false if any original lacks share data (forces weight-based fallback in caller).
  const groupForActivity = (holdings, p) => {
    const disabled = disabledHoldings[p.id];
    const active = disabled?.size
      ? (holdings || []).filter(h => !disabled.has((h.ticker || '').toUpperCase()))
      : (holdings || []);
    const sum = active.reduce((s, h) => s + h.weight, 0);
    const groups = {};  // norm → { weight, shares, hasShares, origs:Set }
    if (sum === 0) return groups;
    for (const h of active) {
      const orig = (h.ticker || '').toUpperCase();
      const norm = normalizeTicker(orig, mergeMode);
      if (!groups[norm]) groups[norm] = { weight: 0, shares: 0, hasShares: true, origs: new Set() };
      groups[norm].weight += (h.weight / sum) * 100;
      if (h.shares != null) groups[norm].shares += h.shares;
      else groups[norm].hasShares = false;
      groups[norm].origs.add(orig);
    }
    return groups;
  };

  // Per-ticker contribution to the activity (bought/sold) consensus signal for one investor.
  //
  // Confidence tiers (best to worst):
  //   'real'  shares-delta (or new/exit) — exact
  //   'rough' anything else (price-corrected estimate or raw weight delta)
  //
  // Aggregates positive signed values into "bought"; magnitudes of negatives into "sold".
  const activityContribFor = (currHoldings, prevHoldings, p, mode, prevAsOf, currAsOf, originalsAcc) => {
    const currG = groupForActivity(currHoldings, p);
    const prevG = groupForActivity(prevHoldings, p);
    const allTickers = new Set([...Object.keys(currG), ...Object.keys(prevG)]);
    const portfolioGrowth = computePortfolioGrowth(prevHoldings, prevAsOf, currAsOf, prices || {});
    const contrib = {};
    for (const t of allTickers) {
      const c = currG[t];
      const pr = prevG[t];
      if (originalsAcc) {
        if (!originalsAcc[t]) originalsAcc[t] = new Set();
        c?.origs.forEach(o => originalsAcc[t].add(o));
        if (mode === 'sold') pr?.origs.forEach(o => originalsAcc[t].add(o));
      }
      const origTickers = [...((c?.origs || pr?.origs) || [])];
      const { delta: signed } = computeActivityDelta(
        origTickers,
        c?.weight || 0,
        pr?.weight || 0,
        currHoldings, prevHoldings,
        prevAsOf, currAsOf,
        prices || {}, portfolioGrowth
      );
      if (signed === null || signed === undefined) continue;
      if (mode === 'bought' && signed > 0) contrib[t] = signed;
      else if (mode === 'sold' && signed < 0) contrib[t] = -signed;
    }
    return contrib;
  };

  // For 'held' mode only — same shape as before, weight-based, no activity.
  const heldContribFor = (holdings, p, originalsAcc) => {
    const g = groupForActivity(holdings, p);
    const out = {};
    for (const [norm, data] of Object.entries(g)) {
      out[norm] = data.weight;
      if (originalsAcc) {
        if (!originalsAcc[norm]) originalsAcc[norm] = new Set();
        data.origs.forEach(o => originalsAcc[norm].add(o));
      }
    }
    return out;
  };

  const stats = useMemo(() => {
    const result = {};
    includedPortfolios.forEach(p => {
      const portfolioOriginals = {};
      let contrib;
      if ((viewMode === 'bought' || viewMode === 'sold') && p.history?.length) {
        const sortedHist = [...p.history].sort((a, b) => a.asOf.localeCompare(b.asOf));
        const prev = sortedHist[sortedHist.length - 1];
        // Current implicit asOf = prev.asOf + 1 quarter (matches computeSeries).
        const [yy, mm] = prev.asOf.split('-').map(Number);
        const nm = mm + 3;
        const ny = yy + Math.floor((nm - 1) / 12);
        const nmm = ((nm - 1) % 12) + 1;
        const lastDay = new Date(ny, nmm, 0).getDate();
        const currAsOf = `${ny}-${String(nmm).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;
        contrib = activityContribFor(
          getActiveHoldings(p, disabledHoldings), prev.holdings, p,
          viewMode, prev.asOf, currAsOf, portfolioOriginals
        );
      } else {
        contrib = heldContribFor(getActiveHoldings(p, disabledHoldings), p, portfolioOriginals);
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
  }, [includedPortfolios, mergeMode, N, viewMode, disabledHoldings, prices]);
  const statsResult = stats;

  if (visibleNonEmpty.length < 1) {
    return (
      <div className="surface-card border border-subtle rounded-lg p-6 text-center text-body font-mono text-tertiary shadow-sm">
        Show at least 1 portfolio to see analytics
      </div>
    );
  }

  const sorted = Object.values(statsResult).sort((a, b) => b.combined - a.combined);
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
      <div className="surface-card border border-subtle rounded-lg overflow-hidden shadow-sm">
        <div className="px-5 py-4 border-b border-subtle surface-card-elevated">
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div className="text-[15px] font-serif tracking-tight text-primary" style={{ fontWeight: 500 }}>
              {viewMode === 'bought'
                ? (N === 1 ? `Recent buys · ${singlePortfolio.name}` : 'Recent buys')
                : viewMode === 'sold'
                  ? (N === 1 ? `Recent sells · ${singlePortfolio.name}` : 'Recent sells')
                  : (N === 1 ? `Holdings of ${singlePortfolio.name}` : 'Consensus picks')}
            </div>
            <div className="flex items-center gap-4 flex-wrap">
              {!hideMergeToggle && (
                <label className="flex items-center gap-1.5 text-micro font-mono text-secondary cursor-pointer select-none">
                  <input type="checkbox" checked={mergeMode} onChange={(e) => setMergeMode(e.target.checked)}
                    className="accent-on-bg-color" />
                  <span>Merge dual-class</span>
                </label>
              )}
              <div className="flex items-center gap-3 text-micro font-mono text-secondary">
                <div><span className="tabular-nums text-primary font-medium">{totalUnique}</span> unique</div>
                {mergeMode && mergedCount > 0 && (
                  <div className="relative">
                    <button onClick={() => setShowMergedDetails(s => !s)}
                      className="hover-text-primary transition-colors cursor-pointer">
                      <span className="tabular-nums text-accent-brand font-medium">{mergedCount}</span> merged
                    </button>
                    {showMergedDetails && (
                      <>
                        <div className="fixed inset-0 z-10" onClick={() => setShowMergedDetails(false)} />
                        <div className="absolute right-0 top-full mt-1.5 z-20 surface-card-elevated border border-subtle rounded shadow-lg p-3 min-w-[240px] max-w-[320px]">
                          <div className="text-micro tracking-[0.15em] uppercase text-tertiary font-mono mb-2 flex items-center gap-1.5">
                            <Link2 size={10} className="text-accent-brand" />
                            <span>{mergedCount} merged ticker{mergedCount > 1 ? 's' : ''}</span>
                          </div>
                          <div className="space-y-1 max-h-64 overflow-y-auto">
                            {sorted.filter(s => s.merged).map(s => (
                              <div key={s.ticker} className="text-body font-mono flex items-center gap-2">
                                <span className="text-primary font-medium tabular-nums min-w-[3.5rem]">{s.ticker}</span>
                                <span className="text-muted">←</span>
                                <span className="text-accent-brand">{s.originalsList.join(' + ')}</span>
                              </div>
                            ))}
                          </div>
                        </div>
                      </>
                    )}
                  </div>
                )}
                {N >= 2 && <div><span className="tabular-nums text-primary font-medium">{heldByMultiple}</span> shared</div>}
                {N >= 2 && <div><span className="tabular-nums text-accent-brand font-medium">{heldByAll}</span> ★ all</div>}
              </div>
              {!forcedViewMode && (
                <div className="flex items-center gap-0.5 surface-panel rounded p-0.5">
                  {[
                    { id: 'held',   label: 'Held',   tip: 'Aggregate current weights' },
                    { id: 'bought', label: 'Bought', tip: 'Aggregate positive Δ vs last quarter' },
                    { id: 'sold',   label: 'Sold',   tip: 'Aggregate weight cuts and full exits vs last quarter' },
                  ].map(opt => (
                    <button key={opt.id} onClick={() => setViewMode(opt.id)}
                      className={`px-2.5 py-0.5 text-body tracking-[0.05em] uppercase font-mono rounded transition-all ${
                        viewMode === opt.id ? 'surface-card-elevated text-primary shadow-sm' : 'text-tertiary hover-text-primary'
                      }`}
                      title={opt.tip}>
                      {opt.label}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
          <div className="text-body text-tertiary font-mono mt-1.5">
            {N === 0
              ? (viewMode === 'held'
                  ? 'No portfolios included — toggle below'
                  : 'No portfolios with quarterly history are included — toggle below')
              : viewMode === 'bought'
                ? `Real buys since last quarter, across ${N} portfolio${N === 1 ? '' : 's'} with history`
                : viewMode === 'sold'
                  ? `Real sells since last quarter, across ${N} portfolio${N === 1 ? '' : 's'} with history`
                  : (N === 1
                      ? `Sorted by weight · pool more portfolios below to compute consensus`
                      : `Combined weight from ${N} portfolios — what they collectively believe in`)}
          </div>
        </div>

        {N >= 1 ? (
          <div className="divide-y divide-subtle">
            {consensusTop.map(s => (
              <div key={s.ticker} className="px-5 py-2.5 hover-surface transition-colors">
                <div className="flex items-center gap-3">
                  <div style={{ '--mobile-tw': tickerColWidth }}
                    className="w-20 max-[499px]:w-[var(--mobile-tw)] text-body font-mono text-primary font-medium flex items-center gap-1.5 flex-shrink-0">
                    <span>{s.ticker}</span>
                    {N >= 2 && s.count === N && <span className="text-accent-on-bg text-body">★</span>}
                  </div>
                  <div className="flex-1 relative h-5 surface-panel rounded overflow-hidden flex">
                    {s.holders.map((h, i) => {
                      const segWidth = (h.weight / N) / consensusMax * 100;
                      const interactive = !!onEdit;
                      return (
                        <div key={i}
                          onClick={interactive ? () => onEdit(h.portfolio) : undefined}
                          className={`h-full transition-all ${interactive ? 'cursor-pointer hover:opacity-100' : ''}`}
                          style={{ width: `${segWidth}%`, backgroundColor: h.portfolio.color, opacity: 0.85 }}
                          title={interactive ? `${h.portfolio.name}: ${h.weight.toFixed(2)}% — click to edit` : `${h.portfolio.name}: ${h.weight.toFixed(2)}%`} />
                      );
                    })}
                  </div>
                  <div className="text-body font-mono tabular-nums text-primary font-medium w-14 text-right flex-shrink-0">
                    {s.combined.toFixed(2)}%
                  </div>
                  {N >= 2 && <div className="text-micro font-mono text-tertiary w-10 text-right flex-shrink-0">{s.count}/{N}</div>}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="p-6 text-center text-body font-mono text-tertiary">
            No portfolios included — toggle some below
          </div>
        )}

        {!hidePool && (
          <div className="px-5 py-3 surface-panel">
            <div className="text-micro tracking-[0.2em] uppercase text-tertiary font-mono mb-2">Pool <span className="normal-case tracking-normal text-muted">· click to hide / show · Ctrl/⌘/Shift+click to isolate</span></div>
            <div className="flex items-center gap-1.5 flex-wrap">
              {allWithHoldings.map(p => {
                const hidden = !p.visible;
                const cls = hidden
                  ? 'bg-transparent border-subtle text-muted line-through hover-text-secondary hover-border-strong'
                  : 'surface-card-elevated border-subtle text-primary hover-border-strong';
                const tip = hidden
                  ? 'Click to show · Ctrl/⌘/Shift+click to isolate'
                  : 'Click to hide · Ctrl/⌘/Shift+click to isolate';
                return (
                  <button key={p.id} onClick={(e) => handlePoolChipClick(p, e)}
                    className={`flex items-center gap-1.5 text-body font-mono px-2.5 py-1 rounded border transition-all ${cls}`}
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
        )}
      </div>

      {/* High-conviction picks (orthogonal to consensus) */}
      {highConviction.length > 0 && (
        <div className="surface-card border border-subtle rounded-lg overflow-hidden shadow-sm">
          <div className="px-5 py-4 border-b border-subtle surface-card-elevated">
            <div className="text-[15px] font-serif tracking-tight text-primary" style={{ fontWeight: 500 }}>
              {viewMode === 'bought' ? 'Concentrated buys'
                : viewMode === 'sold' ? 'Concentrated sells'
                : 'High-conviction bets'}
            </div>
            <div className="text-body text-tertiary font-mono mt-0.5">
              {viewMode === 'bought'
                ? 'Big add by 1–2 investors — non-consensus, concentrated buying signal'
                : viewMode === 'sold'
                  ? 'Big trim or full exit by 1–2 investors — non-consensus, concentrated selling signal'
                  : 'Held by few investors but with significant weight — non-consensus, high-conviction picks'}
            </div>
          </div>
          <div className="divide-y divide-subtle">
            {highConviction.map(s => (
              <div key={s.ticker} className="px-5 py-2.5 hover-surface transition-colors">
                <div className="flex items-center gap-3">
                  <div style={{ '--mobile-tw': tickerColWidth }}
                    className="w-20 max-[499px]:w-[var(--mobile-tw)] text-body font-mono text-primary font-medium flex-shrink-0">
                    {s.ticker}
                  </div>
                  <div className="flex-1 flex items-center gap-1.5 flex-wrap">
                    {s.holders.map((h, i) => {
                      const interactive = !!onEdit;
                      const Tag = interactive ? 'button' : 'div';
                      return (
                        <Tag key={i}
                          onClick={interactive ? () => onEdit(h.portfolio) : undefined}
                          className={`flex items-center gap-1 text-body font-mono px-1.5 py-0.5 rounded surface-panel ${interactive ? 'hover-surface transition-colors cursor-pointer' : ''}`}
                          style={{ borderLeft: `2px solid ${h.portfolio.color}` }}
                          title={interactive ? `Edit ${h.portfolio.name}` : undefined}>
                          <span className="text-secondary">{h.portfolio.name}</span>
                          <span className="text-primary tabular-nums font-medium">{h.weight.toFixed(1)}%</span>
                        </Tag>
                      );
                    })}
                  </div>
                  <div className="text-micro font-mono text-tertiary flex-shrink-0">
                    max <span className="text-primary font-medium tabular-nums">{s.maxSingle.toFixed(1)}%</span>
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

// INVESTORS MATRIX — rows = years + CAGR/Sortino/MaxDD, columns = investors
// ============================================================================
//
// Excel-like grid. Click on a row label → sort columns by that row's values.
// Click on an investor's eye toggle (under the name) → add/remove from the
// active portfolio set.
//
// Modes (top right of table):
//   - Absolute: raw annual return per cell
//   - vs VT:    cell = investor_return - VT_return (same year), in pp
//   - vs VOO:   cell = investor_return - VOO_return (same year), in pp
//
// Color + font-weight per cell follow the magnitude rule (see styleForDelta).

const annualReturnFromSeries = (series, year) => {
  if (!series?.length) return null;
  const inYear = series.filter(d => d.date.startsWith(`${year}-`));
  if (inYear.length < 2) {
    const yearStart = series.find(d => d.date >= `${year}-01-01`);
    const yearEndIdx = (() => { let i = -1; series.forEach((d, k) => { if (d.date.startsWith(`${year}-`) || (d.date < `${year + 1}-01-01` && d.date >= `${year}-01-01`)) i = k; }); return i; })();
    if (!yearStart || yearEndIdx < 0) return null;
    const yearEnd = series[yearEndIdx];
    if (yearStart.date === yearEnd.date) return null;
    if (!yearStart.value) return null;
    return (yearEnd.value / yearStart.value - 1) * 100;
  }
  const first = inYear[0].value;
  const last  = inYear[inYear.length - 1].value;
  if (!first) return null;
  return (last / first - 1) * 100;
};

// Closest-or-earlier point lookup. Series is assumed sorted by date.
const _closestLEinSeries = (series, target) => {
  let lo = 0, hi = series.length - 1, ans = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (series[mid].date <= target) { ans = mid; lo = mid + 1; } else hi = mid - 1;
  }
  return ans >= 0 ? series[ans] : null;
};

// Quarter return: value at quarter-end / value at previous quarter-end - 1.
// Uses closest-LE matching so missing month-ends fall back to the nearest earlier point.
const quarterReturnFromSeries = (series, year, q) => {
  if (!series?.length) return null;
  const ends = ['03-31', '06-30', '09-30', '12-31'];
  const endIso = `${year}-${ends[q - 1]}`;
  const startIso = q === 1 ? `${year - 1}-12-31` : `${year}-${ends[q - 2]}`;
  const a = _closestLEinSeries(series, startIso);
  const b = _closestLEinSeries(series, endIso);
  if (!a || !b || !a.value || a.date >= b.date) return null;
  return (b.value / a.value - 1) * 100;
};

// Month return: value at month-end / value at previous month-end - 1.
const monthReturnFromSeries = (series, year, month) => {
  if (!series?.length) return null;
  const endDay = new Date(year, month, 0).getDate();
  const endIso = `${year}-${String(month).padStart(2, '0')}-${String(endDay).padStart(2, '0')}`;
  const prevYear = month === 1 ? year - 1 : year;
  const prevMonth = month === 1 ? 12 : month - 1;
  const prevEndDay = new Date(prevYear, prevMonth, 0).getDate();
  const startIso = `${prevYear}-${String(prevMonth).padStart(2, '0')}-${String(prevEndDay).padStart(2, '0')}`;
  const a = _closestLEinSeries(series, startIso);
  const b = _closestLEinSeries(series, endIso);
  if (!a || !b || !a.value || a.date >= b.date) return null;
  return (b.value / a.value - 1) * 100;
};

// Reduce series to one point per period (the latest point in each period).
// Used by Max DD and Sortino so they reflect the chosen granularity.
const samplesAtGranularity = (series, granularity) => {
  if (!series?.length) return series || [];
  if (granularity === 'monthly') return series;
  const keyOf = (d) => {
    const [y, m] = d.date.split('-').map(Number);
    if (granularity === 'yearly')    return String(y);
    if (granularity === 'quarterly') return `${y}-Q${Math.ceil(m / 3)}`;
    return d.date;
  };
  const last = new Map();
  for (const d of series) last.set(keyOf(d), d);
  return [...last.values()].sort((a, b) => a.date.localeCompare(b.date));
};

const cagrFromSeries = (series) => {
  if (!series || series.length < 2) return null;
  const first = series[0]; const last = series[series.length - 1];
  if (!first.value) return null;
  const days = (new Date(last.date) - new Date(first.date)) / 86400000;
  if (days < 30) return null;
  const years = days / 365.25;
  return (Math.pow(last.value / first.value, 1 / years) - 1) * 100;
};

// Sortino — annualized downside std risk-adjusted return. Uses returns between
// consecutive points at the chosen granularity (yearly / quarterly / monthly).
// Annualization factor matches the granularity (1 / 4 / 12).
const sortinoFromSeries = (series, granularity = 'monthly') => {
  if (!series || series.length < 3) return null;
  const pts = samplesAtGranularity(series, granularity);
  if (pts.length < 3) return null;
  const rets = [];
  for (let i = 1; i < pts.length; i++) {
    const prev = pts[i - 1].value, curr = pts[i].value;
    if (!prev) continue;
    rets.push(curr / prev - 1);
  }
  if (rets.length < 2) return null;
  const mean = rets.reduce((s, r) => s + r, 0) / rets.length;
  const downside = rets.filter(r => r < 0);
  if (!downside.length) return null;
  const downsideStd = Math.sqrt(downside.reduce((s, r) => s + r * r, 0) / downside.length);
  if (!downsideStd) return null;
  const annFactor = granularity === 'yearly' ? 1 : granularity === 'quarterly' ? 4 : 12;
  return (mean * annFactor) / (downsideStd * Math.sqrt(annFactor));
};

// Max drawdown — worst peak-to-trough at the chosen granularity. Monthly is the
// natural finest grain; yearly smooths a lot (only year-end values participate).
const maxDrawdownFromSeries = (series, granularity = 'monthly') => {
  if (!series || series.length < 2) return null;
  const pts = samplesAtGranularity(series, granularity);
  if (pts.length < 2) return null;
  let peak = -Infinity, maxDD = 0;
  for (const d of pts) {
    if (d.value > peak) peak = d.value;
    if (peak > 0) { const dd = (d.value - peak) / peak; if (dd < maxDD) maxDD = dd; }
  }
  return maxDD * 100;
};

const styleForDelta = (delta) => {
  if (delta == null || !Number.isFinite(delta)) return { color: 'var(--text-muted)', fontWeight: 400 };
  const abs = Math.abs(delta);
  if (abs < 3) return { color: 'var(--text-muted)', fontWeight: 400 };
  const isPos = delta >= 0;
  const mild   = isPos ? 'var(--success)'   : 'var(--danger)';
  const strong = isPos ? 'var(--success-strong)' : 'var(--danger-strong)';
  if (abs < 20) return { color: mild,   fontWeight: 400 };
  if (abs < 40) return { color: strong, fontWeight: 700 };
  return                { color: strong, fontWeight: 900 };
};

const fmtPct = (v, d = 1) => v == null || !Number.isFinite(v) ? '—' : `${v >= 0 ? '+' : ''}${v.toFixed(d)}%`;
const fmtRatio = (v, d = 2) => v == null || !Number.isFinite(v) ? '—' : v.toFixed(d);

const InvestorsMatrix = ({
  investorsIndex, portfolios, prices, latestQuarter,
  onToggleVisibility, onEditInvestor,
}) => {
  const [mode, setMode] = useState('absolute');
  const [granularity, setGranularity] = useState('yearly'); // 'yearly' | 'quarterly' | 'monthly'
  // Default: sort columns by CAGR descending — gives the user the best long-term
  // performers on the left immediately on open.
  const [sortRow, setSortRow] = useState({ kind: 'cagr' });
  const [sortDir, setSortDir] = useState('desc');
  const [extraInvestors, setExtraInvestors] = useState({});

  useEffect(() => {
    const base = import.meta.env.BASE_URL;
    const inActive = new Set(portfolios.map(p => p.id));
    const missing = investorsIndex.map(i => i.id).filter(id => !inActive.has(id) && !extraInvestors[id]);
    if (!missing.length) return;
    let cancelled = false;
    (async () => {
      const fetched = {};
      await Promise.all(missing.map(async id => {
        try {
          const r = await fetch(`${base}data/investors/${id}.json`);
          if (!r.ok) return;
          fetched[id] = await r.json();
        } catch {}
      }));
      if (!cancelled && Object.keys(fetched).length) {
        setExtraInvestors(prev => ({ ...prev, ...fetched }));
      }
    })();
    return () => { cancelled = true; };
  }, [investorsIndex, portfolios, extraInvestors]);

  const activeIds = useMemo(() => new Set(portfolios.map(p => p.id)), [portfolios]);

  const investorPortfolios = useMemo(() => investorsIndex.map(inv => {
    const active = portfolios.find(p => p.id === inv.id);
    if (active) return active;
    const extra = extraInvestors[inv.id];
    if (!extra) return null;
    return {
      id: inv.id, name: inv.name, subtitle: inv.subtitle || '',
      kind: inv.kind || 'custom',
      color: getInvestorColor(inv.id, null, null),
      visible: true,
      holdings: extra.holdings || [], history: extra.history || [],
    };
  }), [investorsIndex, portfolios, extraInvestors]);

  const seriesByInvestor = useMemo(() => {
    const out = {};
    investorPortfolios.forEach(p => { if (p) out[p.id] = computeSeries(p, prices); });
    return out;
  }, [investorPortfolios, prices]);

  const voo = portfolios.find(p => p.id === 'voo');
  const vt  = portfolios.find(p => p.id === 'vt');
  const benchSeries = useMemo(() => ({
    voo: voo ? computeSeries(voo, prices) : null,
    vt:  vt  ? computeSeries(vt,  prices) : null,
  }), [voo, vt, prices]);

  // Periods array — one row per period in the body. Yearly = calendar years,
  // Quarterly = every Y-Qn, Monthly = every YYYY-MM present in the data.
  const periods = useMemo(() => {
    const allSeries = Object.values(seriesByInvestor);
    if (granularity === 'yearly') {
      const found = new Set();
      allSeries.forEach(s => { (s || []).forEach(d => found.add(d.date.slice(0, 4))); });
      return [...found].sort().map(y => ({ key: `year-${y}`, kind: 'year', year: parseInt(y), label: y }));
    }
    if (granularity === 'monthly') {
      const found = new Set();
      allSeries.forEach(s => { (s || []).forEach(d => found.add(d.date.slice(0, 7))); });
      const MONTH_LABEL = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
      return [...found].sort().map(s => {
        const [y, m] = s.split('-').map(Number);
        return { key: `m-${y}-${m}`, kind: 'month', year: y, month: m, label: `${MONTH_LABEL[m - 1]} ${y}` };
      });
    }
    // Quarterly
    const found = new Set();
    allSeries.forEach(s => {
      (s || []).forEach(d => {
        const [y, m] = d.date.split('-').map(Number);
        found.add(`${y}-${Math.ceil(m / 3)}`);
      });
    });
    return [...found].sort((a, b) => {
      const [ay, aq] = a.split('-').map(Number);
      const [by, bq] = b.split('-').map(Number);
      return ay - by || aq - bq;
    }).map(s => {
      const [y, q] = s.split('-').map(Number);
      return { key: `q-${y}-${q}`, kind: 'quarter', year: y, q, label: `${y} Q${q}` };
    });
  }, [granularity, seriesByInvestor]);

  const computePeriodValue = (s, per) => per.kind === 'year'    ? annualReturnFromSeries(s, per.year)
                                       : per.kind === 'quarter' ? quarterReturnFromSeries(s, per.year, per.q)
                                       : per.kind === 'month'   ? monthReturnFromSeries(s, per.year, per.month)
                                       : null;

  const absoluteMetrics = useMemo(() => {
    const out = {};
    investorPortfolios.forEach(p => {
      if (!p) return;
      const s = seriesByInvestor[p.id];
      out[p.id] = {
        byPeriod: Object.fromEntries(periods.map(per => [per.key, computePeriodValue(s, per)])),
        cagr: cagrFromSeries(s),
        sortino: sortinoFromSeries(s, granularity),
        maxdd: maxDrawdownFromSeries(s, granularity),
      };
    });
    return out;
  }, [investorPortfolios, seriesByInvestor, periods, granularity]);

  const benchMetrics = useMemo(() => {
    const bench = mode === 'vt' ? benchSeries.vt : mode === 'voo' ? benchSeries.voo : null;
    if (!bench) return null;
    return {
      byPeriod: Object.fromEntries(periods.map(per => [per.key, computePeriodValue(bench, per)])),
      cagr: cagrFromSeries(bench),
      sortino: sortinoFromSeries(bench, granularity),
      maxdd: maxDrawdownFromSeries(bench, granularity),
    };
  }, [mode, benchSeries, periods, granularity]);

  // sortRow shapes: { kind: 'period', periodKey } | { kind: 'cagr' } | { kind: 'sortino' } | { kind: 'maxdd' }
  const cellValue = (invId, kind, periodKey) => {
    const abs = absoluteMetrics[invId];
    if (!abs) return null;
    const absVal = kind === 'period'  ? abs.byPeriod[periodKey]
                 : kind === 'cagr'    ? abs.cagr
                 : kind === 'sortino' ? abs.sortino
                 : kind === 'maxdd'   ? abs.maxdd : null;
    if (mode === 'absolute' || !benchMetrics) return absVal;
    const benchVal = kind === 'period'  ? benchMetrics.byPeriod[periodKey]
                   : kind === 'cagr'    ? benchMetrics.cagr
                   : kind === 'sortino' ? benchMetrics.sortino
                   : kind === 'maxdd'   ? benchMetrics.maxdd : null;
    if (absVal == null || benchVal == null) return null;
    return absVal - benchVal;
  };

  const sortedInvestors = useMemo(() => {
    if (!sortRow) return investorPortfolios.filter(Boolean);
    const dir = sortDir === 'asc' ? 1 : -1;
    return investorPortfolios.filter(Boolean).slice().sort((a, b) => {
      const va = cellValue(a.id, sortRow.kind, sortRow.periodKey);
      const vb = cellValue(b.id, sortRow.kind, sortRow.periodKey);
      if (va == null && vb == null) return 0;
      if (va == null) return 1;
      if (vb == null) return -1;
      return (va - vb) * dir;
    });
  }, [investorPortfolios, sortRow, sortDir, absoluteMetrics, benchMetrics, mode]);

  const onRowClick = (kind, periodKey) => {
    if (sortRow?.kind === kind && sortRow?.periodKey === periodKey) setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    else { setSortRow({ kind, periodKey }); setSortDir('desc'); }
  };

  const isSortRow = (kind, periodKey) => sortRow?.kind === kind && sortRow?.periodKey === periodKey;
  // Row sort moves COLUMNS horizontally — use left/right arrows.
  // Arrow points to the side that holds the larger values:
  //   desc = max on the left  → ←
  //   asc  = max on the right → →
  const sortIndicator = (kind, periodKey) => isSortRow(kind, periodKey)
    ? <span style={{ color: 'var(--text-muted)', marginLeft: 4 }}>{sortDir === 'asc' ? '→' : '←'}</span> : null;

  const styleForRatio = (v, isDelta) => {
    if (v == null) return { color: 'var(--text-muted)', fontWeight: 400 };
    if (!isDelta) return { color: 'var(--text-primary)', fontWeight: 500 };
    if (Math.abs(v) < 0.1) return { color: 'var(--text-muted)', fontWeight: 400 };
    const isPos = v >= 0;
    return { color: isPos ? 'var(--success)' : 'var(--danger)', fontWeight: Math.abs(v) >= 0.5 ? 700 : 400 };
  };

  // Cell pattern: the <td> centers its content horizontally (so the number block
  // sits under the investor's name in the column header). Inside, an inline-block
  // <span> is right-aligned so digits line up vertically across rows. minWidth on
  // the span gives every cell the same internal width — right edges align even
  // when values have different lengths (+12.4% vs +123.4%).
  const renderPctCell = (key, v) => (
    <td key={key} style={{ padding: '8px 10px', textAlign: 'center' }}>
      <span style={{
        ...styleForDelta(v),
        display: 'inline-block', textAlign: 'right',
        fontVariantNumeric: 'tabular-nums', minWidth: 60,
      }}>{fmtPct(v)}</span>
    </td>
  );
  const renderRatioCell = (key, v) => (
    <td key={key} style={{ padding: '8px 10px', textAlign: 'center' }}>
      <span style={{
        ...styleForRatio(v, mode !== 'absolute'),
        display: 'inline-block', textAlign: 'right',
        fontVariantNumeric: 'tabular-nums', minWidth: 60,
      }}>{fmtRatio(v)}</span>
    </td>
  );

  const labelCellStyle = (active) => ({
    position: 'sticky', left: 0, zIndex: 1,
    background: active ? 'var(--row-selected)' : 'var(--bg-card-elevated)',
    borderRight: '1px solid var(--border-subtle)',
    padding: '8px 12px', textAlign: 'left',
    cursor: 'pointer', userSelect: 'none', color: 'var(--text-secondary)',
    // Matches the header cell: shrink to longest label, never wrap.
    width: '1%', whiteSpace: 'nowrap',
  });

  // Sticky bottom rows (CAGR / Sortino / Max DD) — see ETFsMatrix for the
  // matching pattern. Offsets stack: Max DD bottom-most, Sortino above, CAGR
  // above that, then the separator strip.
  const ROW_H = 33;
  const SEP_H = 6;
  const stickyRow = (offset, bg) => ({
    position: 'sticky', bottom: offset, zIndex: 2, background: bg,
  });
  const stickyLabel = (offset, active) => ({
    position: 'sticky', left: 0, bottom: offset, zIndex: 4,
    background: active ? 'var(--row-selected)' : 'var(--bg-card-elevated)',
    borderRight: '1px solid var(--border-subtle)',
    padding: '8px 12px', textAlign: 'left',
    cursor: 'pointer', userSelect: 'none', color: 'var(--text-secondary)',
    width: '1%', whiteSpace: 'nowrap',
  });

  // Dynamic max-height: card grows naturally up to (viewport - distance from
  // top - bottom buffer). When rows exceed that, the inner scroll body takes
  // over. Recomputed on every viewport resize and on any layout shift above
  // the card (e.g. header wraps on narrow widths). Single internal scroll.
  const cardRef = useRef(null);
  useEffect(() => {
    const update = () => {
      const el = cardRef.current;
      if (!el) return;
      const top = el.getBoundingClientRect().top;
      el.style.maxHeight = `calc(100vh - ${Math.max(0, top) + 24}px)`;
    };
    update();
    const ro = new ResizeObserver(update);
    if (document.body) ro.observe(document.body);
    window.addEventListener('resize', update);
    return () => { ro.disconnect(); window.removeEventListener('resize', update); };
  }, []);

  return (
    <div ref={cardRef}
      className="surface-card border border-subtle rounded-lg overflow-hidden shadow-sm flex flex-col">
      <div className="px-5 py-3 border-b border-subtle surface-card-elevated flex items-center justify-between flex-wrap gap-3 flex-shrink-0">
        <div className="text-micro tracking-[0.2em] uppercase text-secondary font-mono">
          Investors · {investorsIndex.length} in base · {[...activeIds].filter(id => investorsIndex.some(i => i.id === id)).length} in portfolio
          <span className="ml-3" style={{ color: 'var(--text-muted)' }}>· base latest: {latestQuarter || '—'}</span>
        </div>
        <div className="flex items-center gap-3 flex-wrap">
          {/* Granularity: yearly | quarterly | monthly. Switches the body rows and how
              Max DD / Sortino are computed (samples taken at the chosen grain). */}
          <div className="flex items-center gap-0.5 surface-panel rounded p-0.5">
            {[{ id: 'yearly', label: 'Yearly' }, { id: 'quarterly', label: 'Quarterly' }, { id: 'monthly', label: 'Monthly' }].map(opt => (
              <button key={opt.id} onClick={() => setGranularity(opt.id)}
                className={`px-2.5 py-0.5 text-body tracking-[0.05em] uppercase font-mono rounded transition-all ${
                  granularity === opt.id ? 'surface-card-elevated text-primary shadow-sm' : 'text-tertiary hover-text-primary'
                }`}>{opt.label}</button>
            ))}
          </div>
          {/* Comparison mode: absolute | vs VT | vs VOO. */}
          <div className="flex items-center gap-0.5 surface-panel rounded p-0.5">
            {[{ id: 'absolute', label: 'Absolute' }, { id: 'vt', label: 'vs VT' }, { id: 'voo', label: 'vs VOO' }].map(opt => (
              <button key={opt.id} onClick={() => setMode(opt.id)}
                className={`px-2.5 py-0.5 text-body tracking-[0.05em] uppercase font-mono rounded transition-all ${
                  mode === opt.id ? 'surface-card-elevated text-primary shadow-sm' : 'text-tertiary hover-text-primary'
                }`}>{opt.label}</button>
            ))}
          </div>
        </div>
      </div>

      {/* flex: '0 1 auto' = natural height, shrinks when parent maxHeight clamps.
          Combined with overflow:auto this gives a single internal scroll only
          when the table actually exceeds available space. */}
      <div style={{ overflow: 'auto', flex: '0 1 auto', minHeight: 0 }}>
        <table className="font-mono text-body" style={{ borderCollapse: 'separate', borderSpacing: 0, width: '100%' }}>
          <thead>
            <tr>
              {/* First column: shrinks to longest label content via width:1% + nowrap.
                  All other columns split the remaining horizontal space evenly. */}
              <th style={{
                position: 'sticky', left: 0, top: 0, zIndex: 3,
                background: 'var(--bg-card-elevated)',
                borderBottom: '1px solid var(--border-strong)',
                borderRight: '1px solid var(--border-subtle)',
                padding: '8px 12px', textAlign: 'left',
                width: '1%', whiteSpace: 'nowrap',
              }}>
                <div className="text-micro tracking-[0.15em] uppercase" style={{ color: 'var(--text-tertiary)' }}>Year / Metric</div>
              </th>
              {sortedInvestors.map(p => {
                const inPortfolio = activeIds.has(p.id);
                const isVisible = inPortfolio && p.visible !== false;
                // Color comes from the same helper used everywhere — single source.
                // For investors not yet in `portfolios`, we don't have a portfolio object,
                // so the deterministic palette fallback kicks in (stable per id).
                const dotColor = getInvestorColor(p.id, inPortfolio ? p : null, null);
                return (
                  <th key={p.id} style={{
                    position: 'sticky', top: 0, zIndex: 2,
                    background: 'var(--bg-card-elevated)',
                    borderBottom: '1px solid var(--border-strong)',
                    padding: '6px 8px',
                    minWidth: 90, maxWidth: 140,
                    textAlign: 'center', verticalAlign: 'top',
                  }}>
                    {/* Color dot + eye toggle on the top row. The dot mirrors the chart line
                        color (so the user sees the link between column and chart line); the eye
                        shows/hides the chart line WITHOUT removing the column. The entire
                        dot+eye area is one button so clicking either side toggles visibility. */}
                    <button onClick={() => onToggleVisibility(p.id)}
                      title={isVisible ? 'Hide chart line' : 'Show chart line'}
                      style={{
                        background: 'none', border: 'none', cursor: 'pointer',
                        padding: '2px 4px', marginBottom: 4,
                        display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
                        width: '100%',
                      }}>
                      <span style={{
                        width: 8, height: 8, borderRadius: '50%',
                        backgroundColor: isVisible ? dotColor : 'transparent',
                        border: `1.5px solid ${dotColor}`,
                        opacity: isVisible ? 1 : 0.5,
                        flexShrink: 0,
                      }} />
                      <span style={{ color: isVisible ? 'var(--accent-on-bg)' : 'var(--text-muted)', display: 'inline-flex' }}>
                        {isVisible ? <Eye size={13} /> : <EyeOff size={13} />}
                      </span>
                    </button>
                    {/* Name below — clamps to 2 lines, then ellipsis. */}
                    <button onClick={() => onEditInvestor(p)} title={p.subtitle || p.name}
                      className="text-body"
                      style={{
                        color: 'var(--text-primary)', fontWeight: 500,
                        background: 'none', border: 'none', cursor: 'pointer', padding: 0,
                        width: '100%', textAlign: 'center',
                        display: '-webkit-box',
                        WebkitLineClamp: 2,
                        WebkitBoxOrient: 'vertical',
                        overflow: 'hidden', textOverflow: 'ellipsis',
                        whiteSpace: 'normal', wordBreak: 'break-word',
                        lineHeight: 1.2, maxHeight: '2.4em',
                      }}>{p.name}</button>
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {periods.map((per, pi) => (
              <tr key={per.key} style={{ background: pi % 2 === 1 ? 'var(--row-stripe)' : 'transparent' }}>
                <td onClick={() => onRowClick('period', per.key)} style={labelCellStyle(isSortRow('period', per.key))}>
                  {per.label}{sortIndicator('period', per.key)}
                </td>
                {sortedInvestors.map(p => renderPctCell(p.id, cellValue(p.id, 'period', per.key)))}
              </tr>
            ))}
            {/* Sticky metric footer — Max DD pinned to bottom, Sortino above,
                CAGR above that, separator stripe on top of the stack. */}
            <tr style={{ ...stickyRow(ROW_H * 3, 'var(--bg-panel)'), height: SEP_H }}>
              <td colSpan={1 + sortedInvestors.length}
                style={{ ...stickyRow(ROW_H * 3, 'var(--bg-panel)'), borderTop: '1px solid var(--border-strong)', padding: 0 }} />
            </tr>
            <tr style={stickyRow(ROW_H * 2, 'var(--bg-card-elevated)')}>
              <td onClick={() => onRowClick('cagr')} style={stickyLabel(ROW_H * 2, isSortRow('cagr'))}>
                CAGR{sortIndicator('cagr')}
              </td>
              {sortedInvestors.map(p => (
                <td key={p.id} style={{ ...stickyRow(ROW_H * 2, 'var(--bg-card-elevated)'), padding: '8px 10px', textAlign: 'center' }}>
                  <span style={{ ...styleForDelta(cellValue(p.id, 'cagr')), display: 'inline-block', textAlign: 'right', fontVariantNumeric: 'tabular-nums', minWidth: 60 }}>
                    {fmtPct(cellValue(p.id, 'cagr'))}
                  </span>
                </td>
              ))}
            </tr>
            <tr style={stickyRow(ROW_H, 'var(--bg-card)')}>
              <td onClick={() => onRowClick('sortino')} style={stickyLabel(ROW_H, isSortRow('sortino'))}>
                Sortino{sortIndicator('sortino')}
              </td>
              {sortedInvestors.map(p => (
                <td key={p.id} style={{ ...stickyRow(ROW_H, 'var(--bg-card)'), padding: '8px 10px', textAlign: 'center' }}>
                  <span style={{ ...styleForRatio(cellValue(p.id, 'sortino'), mode !== 'absolute'), display: 'inline-block', textAlign: 'right', fontVariantNumeric: 'tabular-nums', minWidth: 60 }}>
                    {fmtRatio(cellValue(p.id, 'sortino'))}
                  </span>
                </td>
              ))}
            </tr>
            <tr style={stickyRow(0, 'var(--bg-card-elevated)')}>
              <td onClick={() => onRowClick('maxdd')} style={stickyLabel(0, isSortRow('maxdd'))}>
                Max DD{sortIndicator('maxdd')}
              </td>
              {sortedInvestors.map(p => (
                <td key={p.id} style={{ ...stickyRow(0, 'var(--bg-card-elevated)'), padding: '8px 10px', textAlign: 'center' }}>
                  <span style={{ ...styleForDelta(cellValue(p.id, 'maxdd')), display: 'inline-block', textAlign: 'right', fontVariantNumeric: 'tabular-nums', minWidth: 60 }}>
                    {fmtPct(cellValue(p.id, 'maxdd'))}
                  </span>
                </td>
              ))}
            </tr>
            {sortedInvestors.length === 0 && (
              <tr><td colSpan={1} style={{ padding: 32, textAlign: 'center', color: 'var(--text-muted)' }}>
                Investor base is empty — run INVESTORS-BACKFILL.
              </td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
};


// ============================================================================
// ETFs MATRIX — same grid as InvestorsMatrix, but each "item" is a single-ticker
// ETF instead of a multi-holding investor portfolio. No lazy-fetch of per-item
// files (the index itself carries enough metadata, and pricing comes from the
// shared prices.json). Otherwise the rendering, sorting, modes and granularity
// behaviour are identical — kept as a near-duplicate to avoid one big abstraction
// while the two surfaces are still settling.
// ============================================================================

const ETFsMatrix = ({
  etfsIndex, portfolios, prices, latestQuarter,
  onToggleVisibility, onEditInvestor,
}) => {
  const [mode, setMode] = useState('absolute');
  const [granularity, setGranularity] = useState('yearly');
  const [sortRow, setSortRow] = useState({ kind: 'cagr' });
  const [sortDir, setSortDir] = useState('desc');

  const activeIds = useMemo(() => new Set(portfolios.map(p => p.id)), [portfolios]);

  // Build a portfolio-shaped object for every ETF in the catalog. If the ETF is
  // already active (user toggled it visible from this matrix or restored from
  // saved config), reuse that object so customizations like color survive. For
  // inactive ones, construct a minimal shell whose `computeSeries` will resolve
  // to the price series of its single 100% ticker.
  const etfPortfolios = useMemo(() => etfsIndex.map(meta => {
    const active = portfolios.find(p => p.id === meta.id);
    if (active) return active;
    return {
      id: meta.id,
      name: meta.ticker,
      subtitle: meta.name || '',
      kind: 'etf',
      // Deterministic per-id color from the shared PALETTE — single source of
      // truth across investor / ETF / chart line / column dot.
      color: getInvestorColor(meta.id, null, null),
      visible: true,
      holdings: [{ ticker: meta.ticker, weight: 100 }],
      history: [],
    };
  }), [etfsIndex, portfolios]);

  const seriesByEtf = useMemo(() => {
    const out = {};
    etfPortfolios.forEach(p => { if (p) out[p.id] = computeSeries(p, prices); });
    return out;
  }, [etfPortfolios, prices]);

  const voo = portfolios.find(p => p.id === 'voo');
  const vt  = portfolios.find(p => p.id === 'vt');
  const benchSeries = useMemo(() => ({
    voo: voo ? computeSeries(voo, prices) : null,
    vt:  vt  ? computeSeries(vt,  prices) : null,
  }), [voo, vt, prices]);

  const periods = useMemo(() => {
    const allSeries = Object.values(seriesByEtf);
    if (granularity === 'yearly') {
      const found = new Set();
      allSeries.forEach(s => { (s || []).forEach(d => found.add(d.date.slice(0, 4))); });
      return [...found].sort().map(y => ({ key: `year-${y}`, kind: 'year', year: parseInt(y), label: y }));
    }
    if (granularity === 'monthly') {
      const found = new Set();
      allSeries.forEach(s => { (s || []).forEach(d => found.add(d.date.slice(0, 7))); });
      const MONTH_LABEL = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
      return [...found].sort().map(s => {
        const [y, m] = s.split('-').map(Number);
        return { key: `m-${y}-${m}`, kind: 'month', year: y, month: m, label: `${MONTH_LABEL[m - 1]} ${y}` };
      });
    }
    const found = new Set();
    allSeries.forEach(s => {
      (s || []).forEach(d => {
        const [y, m] = d.date.split('-').map(Number);
        found.add(`${y}-${Math.ceil(m / 3)}`);
      });
    });
    return [...found].sort((a, b) => {
      const [ay, aq] = a.split('-').map(Number);
      const [by, bq] = b.split('-').map(Number);
      return ay - by || aq - bq;
    }).map(s => {
      const [y, q] = s.split('-').map(Number);
      return { key: `q-${y}-${q}`, kind: 'quarter', year: y, q, label: `${y} Q${q}` };
    });
  }, [granularity, seriesByEtf]);

  const computePeriodValue = (s, per) =>
      per.kind === 'year'    ? annualReturnFromSeries(s, per.year)
    : per.kind === 'quarter' ? quarterReturnFromSeries(s, per.year, per.q)
    : per.kind === 'month'   ? monthReturnFromSeries(s, per.year, per.month)
    : null;

  const absoluteMetrics = useMemo(() => {
    const out = {};
    etfPortfolios.forEach(p => {
      if (!p) return;
      const s = seriesByEtf[p.id];
      out[p.id] = {
        byPeriod: Object.fromEntries(periods.map(per => [per.key, computePeriodValue(s, per)])),
        cagr: cagrFromSeries(s),
        sortino: sortinoFromSeries(s, granularity),
        maxdd: maxDrawdownFromSeries(s, granularity),
      };
    });
    return out;
  }, [etfPortfolios, seriesByEtf, periods, granularity]);

  const benchMetrics = useMemo(() => {
    const bench = mode === 'vt' ? benchSeries.vt : mode === 'voo' ? benchSeries.voo : null;
    if (!bench) return null;
    return {
      byPeriod: Object.fromEntries(periods.map(per => [per.key, computePeriodValue(bench, per)])),
      cagr: cagrFromSeries(bench),
      sortino: sortinoFromSeries(bench, granularity),
      maxdd: maxDrawdownFromSeries(bench, granularity),
    };
  }, [mode, benchSeries, periods, granularity]);

  const cellValue = (id, kind, periodKey) => {
    const abs = absoluteMetrics[id];
    if (!abs) return null;
    const absVal = kind === 'period'  ? abs.byPeriod[periodKey]
                 : kind === 'cagr'    ? abs.cagr
                 : kind === 'sortino' ? abs.sortino
                 : kind === 'maxdd'   ? abs.maxdd : null;
    if (mode === 'absolute' || !benchMetrics) return absVal;
    const benchVal = kind === 'period'  ? benchMetrics.byPeriod[periodKey]
                   : kind === 'cagr'    ? benchMetrics.cagr
                   : kind === 'sortino' ? benchMetrics.sortino
                   : kind === 'maxdd'   ? benchMetrics.maxdd : null;
    if (absVal == null || benchVal == null) return null;
    return absVal - benchVal;
  };

  const sortedEtfs = useMemo(() => {
    if (!sortRow) return etfPortfolios.filter(Boolean);
    const dir = sortDir === 'asc' ? 1 : -1;
    return etfPortfolios.filter(Boolean).slice().sort((a, b) => {
      const va = cellValue(a.id, sortRow.kind, sortRow.periodKey);
      const vb = cellValue(b.id, sortRow.kind, sortRow.periodKey);
      if (va == null && vb == null) return 0;
      if (va == null) return 1;
      if (vb == null) return -1;
      return (va - vb) * dir;
    });
  }, [etfPortfolios, sortRow, sortDir, absoluteMetrics, benchMetrics, mode]);

  const onRowClick = (kind, periodKey) => {
    if (sortRow?.kind === kind && sortRow?.periodKey === periodKey) setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    else { setSortRow({ kind, periodKey }); setSortDir('desc'); }
  };

  const isSortRow = (kind, periodKey) => sortRow?.kind === kind && sortRow?.periodKey === periodKey;
  const sortIndicator = (kind, periodKey) => isSortRow(kind, periodKey)
    ? <span style={{ color: 'var(--text-muted)', marginLeft: 4 }}>{sortDir === 'asc' ? '→' : '←'}</span> : null;

  const styleForRatio = (v, isDelta) => {
    if (v == null) return { color: 'var(--text-muted)', fontWeight: 400 };
    if (!isDelta) return { color: 'var(--text-primary)', fontWeight: 500 };
    if (Math.abs(v) < 0.1) return { color: 'var(--text-muted)', fontWeight: 400 };
    const isPos = v >= 0;
    return { color: isPos ? 'var(--success)' : 'var(--danger)', fontWeight: Math.abs(v) >= 0.5 ? 700 : 400 };
  };

  const renderPctCell = (key, v) => (
    <td key={key} style={{ padding: '8px 10px', textAlign: 'center' }}>
      <span style={{ ...styleForDelta(v), display: 'inline-block', textAlign: 'right', fontVariantNumeric: 'tabular-nums', minWidth: 60 }}>{fmtPct(v)}</span>
    </td>
  );
  const renderRatioCell = (key, v) => (
    <td key={key} style={{ padding: '8px 10px', textAlign: 'center' }}>
      <span style={{ ...styleForRatio(v, mode !== 'absolute'), display: 'inline-block', textAlign: 'right', fontVariantNumeric: 'tabular-nums', minWidth: 60 }}>{fmtRatio(v)}</span>
    </td>
  );

  const labelCellStyle = (active) => ({
    position: 'sticky', left: 0, zIndex: 1,
    background: active ? 'var(--row-selected)' : 'var(--bg-card-elevated)',
    borderRight: '1px solid var(--border-subtle)',
    padding: '8px 12px', textAlign: 'left',
    cursor: 'pointer', userSelect: 'none', color: 'var(--text-secondary)',
    width: '1%', whiteSpace: 'nowrap',
  });

  const activeEtfCount = [...activeIds].filter(id => etfsIndex.some(e => e.id === id)).length;

  // Sticky bottom rows (CAGR / Sortino / Max DD) — pinned to the scroll container's
  // bottom edge so totals stay visible while the user scrolls through years/quarters.
  // Stacked offsets: Max DD is bottom-most, Sortino above it, CAGR above that.
  // The separator strip sits highest in the stack so it visually anchors the trio.
  const ROW_H = 33;                       // ~match real row height (8px padding + ~17px line)
  const SEP_H = 6;
  const stickyRow = (offset, bg) => ({
    position: 'sticky', bottom: offset, zIndex: 2, background: bg,
  });
  const stickyLabel = (offset, active) => ({
    position: 'sticky', left: 0, bottom: offset, zIndex: 4,
    background: active ? 'var(--row-selected)' : 'var(--bg-card-elevated)',
    borderRight: '1px solid var(--border-subtle)',
    padding: '8px 12px', textAlign: 'left',
    cursor: 'pointer', userSelect: 'none', color: 'var(--text-secondary)',
    width: '1%', whiteSpace: 'nowrap',
  });

  // Dynamic max-height: card grows naturally up to (viewport - distance from
  // top - bottom buffer). When rows exceed that, the inner scroll body takes
  // over. Recomputed on every viewport resize and on any layout shift above
  // the card (e.g. header wraps on narrow widths). Single internal scroll.
  const cardRef = useRef(null);
  useEffect(() => {
    const update = () => {
      const el = cardRef.current;
      if (!el) return;
      const top = el.getBoundingClientRect().top;
      el.style.maxHeight = `calc(100vh - ${Math.max(0, top) + 24}px)`;
    };
    update();
    const ro = new ResizeObserver(update);
    if (document.body) ro.observe(document.body);
    window.addEventListener('resize', update);
    return () => { ro.disconnect(); window.removeEventListener('resize', update); };
  }, []);

  return (
    <div ref={cardRef}
      className="surface-card border border-subtle rounded-lg overflow-hidden shadow-sm flex flex-col">
      <div className="px-5 py-3 border-b border-subtle surface-card-elevated flex items-center justify-between flex-wrap gap-3 flex-shrink-0">
        <div className="text-micro tracking-[0.2em] uppercase text-secondary font-mono">
          ETFs · {etfsIndex.length} in base · {activeEtfCount} in portfolio
        </div>
        <div className="flex items-center gap-3 flex-wrap">
          <div className="flex items-center gap-0.5 surface-panel rounded p-0.5">
            {[{ id: 'yearly', label: 'Yearly' }, { id: 'quarterly', label: 'Quarterly' }, { id: 'monthly', label: 'Monthly' }].map(opt => (
              <button key={opt.id} onClick={() => setGranularity(opt.id)}
                className={`px-2.5 py-0.5 text-body tracking-[0.05em] uppercase font-mono rounded transition-all ${
                  granularity === opt.id ? 'surface-card-elevated text-primary shadow-sm' : 'text-tertiary hover-text-primary'
                }`}>{opt.label}</button>
            ))}
          </div>
          <div className="flex items-center gap-0.5 surface-panel rounded p-0.5">
            {[{ id: 'absolute', label: 'Absolute' }, { id: 'vt', label: 'vs VT' }, { id: 'voo', label: 'vs VOO' }].map(opt => (
              <button key={opt.id} onClick={() => setMode(opt.id)}
                className={`px-2.5 py-0.5 text-body tracking-[0.05em] uppercase font-mono rounded transition-all ${
                  mode === opt.id ? 'surface-card-elevated text-primary shadow-sm' : 'text-tertiary hover-text-primary'
                }`}>{opt.label}</button>
            ))}
          </div>
        </div>
      </div>

      {/* flex: '0 1 auto' = natural height, shrinks when parent maxHeight clamps.
          Combined with overflow:auto this gives a single internal scroll only
          when the table actually exceeds available space. */}
      <div style={{ overflow: 'auto', flex: '0 1 auto', minHeight: 0 }}>
        <table className="font-mono text-body" style={{ borderCollapse: 'separate', borderSpacing: 0, width: '100%' }}>
          <thead>
            <tr>
              <th style={{
                position: 'sticky', left: 0, top: 0, zIndex: 3,
                background: 'var(--bg-card-elevated)',
                borderBottom: '1px solid var(--border-strong)',
                borderRight: '1px solid var(--border-subtle)',
                padding: '8px 12px', textAlign: 'left',
                width: '1%', whiteSpace: 'nowrap',
              }}>
                <div className="text-micro tracking-[0.15em] uppercase" style={{ color: 'var(--text-tertiary)' }}>Year / Metric</div>
              </th>
              {sortedEtfs.map(p => {
                const inPortfolio = activeIds.has(p.id);
                const isVisible = inPortfolio && p.visible !== false;
                const dotColor = getInvestorColor(p.id, inPortfolio ? p : null, null);
                return (
                  <th key={p.id} style={{
                    position: 'sticky', top: 0, zIndex: 2,
                    background: 'var(--bg-card-elevated)',
                    borderBottom: '1px solid var(--border-strong)',
                    padding: '6px 8px',
                    minWidth: 90, maxWidth: 140,
                    textAlign: 'center', verticalAlign: 'top',
                  }}>
                    <button onClick={() => onToggleVisibility(p.id)}
                      title={isVisible ? 'Hide chart line' : 'Show chart line'}
                      style={{
                        background: 'none', border: 'none', cursor: 'pointer',
                        padding: '2px 4px', marginBottom: 4,
                        display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
                        width: '100%',
                      }}>
                      <span style={{
                        width: 8, height: 8, borderRadius: '50%',
                        backgroundColor: isVisible ? dotColor : 'transparent',
                        border: `1.5px solid ${dotColor}`,
                        opacity: isVisible ? 1 : 0.5,
                        flexShrink: 0,
                      }} />
                      <span style={{ color: isVisible ? 'var(--accent-on-bg)' : 'var(--text-muted)', display: 'inline-flex' }}>
                        {isVisible ? <Eye size={13} /> : <EyeOff size={13} />}
                      </span>
                    </button>
                    <button onClick={() => onEditInvestor(p)} title={p.subtitle || p.name}
                      className="text-body"
                      style={{
                        color: 'var(--text-primary)', fontWeight: 500,
                        background: 'none', border: 'none', cursor: 'pointer', padding: 0,
                        width: '100%', textAlign: 'center',
                        display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical',
                        overflow: 'hidden', textOverflow: 'ellipsis',
                        whiteSpace: 'normal', wordBreak: 'break-word',
                        lineHeight: 1.2, maxHeight: '2.4em',
                      }}>{p.name}</button>
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {periods.map((per, pi) => (
              <tr key={per.key} style={{ background: pi % 2 === 1 ? 'var(--row-stripe)' : 'transparent' }}>
                <td onClick={() => onRowClick('period', per.key)} style={labelCellStyle(isSortRow('period', per.key))}>
                  {per.label}{sortIndicator('period', per.key)}
                </td>
                {sortedEtfs.map(p => renderPctCell(p.id, cellValue(p.id, 'period', per.key)))}
              </tr>
            ))}
            {/* Metric rows — stuck to the bottom of the scroll container.
                Offsets stack: Max DD at 0, Sortino above it, CAGR above that,
                separator stripe on top. Background is opaque so scrolling
                periods don't bleed through. */}
            <tr style={{ ...stickyRow(ROW_H * 3, 'var(--bg-panel)'), height: SEP_H }}>
              <td colSpan={1 + sortedEtfs.length}
                style={{ ...stickyRow(ROW_H * 3, 'var(--bg-panel)'), borderTop: '1px solid var(--border-strong)', padding: 0 }} />
            </tr>
            <tr style={stickyRow(ROW_H * 2, 'var(--bg-card-elevated)')}>
              <td onClick={() => onRowClick('cagr')} style={stickyLabel(ROW_H * 2, isSortRow('cagr'))}>
                CAGR{sortIndicator('cagr')}
              </td>
              {sortedEtfs.map(p => (
                <td key={p.id} style={{ ...stickyRow(ROW_H * 2, 'var(--bg-card-elevated)'), padding: '8px 10px', textAlign: 'center' }}>
                  <span style={{ ...styleForDelta(cellValue(p.id, 'cagr')), display: 'inline-block', textAlign: 'right', fontVariantNumeric: 'tabular-nums', minWidth: 60 }}>
                    {fmtPct(cellValue(p.id, 'cagr'))}
                  </span>
                </td>
              ))}
            </tr>
            <tr style={stickyRow(ROW_H, 'var(--bg-card)')}>
              <td onClick={() => onRowClick('sortino')} style={stickyLabel(ROW_H, isSortRow('sortino'))}>
                Sortino{sortIndicator('sortino')}
              </td>
              {sortedEtfs.map(p => (
                <td key={p.id} style={{ ...stickyRow(ROW_H, 'var(--bg-card)'), padding: '8px 10px', textAlign: 'center' }}>
                  <span style={{ ...styleForRatio(cellValue(p.id, 'sortino'), mode !== 'absolute'), display: 'inline-block', textAlign: 'right', fontVariantNumeric: 'tabular-nums', minWidth: 60 }}>
                    {fmtRatio(cellValue(p.id, 'sortino'))}
                  </span>
                </td>
              ))}
            </tr>
            <tr style={stickyRow(0, 'var(--bg-card-elevated)')}>
              <td onClick={() => onRowClick('maxdd')} style={stickyLabel(0, isSortRow('maxdd'))}>
                Max DD{sortIndicator('maxdd')}
              </td>
              {sortedEtfs.map(p => (
                <td key={p.id} style={{ ...stickyRow(0, 'var(--bg-card-elevated)'), padding: '8px 10px', textAlign: 'center' }}>
                  <span style={{ ...styleForDelta(cellValue(p.id, 'maxdd')), display: 'inline-block', textAlign: 'right', fontVariantNumeric: 'tabular-nums', minWidth: 60 }}>
                    {fmtPct(cellValue(p.id, 'maxdd'))}
                  </span>
                </td>
              ))}
            </tr>
            {sortedEtfs.length === 0 && (
              <tr><td colSpan={1} style={{ padding: 32, textAlign: 'center', color: 'var(--text-muted)' }}>
                ETF catalog is empty — populate public/data/etfs-index.json.
              </td></tr>
            )}
          </tbody>
        </table>
      </div>
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
  const [showBackup, setShowBackup] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [chartMode, setChartMode] = useState('absolute');
  const [chartPeriod, setChartPeriod] = useState('ALL');
  const [draggedId, setDraggedId] = useState(null);
  const [dragOverId, setDragOverId] = useState(null);
  const [dragOverPos, setDragOverPos] = useState(null); // 'before' | 'after'
  const [defaultDataHash, setDefaultDataHash] = useState(null);
  const [saving, setSaving] = useState(false);
  const [disabledHoldings, setDisabledHoldings] = useState({});  // { portfolioId: Set<TICKER> } — transient, not saved
  const [view, setView] = useState('portfolio');               // 'portfolio' | 'investors' | 'etfs'
  const [investorsIndex, setInvestorsIndex] = useState([]);    // catalog of every investor in the base
  const [etfsIndex, setEtfsIndex] = useState([]);              // catalog of every ETF in the base (public/data/etfs-index.json)
  const [latestQuarter, setLatestQuarter] = useState(null);    // from public/data/meta.json
  // Theme: time-of-day-based. Light between 07:00 and 19:00 local time, dark otherwise.
  // Re-checks on window focus and every 15 minutes, so leaving the app open across sunset
  // still flips the theme. The button toggle sets a manual override that sticks for the
  // session (until reload).
  const isDayHourNow = () => {
    const h = new Date().getHours();
    return h >= 7 && h < 19;
  };
  const [darkMode, setDarkMode] = useState(() => !isDayHourNow());
  const [themeManualOverride, setThemeManualOverride] = useState(false);

  // UI zoom — scales the root font-size so every `rem`-based UI class
  // (text-micro/-body/-prom) grows or shrinks together. Session-only,
  // resets on reload (matching the darkMode / chartMode pattern).
  const MIN_SCALE = 0.85, MAX_SCALE = 1.5, STEP = 0.1;
  const [uiScale, setUiScale] = useState(1.0);
  useEffect(() => {
    document.documentElement.style.fontSize = `${16 * uiScale}px`;
    return () => { document.documentElement.style.fontSize = ''; };
  }, [uiScale]);

  useEffect(() => {
    if (themeManualOverride) return;
    const sync = () => setDarkMode(!isDayHourNow());
    const id = setInterval(sync, 15 * 60 * 1000);
    window.addEventListener('focus', sync);
    return () => {
      clearInterval(id);
      window.removeEventListener('focus', sync);
    };
  }, [themeManualOverride]);

  // Global "Merge dual-class" toggle. Defaults to ON.
  // When ON, the app displays each share-class pair (BRK.A/BRK.B, GOOG/GOOGL) as a single
  // canonical row; price-series math (computeSeries) is unaffected because dual-class shares
  // move proportionally so chain-link returns are identical either way.
  const [mergeMode, setMergeMode] = useState(true);

  useEffect(() => {
    document.documentElement.classList.toggle('dark', darkMode);
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
  // Hash of the user-editable surface only — what Save persists to default-data.json.
  // Investors' holdings/history live in the read-only base (public/data/investors/*) and
  // do NOT influence dirty state; prices live in public/data/prices.json and don't either.
  // Reorder / color / visibility / subtitle / name on any portfolio still mark dirty.
  const computeHash = (portfolios) => {
    const p = JSON.stringify(portfolios.map(p => ({
      id: p.id, name: p.name, subtitle: p.subtitle, kind: p.kind, color: p.color,
      visible: p.visible, locked: p.locked,
      // Holdings/history are part of the hash only for kinds the user actually edits
      // (benchmarks shells, myPortfolio, tarasGuk). For investors loaded from the base
      // they're stable — we omit them here so a re-fetch never flags dirty.
      holdings: (p.kind === 'guru' || p.kind === 'custom' && p.id !== 'mine' && p.id !== 'youtuber') ? undefined : p.holdings,
      history:  (p.kind === 'guru' || p.kind === 'custom' && p.id !== 'mine' && p.id !== 'youtuber') ? undefined : p.history,
    })));
    let h = 0;
    for (let i = 0; i < p.length; i++) { h = ((h << 5) - h + p.charCodeAt(i)) | 0; }
    return h;
  };

  // Fetch the bundled default state. v9 layout splits data into:
  //   - public/default-data.json        — user config (selectedInvestors, customization, benchmarks, myPortfolio, tarasGuk)
  //   - public/data/investors-index.json — investor catalog (metadata only, no holdings)
  //   - public/data/investors/<id>.json  — per-investor holdings + history (read-only base)
  //   - public/data/prices.json          — all ticker prices
  //   - public/data/meta.json            — { latestQuarter, lastBackfillAt, ... }
  // Assembled into the existing in-memory shape { portfolios: [...], prices: {...} }
  // so downstream code (computeSeries, chart wiring, edit modal) keeps working unchanged.
  // Backwards-compatible: if default-data.json lacks a v9 marker, falls back to v8 monolithic shape.
  const fetchDefaultData = async () => {
    try {
      const base = import.meta.env.BASE_URL;
      const cfgRes = await fetch(base + 'default-data.json');
      if (!cfgRes.ok) return null;
      const cfg = await cfgRes.json();

      // ----- Legacy v8 monolithic fallback -----
      if (cfg.version !== 'v9' || Array.isArray(cfg.portfolios)) {
        return {
          portfolios: Array.isArray(cfg.portfolios) ? cfg.portfolios : null,
          prices: (cfg.prices && typeof cfg.prices === 'object') ? cfg.prices : {}
        };
      }

      // ----- v9 split layout -----
      const [pricesRes, indexRes, metaRes, etfsRes] = await Promise.all([
        fetch(base + 'data/prices.json'),
        fetch(base + 'data/investors-index.json'),
        fetch(base + 'data/meta.json'),
        fetch(base + 'data/etfs-index.json'),
      ]);
      const prices = pricesRes.ok ? await pricesRes.json() : {};
      const index = indexRes.ok ? await indexRes.json() : { investors: [] };
      const meta = metaRes.ok ? await metaRes.json() : {};
      const etfsCatalog = etfsRes.ok ? await etfsRes.json() : { etfs: [] };
      const indexById = new Map((index.investors || []).map(i => [i.id, i]));
      const etfsById = new Map((etfsCatalog.etfs || []).map(e => [e.id, e]));

      // Per-investor files — fetch in parallel for the currently selected set.
      // Unselected investors aren't loaded here (lazy: load when user adds them via the
      // upcoming investors table). For Phase 0 the migration set ALL of them as
      // selected, so this fetches every file — fine, ~10 files × ~10KB each.
      const selectedIds = Array.isArray(cfg.selectedInvestors) ? cfg.selectedInvestors : [];
      const investorFiles = await Promise.all(selectedIds.map(async (id) => {
        try {
          const r = await fetch(`${base}data/investors/${id}.json`);
          if (!r.ok) return null;
          const inv = await r.json();
          const meta = indexById.get(id) || {};
          const custom = (cfg.investorCustomization || {})[id] || {};
          // Re-hydrate into the legacy portfolio shape so the rest of the app sees
          // the same object structure it always did.
          return {
            id,
            name: meta.name || id,
            subtitle: meta.subtitle || '',
            kind: meta.kind || 'custom',
            color: custom.color || '#1a1815',
            visible: custom.visible !== false,
            locked: !!custom.locked,
            holdings: inv.holdings || [],
            history: inv.history || [],
          };
        } catch { return null; }
      }));

      // ETF entries from selectedEtfs[]. Each becomes a single-ticker "portfolio" with
      // kind='etf' — the chart treats it like any other portfolio (one line) and the
      // matrix helpers (computeSeries, annualReturn, …) handle the trivial case where
      // holdings is a single 100%-weight ticker.
      const selectedEtfIds = Array.isArray(cfg.selectedEtfs) ? cfg.selectedEtfs : [];
      const etfPortfolios = selectedEtfIds.map((id) => {
        const meta = etfsById.get(id);
        if (!meta) return null;
        const custom = (cfg.etfCustomization || {})[id] || {};
        return {
          id,
          name: meta.ticker,
          subtitle: meta.name || '',
          kind: 'etf',
          color: custom.color || getInvestorColor(id, null, null),
          visible: custom.visible !== false,
          locked: !!custom.locked,
          holdings: [{ ticker: meta.ticker, weight: 100 }],
          history: [],
        };
      }).filter(Boolean);

      // Assemble the legacy `portfolios` array in display order:
      //   benchmarks → myPortfolio → tarasGuk → selected investors (in selectedInvestors[] order)
      //   → selected ETFs (in selectedEtfs[] order)
      const portfolios = [
        ...(Array.isArray(cfg.benchmarks) ? cfg.benchmarks : []),
        ...(cfg.myPortfolio ? [cfg.myPortfolio] : []),
        ...(cfg.tarasGuk ? [cfg.tarasGuk] : []),
        ...investorFiles.filter(Boolean),
        ...etfPortfolios,
      ];
      return {
        portfolios, prices, meta,
        investorsIndex: index.investors || [],
        etfsIndex: etfsCatalog.etfs || [],
      };
    } catch { return null; }
  };

  // Lazy-load one per-investor file when the user toggles them on from the matrix.
  // Returns the assembled portfolio object in the same shape every consumer expects.
  const loadInvestor = async (id) => {
    try {
      const base = import.meta.env.BASE_URL;
      const meta = investorsIndex.find(i => i.id === id);
      if (!meta) return null;
      const r = await fetch(`${base}data/investors/${id}.json`);
      if (!r.ok) return null;
      const inv = await r.json();
      return {
        id,
        name: meta.name,
        subtitle: meta.subtitle || '',
        kind: meta.kind || 'custom',
        color: getInvestorColor(id, null, null),
        visible: true,
        locked: false,
        holdings: inv.holdings || [],
        history: inv.history || [],
      };
    } catch { return null; }
  };

  // Toggle the chart-line visibility of an investor without removing them from the
  // matrix. If they're not yet in the active portfolio set, lazy-fetch + add with
  // visible=true. Used by the matrix table's eye-toggle in the column header.
  const togglePortfolioVisibilityById = async (id) => {
    const existing = portfolios.find(p => p.id === id);
    if (existing) {
      setPortfolios(prev => prev.map(p => p.id === id ? { ...p, visible: !p.visible } : p));
      return;
    }
    const p = await loadInvestor(id);
    if (!p) return;
    setPortfolios(prev => [...prev, { ...p, visible: true }]);
  };

  // Same as togglePortfolioVisibilityById but for ETFs from the etfsIndex catalog.
  // ETF "portfolios" are single-ticker (weight 100) shells — no fetch needed beyond
  // the prices that prices.json already carries; the lookup is the index entry.
  const toggleEtfVisibilityById = (id) => {
    const existing = portfolios.find(p => p.id === id);
    if (existing) {
      setPortfolios(prev => prev.map(p => p.id === id ? { ...p, visible: !p.visible } : p));
      return;
    }
    const meta = etfsIndex.find(e => e.id === id);
    if (!meta) return;
    setPortfolios(prev => [...prev, {
      id, name: meta.ticker, subtitle: meta.name || '',
      kind: 'etf',
      color: getInvestorColor(id, null, null),
      visible: true, locked: false,
      holdings: [{ ticker: meta.ticker, weight: 100 }],
      history: [],
    }]);
  };

  useEffect(() => {
    (async () => {
      const def = await fetchDefaultData();
      if (def?.portfolios) {
        setPortfolios(def.portfolios);
        setPrices(def.prices || {});
        setInvestorsIndex(def.investorsIndex || []);
        setEtfsIndex(def.etfsIndex || []);
        setLatestQuarter(def.meta?.latestQuarter || null);
        setDefaultDataHash(computeHash(def.portfolios));
      } else {
        setPortfolios(DEFAULT_PORTFOLIOS);
        setPrices({});
      }
      setLoaded(true);
    })();
  }, []);

  const currentDataHash = useMemo(() => {
    if (!loaded) return null;
    return computeHash(portfolios);
  }, [portfolios, loaded]);

  const hasUnsavedChanges = loaded && defaultDataHash !== null && currentDataHash !== defaultDataHash;

  // Save only writes the user-config layer back into public/default-data.json.
  // The read-only investor base (public/data/*) is NEVER written from here — that's
  // the goals' job (INVESTORS-BACKFILL / STOCKS-UPDATE).
  const handleSaveDefault = async () => {
    if (saving) return;
    setSaving(true);
    try {
      const isBenchmark = (p) => p.kind === 'benchmark';
      const isMine = (p) => p.id === 'mine';
      const isTarasGuk = (p) => p.id === 'youtuber';
      const isEtf = (p) => p.kind === 'etf';
      const isInvestor = (p) => !isBenchmark(p) && !isMine(p) && !isTarasGuk(p) && !isEtf(p);

      const benchmarks = portfolios.filter(isBenchmark);
      const myPortfolio = portfolios.find(isMine) || null;
      const tarasGuk = portfolios.find(isTarasGuk) || null;
      const investors = portfolios.filter(isInvestor);
      const etfs = portfolios.filter(isEtf);

      const selectedInvestors = investors.map(p => p.id);
      const investorCustomization = {};
      for (const p of investors) {
        investorCustomization[p.id] = {
          color: p.color,
          visible: p.visible,
          locked: p.locked,
        };
      }
      const selectedEtfs = etfs.map(p => p.id);
      const etfCustomization = {};
      for (const p of etfs) {
        etfCustomization[p.id] = { color: p.color, visible: p.visible, locked: p.locked };
      }

      const data = {
        version: 'v9',
        exportedAt: new Date().toISOString(),
        benchmarks,
        myPortfolio,
        tarasGuk,
        selectedInvestors,
        investorCustomization,
        selectedEtfs,
        etfCustomization,
      };

      const res = await fetch('/api/save-default', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data)
      });
      if (!res.ok) throw new Error('Save failed');
      setDefaultDataHash(currentDataHash);
    } catch (err) {
      console.error('[save] Failed to save default data:', err);
      alert('Failed to save: ' + err.message);
    } finally {
      setSaving(false);
    }
  };

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

    // Precompute date→value Map per visible portfolio once, so the per-row lookup is O(1).
    // (Without this, `.find` in the row loop made building the table O(P·D²) — slow with many
    // portfolios + dates.)
    const byPortfolio = new Map(
      visible.map(p => [p.id, new Map(portfolioSeries[p.id].map(d => [d.date, d.value]))])
    );

    // vs-mode: a date is plottable only when the benchmark itself has a point for it.
    if (effectiveMode === 'vs' && benchmarkPortfolio) {
      const benchByDate = byPortfolio.get(benchmarkPortfolio.id) ||
        new Map(portfolioSeries[benchmarkPortfolio.id].map(d => [d.date, d.value]));
      const allDates = new Set();
      visible.forEach(p => byPortfolio.get(p.id).forEach((_, date) => { if (benchByDate.has(date)) allDates.add(date); }));
      return [...allDates].sort().map(date => {
        const benchValue = benchByDate.get(date);
        const row = { date };
        visible.forEach(p => {
          const value = byPortfolio.get(p.id).get(date);
          if (value !== undefined && benchValue) row[p.id] = (value / benchValue) * 100;
        });
        return row;
      });
    }

    // Absolute mode: union of all dates across visible portfolios. Each portfolio appears only
    // on dates where it has data — earlier portfolios start earlier on the chart. Without union,
    // adding a single chain-linked portfolio (Taras Guk with Q3 history) used to compress the
    // common date range and silently truncate the others' history.
    const allDates = new Set();
    visible.forEach(p => byPortfolio.get(p.id).forEach((_, date) => allDates.add(date)));
    return [...allDates].sort().map(date => {
      const row = { date };
      visible.forEach(p => {
        const value = byPortfolio.get(p.id).get(date);
        if (value !== undefined) row[p.id] = value;
      });
      return row;
    });
  }, [portfolios, portfolioSeries, effectiveMode, benchmarkPortfolio]);

  // Step 2: filter by period and re-normalize so first row = 100
  const chartData = useMemo(() => {
    if (!fullChartData.length) return fullChartData;
    // Slice by period (ALL keeps everything).
    let filtered = fullChartData;
    const cutoff = periodCutoffIso(chartPeriod, fullChartData[fullChartData.length - 1].date);
    if (cutoff) {
      const sliced = fullChartData.filter(d => d.date >= cutoff);
      if (sliced.length >= 2) filtered = sliced;
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

  // Per-portfolio return for the CURRENT chart period and mode. Used by PortfolioRow so the
  // % shown next to each name matches what the chart line shows (e.g. when YTD is selected,
  // the row shows YTD return; when `vs VOO` is active, it shows the outperformance vs VOO).
  // Computed for ALL portfolios (visible and not) so hidden ones still show a number.
  const displayPctByPortfolio = useMemo(() => {
    const result = {};
    // Find the latest date across any series — anchors the period cutoff.
    let globalLast = null;
    for (const k in portfolioSeries) {
      const arr = portfolioSeries[k];
      if (arr?.length) {
        const lastD = arr[arr.length - 1].date;
        if (!globalLast || lastD > globalLast) globalLast = lastD;
      }
    }
    if (!globalLast) return result;
    const cutoff = periodCutoffIso(chartPeriod, globalLast);

    const slice = (series) => {
      if (!cutoff || !series?.length) return series || [];
      const s = series.filter(d => d.date >= cutoff);
      return s.length >= 2 ? s : series; // fall back to full series if the slice is too thin
    };

    if (effectiveMode === 'vs' && benchmarkPortfolio) {
      const benchSliced = slice(portfolioSeries[benchmarkPortfolio.id]);
      const benchByDate = new Map(benchSliced.map(d => [d.date, d.value]));
      for (const [pid, series] of Object.entries(portfolioSeries)) {
        const sliced = slice(series);
        const ratios = sliced
          .map(d => benchByDate.has(d.date) ? d.value / benchByDate.get(d.date) : null)
          .filter(r => r !== null);
        if (ratios.length < 2 || ratios[0] === 0) continue;
        result[pid] = (ratios[ratios.length - 1] / ratios[0]) * 100 - 100;
      }
    } else {
      for (const [pid, series] of Object.entries(portfolioSeries)) {
        const sliced = slice(series);
        if (sliced.length < 2 || sliced[0].value === 0) continue;
        result[pid] = (sliced[sliced.length - 1].value / sliced[0].value) * 100 - 100;
      }
    }
    return result;
  }, [portfolioSeries, chartPeriod, effectiveMode, benchmarkPortfolio]);

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
  const saveEdit = (updated) => {
    setPortfolios(portfolios.map(p => p.id === updated.id ? updated : p));
    setEditing(null);
  };
  const deletePortfolio = (id) => {
    if (!confirm('Delete this portfolio?')) return false;
    setPortfolios(portfolios.filter(p => p.id !== id));
    return true;
  };

  const handleRestore = (data) => {
    setPortfolios(data.portfolios);
    setPrices(data.prices);
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
    // Re-baseline the saved hash so Save isn't immediately dirty after reset.
    setDefaultDataHash(computeHash(def.portfolios));
  };

  const handleDragStart = (id) => setDraggedId(id);
  const handleDragOver = (e, id) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    if (id === draggedId) return;
    // Cursor in the top half → drop BEFORE this row; bottom half → AFTER.
    const rect = e.currentTarget.getBoundingClientRect();
    const pos = (e.clientY - rect.top) > rect.height / 2 ? 'after' : 'before';
    if (id !== dragOverId) setDragOverId(id);
    if (pos !== dragOverPos) setDragOverPos(pos);
  };
  const handleDrop = (e, targetId) => {
    e.preventDefault();
    const pos = dragOverPos;
    if (!draggedId || draggedId === targetId) {
      setDraggedId(null); setDragOverId(null); setDragOverPos(null); return;
    }
    const fromIdx = portfolios.findIndex(p => p.id === draggedId);
    const toIdx = portfolios.findIndex(p => p.id === targetId);
    if (fromIdx < 0 || toIdx < 0) return;
    const next = [...portfolios];
    const [moved] = next.splice(fromIdx, 1);
    // After splice, target shifts down by one if it was to the right of source.
    const adjustedTarget = fromIdx < toIdx ? toIdx - 1 : toIdx;
    const insertAt = pos === 'after' ? adjustedTarget + 1 : adjustedTarget;
    next.splice(insertAt, 0, moved);
    setPortfolios(next);
    setDraggedId(null); setDragOverId(null); setDragOverPos(null);
  };
  const handleDragEnd = () => { setDraggedId(null); setDragOverId(null); setDragOverPos(null); };

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

  // On wide screens the chart card is tall (h=560px), which makes the line spread look exaggerated.
  // We expand the Y-axis domain ~2× around the data midpoint so the lines occupy roughly the middle
  // half of the canvas vertically — calmer to read, while the vs-mode reference areas (green above,
  // red below the 100 baseline) now stretch to the canvas edges.
  // On <1200px screens we fall back to the original behaviour (auto-fit for absolute, computed for vs).
  const isWideViewport = useMediaQuery('(min-width: 1200px)');
  const chartYDomain = useMemo(() => {
    const baseDomain = effectiveMode === 'vs' ? vsVooDomain : ['auto', 'auto'];
    if (!isWideViewport) return baseDomain;
    if (!chartData.length) return baseDomain;
    let lo = Infinity, hi = -Infinity;
    if (typeof baseDomain[0] === 'number' && typeof baseDomain[1] === 'number') {
      [lo, hi] = baseDomain;
    } else {
      for (const row of chartData) {
        for (const k of Object.keys(row)) {
          if (k === 'date') continue;
          if (typeof row[k] === 'number') {
            if (row[k] < lo) lo = row[k];
            if (row[k] > hi) hi = row[k];
          }
        }
      }
      if (!isFinite(lo) || !isFinite(hi) || lo === hi) return baseDomain;
    }
    const mid = (lo + hi) / 2;
    const spread = (hi - lo) / 2;
    return [mid - spread * 2, mid + spread * 2];
  }, [isWideViewport, effectiveMode, vsVooDomain, chartData]);

  return (
    <div className="min-h-screen w-full" style={{
      background: darkMode
        ? 'linear-gradient(180deg, #0c0a09 0%, #1c1917 100%)'
        : 'linear-gradient(180deg, #faf7ee 0%, #f5f0e1 100%)',
      color: 'var(--text-primary)',
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
          <div className="border-b border-strong pb-1 mb-1">
            <div className="flex items-center justify-between">
              <div className="text-micro tracking-[0.3em] uppercase font-mono text-secondary">Portfolio Comparator · Vol. 1</div>
              <div className="hidden sm:block text-micro tracking-[0.2em] uppercase font-mono text-tertiary">
                {new Date().toLocaleDateString('en-US', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}
              </div>
            </div>
          </div>
          <div className="border-b-2 border-strong py-3">
            <div className="flex items-stretch justify-between flex-wrap gap-4">
              <div>
                {/* Hero stays on every breakpoint — only its size drops on mobile.
                    The subtitle (long date range + ticker count) is verbose for
                    narrow viewports, so it stays sm:block-only. */}
                {/* Below sm (≤640px): single-line "Performance, side by side." at 1.7rem.
                    sm+: keep the two-line stack with em on its own row. */}
                <h1 className="text-[1.7rem] sm:text-4xl md:text-5xl tracking-[-0.025em] font-serif leading-[0.95]" style={{ fontWeight: 400 }}>
                  Performance,{' '}
                  <br className="hidden sm:inline" />
                  <em style={{ color: 'var(--accent-brand)', fontWeight: 500 }}>side by side.</em>
                </h1>
                <div className="hidden sm:block text-body text-tertiary mt-3 font-mono tracking-tight">
                  {dateRangeText} · base = 100 · {totalLoaded}/{neededTickers.length} tickers loaded
                </div>
              </div>
              <div className="flex flex-col items-start min-[990px]:items-end justify-between gap-2">
                {/* UI scale controls — pin to TOP of the header column (A−/A+ above,
                    main action row at the bottom). justify-between on this column
                    + items-stretch on the parent does the distribution.

                    Alignment switches at the SAME viewport width where the parent
                    flex actually wraps (~990px — title + button block stop fitting
                    side-by-side). Above that, items-end pushes the buttons to the
                    right edge of the page, matching where justify-between lands
                    the block. Below that, the block has already wrapped below the
                    title and items-start aligns everything to the LEFT — matching
                    the title — instead of being half-right-aligned in a column
                    that no longer has a sibling. The breakpoint is NOT Tailwind's
                    md: (768px) — that would leave a 768–990px window where the
                    block is below the title yet still right-aligned. */}
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => setUiScale(s => Math.max(MIN_SCALE, +(s - STEP).toFixed(2)))}
                    disabled={uiScale <= MIN_SCALE + 1e-6}
                    className="flex items-center gap-2 px-3 py-2 text-body tracking-[0.15em] uppercase text-secondary hover-text-primary font-mono border border-strong hover-border-focus surface-card rounded disabled-mute"
                    title="Smaller UI text">
                    A−
                  </button>
                  <button
                    onClick={() => setUiScale(s => Math.min(MAX_SCALE, +(s + STEP).toFixed(2)))}
                    disabled={uiScale >= MAX_SCALE - 1e-6}
                    className="flex items-center gap-2 px-3 py-2 text-body tracking-[0.15em] uppercase text-secondary hover-text-primary font-mono border border-strong hover-border-focus surface-card rounded disabled-mute"
                    title="Bigger UI text">
                    A+
                  </button>
                </div>
                <div className="flex items-stretch gap-2 flex-wrap">
                  {/* View toggle — sits in the page header beside Save/Backup/Theme buttons,
                      so it mirrors their look (border + surface-card) rather than the soft
                      pill style used for tabs INSIDE cards. */}
                  <div className="flex items-center surface-card border border-strong rounded overflow-hidden">
                    {[{ id: 'portfolio', label: 'Portfolio' }, { id: 'investors', label: 'Investors' }, { id: 'etfs', label: 'ETFs' }].map(opt => {
                      const active = view === opt.id;
                      return (
                        <button key={opt.id} onClick={() => setView(opt.id)}
                          className={`px-3 py-2 text-body tracking-[0.15em] uppercase font-mono transition-colors ${
                            active ? 'surface-card-elevated text-primary' : 'text-secondary hover-text-primary'
                          }`}>
                          {opt.label}
                        </button>
                      );
                    })}
                  </div>
                  {hasUnsavedChanges && !saving && (
                    <button onClick={resetToDefaults}
                      className="flex items-center gap-2 px-3 py-2 text-body tracking-[0.15em] uppercase text-secondary hover-text-primary font-mono border border-strong hover-border-focus surface-card rounded"
                      title="Discard local changes and reload from default-data.json">
                      <RotateCcw size={11} /> Reset
                    </button>
                  )}
                  <button onClick={handleSaveDefault} disabled={!hasUnsavedChanges || saving}
                    className="flex items-center gap-2 px-3 py-2 text-body tracking-[0.15em] uppercase text-secondary hover-text-primary font-mono border border-strong hover-border-focus surface-card rounded disabled-mute"
                    title={hasUnsavedChanges ? 'Save current data as default (overwrites default-data.json)' : 'No changes to save'}>
                    {saving ? <Loader2 size={11} className="animate-spin" /> : <HardDriveDownload size={11} />}
                    {saving ? 'Saving…' : 'Save'}
                  </button>
                  <button onClick={() => setShowBackup(true)}
                    className="flex items-center gap-2 px-3 py-2 text-body tracking-[0.15em] uppercase text-secondary hover-text-primary font-mono border border-strong hover-border-focus surface-card rounded">
                    <Save size={11} /> Backup
                  </button>
                  <button onClick={() => { setDarkMode(!darkMode); setThemeManualOverride(true); }}
                    className="flex items-center justify-center w-9 h-9 text-secondary hover-text-primary border border-strong hover-border-focus surface-card rounded"
                    title={darkMode ? 'Switch to light mode' : 'Switch to dark mode'}>
                    {darkMode ? <Sun size={14} /> : <Moon size={14} />}
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>

        {view === 'investors' ? (
          <InvestorsMatrix
            investorsIndex={investorsIndex}
            portfolios={portfolios}
            prices={prices}
            latestQuarter={latestQuarter}
            onToggleVisibility={togglePortfolioVisibilityById}
            onEditInvestor={setEditing}
          />
        ) : view === 'etfs' ? (
          <ETFsMatrix
            etfsIndex={etfsIndex}
            portfolios={portfolios}
            prices={prices}
            latestQuarter={latestQuarter}
            onToggleVisibility={toggleEtfVisibilityById}
            onEditInvestor={setEditing}
          />
        ) : (
        <div className="grid grid-cols-1 min-[1200px]:grid-cols-[360px_1fr] min-[1200px]:items-stretch gap-6 items-start">
          {/* Chart — column 2 on wide screens, first on mobile (above the portfolios list). */}
          <div className="min-[1200px]:col-start-2 min-[1200px]:row-start-1 min-w-0">
            <div className="surface-card border border-subtle rounded-lg shadow-sm overflow-hidden h-full flex flex-col">
              <div className="px-5 py-3 border-b border-subtle surface-card-elevated flex items-center justify-between flex-wrap gap-3">
                <div className="flex items-center gap-3">
                  <div className="text-micro tracking-[0.2em] uppercase text-secondary font-mono">
                    {effectiveMode === 'vs' ? `vs ${benchmarkPortfolio?.name || 'benchmark'}` : 'Absolute return'}
                  </div>
                  <div className="flex items-center gap-0.5 surface-panel rounded p-0.5">
                    {PERIOD_OPTIONS.map(opt => (
                      <button key={opt.id} onClick={() => setChartPeriod(opt.id)}
                        className={`px-2.5 py-0.5 text-body tracking-[0.05em] uppercase font-mono rounded transition-all ${
                          chartPeriod === opt.id ? 'surface-card-elevated text-primary shadow-sm' : 'text-tertiary hover-text-primary'
                        }`}>
                        {opt.label}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="flex items-center gap-0.5 surface-panel rounded p-0.5">
                  <button onClick={() => setChartMode('absolute')}
                    className={`px-2.5 py-0.5 text-body tracking-[0.05em] uppercase font-mono rounded transition-all ${
                      effectiveMode === 'absolute' ? 'surface-card-elevated text-primary shadow-sm' : 'text-tertiary hover-text-primary'
                    }`}>Absolute</button>
                  {availableBenchmarks.map(b => (
                    <button key={b.id} onClick={() => setChartMode(b.id)}
                      className={`px-2.5 py-0.5 text-body tracking-[0.05em] uppercase font-mono rounded transition-all ${
                        chartMode === b.id ? 'surface-card-elevated text-primary shadow-sm' : 'text-tertiary hover-text-primary'
                      }`}>vs {b.name}</button>
                  ))}
                </div>
              </div>
              {legendPortfolios.length > 0 && (
                <div className="px-5 py-2.5 border-b border-subtle flex items-center gap-1.5 flex-wrap surface-card-elevated">
                  <button onClick={selectAllPortfolios}
                    className="text-micro tracking-[0.1em] uppercase font-mono text-tertiary hover-text-primary px-2 py-1 transition-colors">
                    All
                  </button>
                  <button onClick={deselectAllPortfolios}
                    className="text-micro tracking-[0.1em] uppercase font-mono text-tertiary hover-text-primary px-2 py-1 transition-colors">
                    None
                  </button>
                  <span className="text-muted mx-0.5 select-none">|</span>
                  {legendPortfolios.map(p => (
                    <button key={p.id} onClick={(e) => handleLegendClick(p.id, e)}
                      className={`flex items-center gap-1.5 text-body font-mono px-2 py-1 rounded transition-all ${
                        p.visible ? 'text-primary hover-surface' : 'text-muted line-through hover-surface'
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
              <div className="p-5 min-h-[280px] min-[500px]:min-h-[480px] min-[1200px]:min-h-[580px] flex-1 flex flex-col">
                {chartMode !== 'absolute' && !benchmarkPortfolio && (
                  <div className="mb-3 px-3 py-2 accent-tint-mild border border-accent-brand rounded text-micro font-mono text-accent-brand flex items-center gap-2">
                    <AlertCircle size={11} /> Selected benchmark has no price data — showing absolute mode.
                  </div>
                )}
                {chartData.length === 0 ? (
                  <div className="h-full flex items-center justify-center text-tertiary text-prom font-mono py-32 text-center">
                    <div>
                      <div className="mb-2">No data to chart yet.</div>
                      <div className="text-micro text-muted">Bundled price data is empty or failed to load.</div>
                    </div>
                  </div>
                ) : (
                  <div className="h-[260px] min-[500px]:h-[460px] min-[1200px]:h-[560px] min-[1200px]:flex-1">
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={chartData} margin={{ top: 20, right: 30, left: 10, bottom: 10 }}>
                      <CartesianGrid strokeDasharray="2 4" stroke={darkMode ? '#292524' : '#e6e0d3'} vertical={false} />
                      <XAxis dataKey="date" tickFormatter={formatDateShort} stroke={darkMode ? '#57534e' : '#a8a39a'} tick={{ fontSize: 10 }} minTickGap={50} />
                      <YAxis domain={chartYDomain} hide={true} />
                      {effectiveMode === 'vs' && (
                        <>
                          <ReferenceArea y1={100} y2={typeof chartYDomain[1] === 'number' ? chartYDomain[1] : vsVooDomain[1]} fill="var(--success-strong)" fillOpacity={0.06} />
                          <ReferenceArea y1={typeof chartYDomain[0] === 'number' ? chartYDomain[0] : vsVooDomain[0]} y2={100} fill="var(--danger-strong)" fillOpacity={0.06} />
                        </>
                      )}
                      <ReferenceLine y={100} stroke="var(--text-primary)" strokeDasharray="3 3" strokeOpacity={effectiveMode === 'vs' ? 0.5 : 0.3} />
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
                          strokeWidth={p.id === 'mine' ? 2.5 : 1.75} dot={false}
                          strokeDasharray={p.kind === 'benchmark' ? '8 3 1 3' : undefined}
                          activeDot={{ r: 4, strokeWidth: 0 }} isAnimationActive={false} />
                      ))}
                    </LineChart>
                  </ResponsiveContainer>
                  </div>
                )}
              </div>
            </div>

          </div>

          {/* Portfolios — column 1 on wide screens, second on mobile. Scrollable to chart's height. */}
          <div className="min-[1200px]:col-start-1 min-[1200px]:row-start-1 min-[1200px]:min-h-0">
            <div className="surface-card border border-subtle rounded-lg overflow-hidden shadow-sm h-full flex flex-col">
              <div className="px-5 py-3 border-b border-subtle surface-card-elevated flex items-center justify-between flex-shrink-0">
                <div className="text-micro tracking-[0.2em] uppercase text-secondary font-mono">
                  Portfolios · {investorPortfolios.length} <span className="text-muted normal-case tracking-normal">· drag to reorder</span>
                </div>
              </div>
              <div className="min-[1200px]:overflow-y-auto min-[1200px]:flex-1">
                {investorPortfolios.map((p, i) => (
                  <PortfolioRow key={p.id} portfolio={p}
                    pctReturn={displayPctByPortfolio[p.id]}
                    missingTickers={getMissingTickers(p)} coveragePct={getCoveragePct(p)}
                    disabledSet={disabledHoldings[p.id]}
                    onToggle={handleListToggle} onEdit={setEditing}
                    onDragStart={handleDragStart} onDragOver={handleDragOver}
                    onDrop={handleDrop} onDragEnd={handleDragEnd}
                    isDragging={draggedId === p.id} isDropTarget={dragOverId === p.id && draggedId !== p.id}
                    dropPosition={dragOverPos}
                    isLast={i === investorPortfolios.length - 1}
                    mergeMode={mergeMode} />
                ))}
                {investorPortfolios.length === 0 && (
                  <div className="px-4 py-6 text-center text-body font-mono text-tertiary">
                    No investor portfolios in the bundled data
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Consensus — spans both columns on wide screens, normal flow on mobile. */}
          <div className="min-[1200px]:col-span-2 min-[1200px]:row-start-2 min-w-0 space-y-4">
            {/* Narrow / mobile layout — single panel with mode tabs (Held / Bought / Sold). */}
            <div className="min-[1200px]:hidden">
              <ConsensusPanel portfolios={portfolios} disabledHoldings={disabledHoldings}
                onSetVisibility={setPortfolioVisibility} onIsolate={isolateInConsensus} onEdit={setEditing}
                prices={prices}
                mergeMode={mergeMode} setMergeMode={setMergeMode} />
            </div>
            {/* Wide layout — three panels side-by-side, one per mode. Pool lives once below. */}
            <div className="hidden min-[1200px]:grid grid-cols-3 gap-4 items-start">
              {['held', 'bought', 'sold'].map(mode => (
                <ConsensusPanel key={mode}
                  portfolios={portfolios} disabledHoldings={disabledHoldings}
                  onSetVisibility={setPortfolioVisibility} onIsolate={isolateInConsensus} onEdit={setEditing}
                  prices={prices}
                  mergeMode={mergeMode} setMergeMode={setMergeMode}
                  forcedViewMode={mode} hideMergeToggle hidePool />
              ))}
            </div>
            <div className="hidden min-[1200px]:block">
              <ConsensusPool portfolios={portfolios} onSetVisibility={setPortfolioVisibility} onIsolate={isolateInConsensus} />
            </div>
          </div>

        </div>
        )}

      </div>

      {editing && <PortfolioEditModal portfolio={editing} onSave={saveEdit} onClose={() => setEditing(null)}
        onDelete={(id) => { if (deletePortfolio(id)) setEditing(null); }}
        disabledSet={disabledHoldings[editing.id]} onToggleDisabled={toggleHoldingDisabled}
        prices={prices} vooPortfolio={portfolios.find(p => p.id === 'voo')} mergeMode={mergeMode} setMergeMode={setMergeMode}
        isFromBase={investorsIndex.some(i => i.id === editing.id)} />}
      {showBackup && <BackupModal onRestore={handleRestore} onClose={() => setShowBackup(false)} />}
    </div>
  );
}