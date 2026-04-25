# Portfolio Comparator

A React app for comparing investor portfolios (yours, famous investors from 13F filings, bloggers, etc.)
against benchmarks (VOO, VT) and computing consensus analytics across them.

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
- **Data audit**: heatmap grid (tickers × months) for spotting gaps, mismatched ranges, and import errors
- **Save to disk**: persist current data back to `public/default-data.json` with automatic backup rotation (up to 3)
- Backup/restore via JSON file
- Drag-and-drop portfolio reordering
- Ctrl/Cmd/Shift+click on any portfolio chip to **isolate** (show only that one)

---

## Quick start

```bash
npm install
npm run dev
```

Opens at `http://localhost:5173`. If `public/default-data.json` exists and localStorage is empty,
data is auto-imported on first load.

---

## File structure

```
portfolio-comparator/
├── README.md
├── SETUP.md
├── package.json
├── vite.config.js                  dev server + save-default-data plugin
├── tailwind.config.js
├── postcss.config.js
├── index.html
├── public/
│   ├── default-data.json           auto-loaded on first run
│   └── default-data.backup-*.json  rotated backups (up to 3)
└── src/
    ├── main.jsx                    entry point — storage adapter + bootstrap
    ├── storage-adapter.js          localStorage shim for window.storage
    ├── index.css                   Tailwind directives
    └── portfolio_tracker.jsx       main component (~2000 lines)
```

---

## The `window.storage` shim

The component uses `window.storage` — an API from the Claude Artifact sandbox where this component
was originally built. In normal browsers it doesn't exist. The adapter in `src/storage-adapter.js`
implements the same contract on top of `localStorage`:

```js
window.storage.get(key)         // → Promise<{value: string} | null>
window.storage.set(key, value)  // → Promise<void>
window.storage.delete(key)      // → Promise<void>
window.storage.list(prefix)     // → Promise<{keys: string[]} | null>
```

It must be imported **before** `portfolio_tracker.jsx`, which `src/main.jsx` handles.

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

### Backup / default-data.json

```json
{
  "version": "v8",
  "exportedAt": "2026-04-25T18:40:05.953Z",
  "portfolios": [...],
  "prices": {...}
}
```

The lenient parser accepts older formats too (v5/v6/v7 wrapped prices, partial data, missing fields).

---

## Saving data

Data lives in `localStorage` and auto-saves on every change. Two mechanisms exist for file-level persistence:

- **Save button** — writes current data to `public/default-data.json` via a Vite dev server plugin
  (`POST /api/save-default`). Previous versions are rotated into `backup-1`, `backup-2`, `backup-3`
  (max 3). The button is disabled when data matches the saved file.
- **Backup button** — exports/imports JSON files via browser download/upload (works anywhere, not
  just dev server).

On first load with empty localStorage, `src/main.jsx` auto-imports `public/default-data.json`.

---

## Architectural decisions

### Investor portfolios vs benchmark portfolios

The `kind` field separates two concepts:

- **Investor portfolios** (`kind !== 'benchmark'`) — real capital allocations. Appear in the
  Portfolios card, the Consensus pool, the High-conviction analysis, and always on the chart.
- **Benchmark portfolios** (`kind === 'benchmark'`) — comparison instruments only. Appear on chart
  in Absolute mode, as `vs X` mode buttons, and in Data Manager. **Not** in Portfolios list,
  Consensus, or High-conviction.

### No automatic price fetching

CORS blocks most public price APIs from browser code. Decision: **bring-your-own-data** via paste
parser. The `ImportModal` parses text from stockanalysis.com history pages or Yahoo Finance CSV
exports. Automatic fetching would need a server-side proxy.

### Merge dual-class shares

`TICKER_ALIASES = { 'GOOG': 'GOOGL' }` plus a regex that strips `.A`/`.B` suffixes (BRK.A → BRK).
When the merge checkbox is on, normalized ticker is used in consensus aggregation.

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
| Audit icon (⊞) | Data Manager header | Open heatmap grid for data validation |

---

## Known limitations

1. **Drag-and-drop on mobile** — uses native HTML5 DnD which Safari iOS doesn't support well.
2. **No automatic price updates** — user must paste new prices manually each month.
3. **localStorage 5–10MB limit** — fine for ~200 tickers × 60 months. Beyond that, switch the
   adapter to IndexedDB.
4. **No multi-device sync** — pure local.
5. **Save button requires dev server** — the `POST /api/save-default` endpoint only exists in
   Vite dev mode. In production builds, use Backup for persistence.

---

## Tech stack

- React 18
- Vite (dev server + build)
- Tailwind CSS (utility classes only — no custom theme)
- recharts (line chart)
- lucide-react (icons)
- Google Fonts (Fraunces serif, Geist sans, JetBrains Mono)

No state management library. No TypeScript. No tests. Single file component.

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
   - `DataAuditModal` — heatmap grid (tickers × months) for data validation
   - `DataManager` — right-side panel showing per-ticker data status
   - `ConsensusPanel` — aggregated analytics + merged ticker popup + High-conviction sub-section
6. **Main `PortfolioTracker`** — wires everything, handles drag, ctrl-isolate, period filtering,
   chart mode, save-to-default, etc.
