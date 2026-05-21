# Goals

Autonomous Claude Code goals that maintain the investor database and price data.

All goals are **read/write to `public/data/*`** (the read-only-from-UI investor
database) or to `public/default-data.json` (the user-config layer — only via
the app's Save button under normal flow, but goals may touch it for cleanup).

## Architecture recap

- **Read-only investor base** — `public/data/*` — maintained by goals only.
  - `investors-index.json` — 80-investor catalog (id, name, AUM, link, tags, history range)
  - `investors/<id>.json` — per-investor holdings + history
  - `prices.json` — all ticker prices
  - `meta.json` — global `latestQuarter` and last-fetched timestamp
- **User config** — `public/default-data.json` — `selectedInvestors[]`, color/visibility
  customization, myPortfolio. Goals NEVER write here (except `scripts/remove-investor.mjs`
  which prunes deleted investor IDs from the selection).
- **App source code** — `src/portfolio_tracker.jsx`, `src/main.jsx`, etc. Goals NEVER touch.

## Goals

| File | Trigger | Purpose |
|---|---|---|
| `STOCKS-UPDATE.md` | Monthly | Refresh `prices.json` to cover the latest completed month for every referenced ticker. |
| `INVESTORS-BACKFILL.md` | Quarterly (no params) / on demand (`--years=N`) | Refresh investor holdings + history. Without parameters → catches everyone up to the latest quarter on DataRoma (this is the "quarterly update" use case). With `--years=N` → fetches up to N years back per investor. Idempotent: only fetches what's missing unless `--force`. |
| `INVESTORS-ADD.md` | On demand | Add a single investor by name. Searches sources by priority, picks the most popular match, fetches history up to `meta.latestQuarter` (not beyond — keeps the base aligned). |

## Source priority

When fetching investor data, try in this order. Stop at the first source that
returns valid data.

1. [Dataroma](https://www.dataroma.com/)
2. [13F.info](https://13f.info/)
3. [stockzoa.com](https://stockzoa.com/)
4. [valuesider.com](https://valuesider.com/)
5. [GuruFocus](https://www.gurufocus.com/)
6. [WhaleWisdom](https://whalewisdom.com/)
7. [HedgeFollow](https://hedgefollow.com/)
8. [StockCircle](https://stockcircle.com/)

Record the chosen source in `investors-index.json[id].primarySource` so
subsequent updates use the same one (stability over re-discovery).

## Global hard constraints (apply to every goal)

- **NEVER** edit:
  - `src/*`, `vite.config.js`, `package.json`, `tailwind.config.js`, `index.html`
  - `public/default-data.backup-*.json` (app-managed snapshots)
- **NEVER** push to remote, **NEVER** open PRs, **NEVER** create commits without explicit user permission.
- Always write a `/tmp/<goal-name>.pre-run.tar` snapshot of `public/data/` before the first mutation, so failed runs can be inspected/rolled back.
- Use polite pacing for outbound HTTP (1-2s between requests to the same domain) to avoid rate-limits.
- Retry with exponential backoff on 429/503 (3 tries max). Skip with logged warning on persistent failure.

## Running

All goals run with `--dangerously-skip-permissions` (autonomous, no interactive prompts).
This is REQUIRED for headless execution; without it, every WebFetch / npm / file write
would block waiting for a permission prompt.

### Stocks update (monthly, between quarterly refreshes)

```bash
cd /Volumes/Work/Projects/portfolio-performance
claude --dangerously-skip-permissions --print \
  "Read goals/STOCKS-UPDATE.md and execute to done condition. Today is $(date -I)."
```

### Investors backfill — incremental quarterly update (every ~3 months)

Run after the 13F deadlines: **May 15 / Aug 14 / Nov 14 / Feb 14**.

```bash
claude --dangerously-skip-permissions --print \
  "Read goals/INVESTORS-BACKFILL.md and execute to done condition. Today is $(date -I)."
```

### Investors backfill — extend history backward

```bash
# Last year only (fast, for testing)
claude --dangerously-skip-permissions --print \
  "Read goals/INVESTORS-BACKFILL.md. Params: --years=1. Execute to done condition."

# Full history available on DataRoma (~5 years)
claude --dangerously-skip-permissions --print \
  "Read goals/INVESTORS-BACKFILL.md. Params: --years=max. Execute."

# Single investor, re-fetch
claude --dangerously-skip-permissions --print \
  "Read goals/INVESTORS-BACKFILL.md. Params: --investors=buffett --force --years=max. Execute."
```

### Add a new investor

```bash
# By name (picks most popular match automatically)
claude --dangerously-skip-permissions --print \
  "Read goals/INVESTORS-ADD.md. Params: --name='Bill Ackman'. Execute."

# With a source hint (when the popular default isn't who you want)
claude --dangerously-skip-permissions --print \
  "Read goals/INVESTORS-ADD.md. Params: --name='Bill Ackman' --source-hint=stockzoa/pershing-square. Execute."
```

### Remove an investor

Not a goal — a plain Node script (deletion is mechanical, doesn't need an LLM).

```bash
node scripts/remove-investor.mjs <investor-id>
# Example:
node scripts/remove-investor.mjs ackman
```

The script removes the investor's file, prunes the index entry, and cleans up
any references in `public/default-data.json` (selectedInvestors, customization).
Prices stay in `prices.json` — they may be referenced by other investors and
re-removing them is a separate concern (run STOCKS-UPDATE to GC orphaned tickers
if you care).

## Typical workflows

**Quarterly cycle (every 3 months after 13F deadline):**

```bash
# 1. Refresh all 80 investors' Q-N holdings
claude --dangerously-skip-permissions --print \
  "Read goals/INVESTORS-BACKFILL.md and execute. Today: $(date -I)."

# 2. Fill price gaps (new tickers from new holdings)
claude --dangerously-skip-permissions --print \
  "Read goals/STOCKS-UPDATE.md and execute. Today: $(date -I)."
```

**Monthly cycle (between quarterly refreshes):**

```bash
claude --dangerously-skip-permissions --print \
  "Read goals/STOCKS-UPDATE.md and execute. Today: $(date -I)."
```

**Adding a brand-new investor:**

```bash
# 1. Add them
claude --dangerously-skip-permissions --print \
  "Read goals/INVESTORS-ADD.md. Params: --name='<NAME>'. Execute."

# 2. Their tickers may not be in prices.json yet
claude --dangerously-skip-permissions --print \
  "Read goals/STOCKS-UPDATE.md and execute. Today: $(date -I)."
```

## Logging

Each goal writes a structured log to `/tmp/<goal-name>-log.txt` with:
- start/end timestamps
- per-investor / per-ticker status (OK / SKIPPED / FAILED with reason)
- total network requests, runtime, bytes downloaded
- list of items needing user attention (e.g. >5pp diff on add-investor)

After every run, print the log path so the user can inspect.
