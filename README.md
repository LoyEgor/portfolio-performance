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

Maintenance work (fetching DataRoma snapshots, refreshing prices, adding new
investors) lives in `goals/` — specification files driven by Claude Code's
built-in **`/goal`** command (Claude Code 2.1.139+, see
[docs](https://code.claude.com/docs/en/goal)). `/goal` keeps Claude iterating
across many turns until a verifiable completion condition holds.

| Task | Specification | Trigger |
|---|---|---|
| Quarterly refresh of investor holdings + history | `goals/INVESTORS-BACKFILL.md` | after each 13F deadline |
| Monthly price refresh | `goals/STOCKS-UPDATE.md` | monthly between refreshes |
| Add a single investor by name | `goals/INVESTORS-ADD.md` | on demand |
| Remove an investor (mechanical, no LLM) | `scripts/remove-investor.mjs <id>` | on demand |

All three goals run **interactively** — open a session, then type `/goal …`:

```bash
cd /Volumes/Work/Projects/portfolio-performance
claude --dangerously-skip-permissions
# then inside the session:
# /goal Follow goals/<FILE>.md … Done when …
```

Headless mode (`claude -p`) hides every tool call until the very end — a
multi-hour bootstrap looks like a frozen terminal. There's no speed benefit;
reserve `-p` for cron/automation. See `goals/README.md` for canonical commands
per scenario.

## Documentation map

- `CLAUDE.md` — conventions for Claude Code agents (chain-link updates,
  protected fields, theme tokens, dark mode patterns)
- `goals/README.md` — commands to run each goal, source priority, constraints
- `goals/*.md` — per-goal specifications

## Tech stack

React 18 · Vite · Tailwind CSS · recharts · lucide-react. No state management
library, no TypeScript, no tests. Single-file main component (`src/portfolio_tracker.jsx`).
