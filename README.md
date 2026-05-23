# Portfolio Performance

A React app for comparing investor portfolios (yours, famous investors from
DataRoma 13F filings, YouTube bloggers, etc.) against benchmarks (VOO, VT)
and computing consensus analytics across them.

Personal tool — not packaged for public use.

## Quick start

```bash
npm install
npm run dev
```

Opens at `http://localhost:5173`. Data is bundled — see "Architecture" below.

## Architecture (two-layer data)

**Read-only base** (`public/data/`) — maintained by goals, never written from UI:
- `investors-index.json` — catalog of investors (name, AUM, source, history range)
- `investors/<id>.json` — per-investor holdings + history per quarter
- `prices.json` — all ticker prices (monthly, first-of-month keys)
- `meta.json` — `latestQuarter`, `activityWindowQuarters`, run timestamps

**User config layer** (`public/default-data.json`, v9) — written by Save button:
- `benchmarks` (VOO, VT)
- `myPortfolio` (your portfolio, equities-only)
- `tarasGuk` (or any blogger / non-DataRoma source)
- `selectedInvestors[]` — which investors from the base appear in your portfolio view
- `investorCustomization{}` — color / visibility / locked per investor

No localStorage. App fetches everything from these JSON files on mount.

## Working with the project

| Goal | File |
|---|---|
| Quarterly refresh of investor holdings + history | `goals/INVESTORS-BACKFILL.md` |
| Monthly price refresh | `goals/STOCKS-UPDATE.md` |
| Add a single investor by name | `goals/INVESTORS-ADD.md` |
| Remove an investor | `scripts/remove-investor.mjs <id>` |

See `goals/README.md` for the launch commands. All goals run as autonomous
Claude Code sessions with `--dangerously-skip-permissions`.

## Documentation map

- `CLAUDE.md` — conventions for Claude Code agents (chain-link updates,
  protected fields, theme tokens, dark mode patterns)
- `goals/README.md` — commands to run each goal, source priority, constraints
- `goals/*.md` — per-goal specifications

## Tech stack

React 18 · Vite · Tailwind CSS · recharts · lucide-react. No state management
library, no TypeScript, no tests. Single-file main component (`src/portfolio_tracker.jsx`).
