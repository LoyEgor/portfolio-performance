# Portfolio Comparator — Handoff Doc

A React app for comparing investor portfolios (yours, famous investors from 13F filings, bloggers, etc.)
against benchmarks (VOO, VT) and computing consensus analytics across them.

---

## Note for the LLM reading this

- **End user is Russian-speaking** — respond in Russian unless asked otherwise.
- This component was originally built as a **Claude Artifact** (sandboxed in-browser environment).
- It depends on `window.storage` (an Anthropic-internal key-value API). For local use, a
  `localStorage`-backed adapter is provided in `src/storage-adapter.js` — **do not skip it**, the app
  will silently fail to persist anything if `window.storage` is missing.
- The `portfolio_tracker.jsx` file is provided **separately** by the user. Place it in `src/`.
- The user has a backup JSON (e.g. `portfolio-comparator-2026-04-25.json`). Import via the in-app
  Backup → Restore flow, not by editing files.

---

## What this app does

- Track an arbitrary number of **investor portfolios** (each = list of tickers with weights summing to ~100%)
- Track **benchmark portfolios** (VOO = S&P 500, VT = world equity) for comparison
- Import per-ticker historical prices via a flexible paste parser (text, OCR, or CSV from sites like
  stockanalysis.com / Yahoo Finance)
- Render performance over time with portfolio lines normalized so start of period = 100
- Switch between **Absolute return** and **vs benchmark** chart modes (vs VOO, vs VT, etc.)
- Period selectors: 3M / 6M / YTD / 1Y / ALL (auto re-normalize to start of period)
- **Consensus picks** analytics: which tickers do multiple investors collectively believe in?
- **High-conviction picks**: tickers held by few investors but with large weight (non-consensus, high-conviction signals)
- **Merge dual-class shares**: GOOG/GOOGL, BRK.A/BRK.B, BF.A/BF.B treated as same company
- Backup/restore via JSON file
- Drag-and-drop portfolio reordering
- Ctrl/Cmd/Shift+click on any portfolio chip to **isolate** (show only that one)

---

## Quick start

```bash
mkdir portfolio-comparator && cd portfolio-comparator
# Drop in all the files from this handoff package
npm install
npm run dev
```

Opens at `http://localhost:5173`. First load shows default portfolios. Use Backup → Restore to load
the user's JSON.

---

## File structure

```
portfolio-comparator/
├── README.md                       (this file)
├── package.json
├── vite.config.js
├── tailwind.config.js
├── postcss.config.js
├── index.html
└── src/
    ├── main.jsx                    entry point — installs storage adapter, mounts app
    ├── storage-adapter.js          localStorage shim for window.storage
    ├── index.css                   Tailwind directives only
    └── portfolio_tracker.jsx       (user provides — main component, ~1700 lines)
```

---

## The `window.storage` shim — why it exists

The component uses `window.storage` with this API:

```js
window.storage.get(key)    // → Promise<{value: string} | null>
window.storage.set(key, value)  // → Promise<void>
window.storage.delete(key) // → Promise<void>
window.storage.list(prefix) // → Promise<{keys: string[]} | null>
```

In the artifact runtime this is provided by Anthropic. In normal browsers it doesn't exist. The
adapter in `src/storage-adapter.js` implements the same contract on top of `localStorage`. It must
be imported **before** `portfolio_tracker.jsx`, which `src/main.jsx` does.

**Do NOT modify the storage layer inside `portfolio_tracker.jsx`.** It already uses the
optimal single-key design (V8) — one key for portfolios, one key for all prices. Earlier versions
(v5/v6/v7) used per-ticker keys which made restore take ~1 minute for 50 tickers; the migration
function inside the component handles old layouts if they exist.

---

## Data model

### Portfolio

```ts
{
  id: string,                 // unique, e.g. 'mine', 'buffett', 'custom-1234567890'
  name: string,               // 'My Portfolio', 'Buffett 13F', etc.
  subtitle: string,           // free-form description
  kind: 'mine' | 'benchmark' | 'custom',
  color: string,              // '#1a1815' or any hex
  visible: boolean,           // shown on chart?
  locked: boolean,            // (currently unused — reserved for protected entries)
  holdings: Array<{ ticker: string, weight: number }>  // weights sum to ~100
}
```

### Prices

```ts
{
  [TICKER: string]: {
    [DATE_YYYY_MM_DD: string]: number  // closing price
  }
}
```

### Backup file

```json
{
  "version": "v8",
  "exportedAt": "2026-04-25T18:40:05.953Z",
  "portfolios": [...Portfolio],
  "prices": {...Prices}
}
```

The lenient parser inside `BackupModal` accepts older formats too (v5/v6/v7 wrapped prices, partial
data, missing fields). Anything malformed gets skipped with a count shown in the import preview.

---

## Architectural decisions

### Investor portfolios vs benchmark portfolios

The `kind` field separates two concepts:

- **Investor portfolios** (`kind !== 'benchmark'`) — real capital allocations. Appear in the
  Portfolios card, the Consensus pool, the High-conviction analysis, and always on the chart.
- **Benchmark portfolios** (`kind === 'benchmark'`) — comparison instruments only. Appear on chart
  in Absolute mode, as `vs X` mode buttons, and in Data Manager. **Not** in Portfolios list,
  Consensus, or High-conviction. In `vs X` mode, no benchmark lines are drawn (silly to plot
  baseline against itself).

Crucially: a ticker like `VOO` can be both. The portfolio "VOO" (kind=benchmark) is one thing;
a holding `{ticker: 'VOO', weight: 5}` inside a non-benchmark portfolio is another. The latter
contributes to consensus normally.

### Storage versioning

`STORAGE_VERSION = 'v8'`. The migration function `migrateToV8()` reads from older versions
(v5/v6/v7) and consolidates per-ticker keys into the single `prices:v8` key. For a fresh local
install nothing to migrate — user just imports their backup.

### No automatic price fetching

Originally tried but abandoned. CORS blocks most public price APIs from browser code. Yahoo Finance
unofficial endpoints work sometimes but are unreliable. Paid APIs (Alpha Vantage, Polygon, etc.)
require a key + sign-up. Decision: **bring-your-own-data** via paste parser. The `ImportModal`
parses text from stockanalysis.com history pages or Yahoo Finance CSV exports. If you want to add
automatic fetching, you'd need a small server-side proxy.

### Merge dual-class shares

`TICKER_ALIASES = { 'GOOG': 'GOOGL' }` plus a regex that strips `.A`/`.B` suffixes (BRK.A → BRK).
When the merge checkbox is on, normalized ticker is used in consensus aggregation. The `merged`
field on each consensus entry is true if either (a) multiple originals were combined, or (b) a
single ticker was renamed (e.g., BRK.B → BRK with no plain BRK present).

---

## UI behavior cheatsheet

| Action | Where | Effect |
|---|---|---|
| Click colored dot/chip | Portfolios list, chart legend, consensus pool | Toggle visibility (or inclusion in consensus pool) |
| Ctrl/Cmd/Shift+click | Same three places | Isolate (show only this) ↔ restore all |
| Drag a row | Portfolios list | Reorder (changes chart line draw order) |
| Click `merged N` indicator | Consensus header | Popup with details: which originals → which displayed ticker |
| Click hidden chip in pool | Consensus pool footer | Bring portfolio back (visibility on + included) |
| Period buttons `3M / 6M / YTD / 1Y / ALL` | Chart header | Filter chart range, re-normalize start to 100 |
| `[Absolute] / [vs X]` buttons | Chart header | Switch comparison mode; vs buttons appear per-benchmark |

---

## Known limitations

1. **Drag-and-drop on mobile** — uses native HTML5 DnD which Safari iOS doesn't support well.
   To fix: add a touch DnD library like `dnd-kit/core` or `react-dnd-touch-backend`.
2. **No automatic price updates** — user must paste new prices manually each month. See
   "automatic fetching" above for the path forward.
3. **localStorage 5–10MB limit** — fine for ~200 tickers × 60 months. Beyond that, switch the
   adapter to IndexedDB.
4. **No multi-device sync** — pure local. Sync would need a backend or Dropbox/Drive integration.
5. **No tax/cost basis tracking** — pure performance comparison, not a portfolio accounting tool.

---

## Possible enhancements (user has expressed mild interest)

- **Sector breakdown** — group holdings by sector (needs sector mapping table or API)
- **Concentration metrics** — top-3 / top-5 / top-10 weight per portfolio
- **Overlap matrix** — pairwise % overlap between portfolios
- **Your gap** — show what gurus hold that user doesn't
- **More benchmarks** — currently only kind === 'benchmark' shows in vs-mode buttons; user can add
  any portfolio as a benchmark by editing the data
- **Drag-and-drop on mobile** — touch backend
- **CSV export** — for tax software etc.

---

## Tech stack

- React 18
- Vite (dev server + build)
- Tailwind CSS (utility classes only — no custom theme)
- recharts (line chart)
- lucide-react (icons)
- Google Fonts loaded inside the component (Fraunces serif, Geist sans, JetBrains Mono)

No state management library. No TypeScript. No tests (yet). Single file ~1700 lines for the entire
component — the user prefers this over folder-of-tiny-files.

---

## Code walkthrough (top to bottom of `portfolio_tracker.jsx`)

1. **Imports + constants** — `DEFAULT_PORTFOLIOS`, `PALETTE`, `TICKER_BLACKLIST`, `TICKER_ALIASES`
2. **Parsers** — `parsePriceInput`, `tryParseCSV`, `parsePortfolioInput` — all flexible/lenient
3. **Storage layer** — V8 single-key approach + migration from older versions
4. **Computation** — `computeSeries` builds normalized time series per portfolio
5. **Components**:
   - `PortfolioRow` — drag-enabled row with toggle/edit/delete
   - `PortfolioEditModal` — edit holdings + smart paste from text/OCR
   - `ImportModal` — price import with parser preview
   - `BackupModal` — backup/restore with progress UI
   - `DataManager` — right-side panel showing per-ticker data status
   - `ConsensusPanel` — aggregated analytics + merged ticker popup + High-conviction sub-section
6. **Main `PortfolioTracker`** — wires everything, handles drag, ctrl-isolate, period filtering,
   chart mode, etc.

---

## Conversation context (very brief)

This was iterated through multiple versions (V1 → V8.x) over a long session. Key milestones the
LLM should be aware of:

- V5 → V8: storage layer redesigned to single-key after user complained about minute-long restore
- V6: drag-and-drop, consensus panel, vs VOO mode, period selectors all added
- V7: lenient backup restore with progress UI
- V8: removed benchmark portfolios from non-chart contexts (cleaner separation)
- Latest: Ctrl/Cmd/Shift+click isolation works in chart legend, portfolios list, and consensus pool

User prefers: pragmatic solutions over clever ones; honest about tradeoffs; doesn't want
over-engineering. Russian voice-to-text input means messages can be a bit garbled — interpret
charitably and ask if truly ambiguous.
