# Goal: Stocks Update

Refresh ticker prices so every ticker referenced by **any** investor in the
base (or by `myPortfolio`) is current through the latest fully-completed
calendar month.

This goal **only touches prices.** Holdings, history, and investor metadata are
out of scope (use `INVESTORS-BACKFILL.md` for those).

> **How this file is used.** This is a goal specification consumed by Claude
> Code's `/goal` command (introduced in Claude Code 2.1.139). The harness keeps
> looping turns until the **Done condition** at the bottom is satisfied — it
> reads the spec each turn and uses that section as the completion check, so
> you don't need to paste it into the command. Run it interactively: open
> `claude --dangerously-skip-permissions`, then type
> `/goal Follow goals/STOCKS-UPDATE.md.` inside the session. Avoid headless
> `claude -p` for hand-launched runs; it hides progress until the very end.
> See `goals/README.md` for the command catalog.

---

## Storage layout

Prices live in per-year files: `public/data/prices/<YYYY>.json`. Each file
holds `{ ticker: { "YYYY-MM-01": price, … } }` scoped to that year. The range
of years on disk is recorded in `meta.priceYears = { from, to }`.

For reads and verify: glob all year files and merge in memory. For writes:
bucket updates by year and write only the year files that actually changed.
When a write creates a new year file, bump `meta.priceYears.from`/`.to` to
match. The verify script enforces that `meta.priceYears` and the directory
stay in sync.

---

## When to run

Whenever the latest price keys lag behind the most-recently-completed month.

- Target last date = first-of-month of the prior calendar month relative to today.
  - On `2026-05-19` → target `2026-05-01`.
  - On `2026-06-03` → target `2026-06-01`.
- If any referenced ticker has `max(price_keys) < target` → there is work.

Typical cadence:
- **Monthly** (between quarterly refreshes), to keep prices fresh.
- **Immediately after `INVESTORS-BACKFILL.md`** finishes, to fill price gaps
  introduced by newly-discovered tickers.
- **After `INVESTORS-ADD.md`** if the new investor brought in tickers not yet
  covered.

---

## Hard constraints

- Mutate only `public/data/prices/*.json` and `public/data/meta.json`.
- Do NOT touch `public/data/investors/`, `public/data/investors-index.json`,
  `public/default-data.json`, `public/default-data.backup-*.json`, or any
  source file.
- Save a snapshot before first mutation:
  `tar -cf /tmp/prices.pre-stocks-update.tar public/data/prices/ public/data/meta.json`
- All price keys are strictly `YYYY-MM-01`. No off-day keys.
- A datapoint for year `Y` lives only in `prices/<Y>.json` — never split a
  ticker's `Y-MM-01` keys across files.
- `meta.priceYears` must match the year files on disk after the run.
- **Concurrency:** up to 3 ticker fetches in parallel **iff they target
  different domains** (e.g., one stockanalysis.com + one Yahoo + one Google).
  Same-domain requests stay serial with 1-2s pacing. The primary source
  (stockanalysis.com) handles most of the work, so realistic parallelism
  comes from interleaving fallback domains for stale-after-primary-failed
  tickers. See `goals/README.md → Concurrency`.
- No git commits, no PRs.

---

## Source ticker universe

The set of tickers to ensure coverage for is the **union** of:

1. Every `ticker` in every `investors/*.json` → `holdings` and `history[*].holdings`.
2. Every `ticker` in `public/data/etfs-index.json` → `etfs[].ticker`.
3. Every `ticker` in `public/default-data.json` → `myPortfolio.holdings`.

---

## What the goal does

1. **Pre-flight:** Read `meta.json` (`latestQuarter`, `priceYears`). Glob
   `prices/<Y>.json` for `Y ∈ [from..to]` and merge in memory into
   `priceMap[ticker][date]`. Note `min(keys)`/`max(keys)` per ticker. Compute
   target last date from "today". Compute the referenced-ticker set.

2. **Decide work.** `earliestAsOf = min(asOf across all investors' history)`.
   If no investor files exist, fall back to `today - 24 months`.
   - Tickers with no entry → fetch monthly from `earliestAsOf` to target.
   - Tickers stale (`max(keys) < target`) → fetch the missing months only.
   - Tickers with `min(keys) > earliestAsOf` → backfill the earlier months too
     (happens when a BACKFILL extended history beyond current price coverage).

3. **Fetch (paced).** Primary: `https://stockanalysis.com/stocks/<lower>/history/`
   (or `/etf/<lower>/history/` for ETFs). Fallback: Yahoo, Google, MarketWatch,
   Investing.com. Sleep 1–2s between requests to the same domain. Retry 3×
   with exponential backoff on 429/503. Adjusted Close only.

   **Crypto exception.** For tickers matching `-USD$` (e.g., `BTC-USD`,
   `ETH-USD`) OR tagged `crypto` in `etfs-index.json`: skip stockanalysis.com
   (no crypto coverage under `/stocks/` or `/etf/` paths) and go directly to:
   - **Yahoo Finance:** `https://finance.yahoo.com/quote/{ticker}/history?interval=1mo`
     — returns monthly closes since the asset existed (BTC-USD: 2014-09+).
   - **Fallback** if Yahoo fails: CoinGecko free API,
     `https://api.coingecko.com/api/v3/coins/{slug}/market_chart?vs_currency=usd&days=max&interval=daily`
     (slug = `bitcoin`, `ethereum`, etc.; pick monthly first-of-month closes
     from the daily series).
   These tickers are stored in `prices/<YYYY>.json` the same way as stocks
   (`"BTC-USD": { "2024-01-01": 42500, ... }`).

3.5 **Delisted-ticker fallback via Wayback Machine.** When all sources in
   step 3 return no data for a ticker, the ticker is likely **delisted,
   acquired, or renamed** (AET → CVS, AGN → ABBV, AGU → NTR, TWTR → private,
   AABA → liquidated, ADS → BFH, ABC → COR, etc.). These tickers still appear
   in historical 13F holdings and need historical prices, but no current API
   has them. Use Wayback Machine of the original primary source:

   ```
   For ticker T that failed step 3:
     1. List Wayback captures via CDX API:
        https://web.archive.org/cdx/search/cdx?url=stockanalysis.com/stocks/{lower}/history/&output=json&fl=timestamp,statuscode&filter=statuscode:200
     2. Pick a capture from MID-LIFE of the ticker (median between earliestAsOf
        of any holding referencing T and the last-traded date — typically a date
        when the page would have shown a long history table).
     3. Fetch https://web.archive.org/web/{TIMESTAMP}/https://stockanalysis.com/stocks/{lower}/history/
     4. Parse the historical-prices table the same way as live fetches.
     5. Extract Adjusted Close monthly closes covering the full required range.
     6. Write to prices/<Y>.json with note `recovered-from-archive` in goal log.
     7. If CDX returns no 200-status captures for that path → also try
        Yahoo Finance archived pages (web.archive.org of finance.yahoo.com/quote/{T}/history).
     8. Still nothing → log `delisted-no-archive` and skip.
   ```

   Polite pacing on web.archive.org: same 1-2s rule, since it's a separate
   domain. Concurrency: up to 3 archive fetches in parallel (different
   tickers, all going to web.archive.org host counts as same domain — so
   serialize within Wayback).

4. **Write by year.** Bucket all `(ticker, YYYY-MM-01, price)` triples by year.
   For each affected year, load `prices/<Y>.json` (or start with `{}` if new),
   merge in updates, sort tickers alphabetically and dates newest-first, write
   back. Don't rewrite years you didn't touch.
   - End-of-month source date (`2026-04-30`) → store as `2026-05-01`.
   - Mid-month source date → store as same-month-01.
   - Duplicate keys: existing value wins.

5. **Update `meta.json` (required).** Set `lastStocksUpdateAt` to the run's
   finish ISO timestamp. Set `priceYears` by reading the directory:
   `from = min(year)`, `to = max(year)` across `prices/<year>.json`. Leave
   other fields untouched.

6. **Verify** (script below).

---

## Verification script

Write to `/tmp/verify-stocks.py` (substitute today's ISO date into `__TODAY__`):

```python
#!/usr/bin/env python3
"""Strict verify for STOCKS-UPDATE.md goal."""
import json, sys, re, os, glob
from datetime import datetime, timedelta

PRICES_DIR = "public/data/prices"
SNAPSHOT = "/tmp/prices.pre-stocks-update.tar"
META = "public/data/meta.json"
INVESTORS_GLOB = "public/data/investors/*.json"
ETFS_INDEX = "public/data/etfs-index.json"
USER_CONFIG = "public/default-data.json"

def target_date():
    t = datetime.fromisoformat("__TODAY__")
    prev = t.replace(day=1) - timedelta(days=1)
    return f"{prev.year}-{prev.month:02d}-01"

TARGET = target_date()
errors = []
def E(m): errors.append(m)

if not os.path.exists(SNAPSHOT):
    print(f"FAIL: {SNAPSHOT} missing — goal didn't save a pre-run snapshot."); sys.exit(1)

year_files = sorted(glob.glob(f"{PRICES_DIR}/*.json"))
if not year_files: print(f"FAIL: no year files in {PRICES_DIR}/"); sys.exit(1)

years_on_disk, data = [], {}
for path in year_files:
    m = re.search(r"/(\d{4})\.json$", path)
    if not m: E(f"unexpected file in prices/: {path}"); continue
    y = int(m.group(1)); years_on_disk.append(y)
    with open(path) as f: blob = json.load(f)
    for ticker, dates in blob.items():
        if not isinstance(dates, dict): E(f"{path}: {ticker} not a date map"); continue
        for d in dates:
            if not d.startswith(f"{y}-"):
                E(f"{path}: {ticker} has cross-year key {d!r}")
        data.setdefault(ticker, {}).update(dates)
years_on_disk.sort()

with open(META) as f: meta = json.load(f)
py = meta.get("priceYears") or {}
if py.get("from") != years_on_disk[0] or py.get("to") != years_on_disk[-1]:
    E(f"meta.priceYears ({py}) doesn't match files on disk ({years_on_disk[0]}..{years_on_disk[-1]})")
# No gaps in the year range — the loader fetches every year in [from..to] and
# 404 on any of them is a hard error.
gaps = sorted(set(range(years_on_disk[0], years_on_disk[-1] + 1)) - set(years_on_disk))
if gaps:
    E(f"year-file gaps: missing {gaps} (range is {years_on_disk[0]}..{years_on_disk[-1]})")
if not meta.get("lastStocksUpdateAt"):
    E("meta.lastStocksUpdateAt missing")

referenced = set()
for path in glob.glob(INVESTORS_GLOB):
    with open(path) as f: inv = json.load(f)
    for h in (inv.get("holdings") or []): referenced.add(h["ticker"].upper())
    for s in (inv.get("history") or []):
        for h in s.get("holdings", []): referenced.add(h["ticker"].upper())
if os.path.exists(ETFS_INDEX):
    with open(ETFS_INDEX) as f: etfs = json.load(f)
    for e in (etfs.get("etfs") or []):
        if e.get("ticker"): referenced.add(e["ticker"].upper())
if os.path.exists(USER_CONFIG):
    with open(USER_CONFIG) as f: cfg = json.load(f)
    for h in (cfg.get("myPortfolio", {}).get("holdings") or []):
        referenced.add(h["ticker"].upper())

for t, px in data.items():
    bad = [k for k in px if not re.match(r"^\d{4}-\d{2}-01$", k)]
    if bad: E(f"price-key: {t} has non-monthly keys: {bad[:3]}")
    for k, v in px.items():
        if v is None or v <= 0 or v != v: E(f"price-bad: {t}/{k} = {v}")

for t in sorted(referenced):
    if t not in data: E(f"price: missing for referenced ticker {t}"); continue
    last = max(data[t].keys()) if data[t] else None
    if not last or last < TARGET: E(f"price-stale: {t} latest is {last}, target {TARGET}")

for t, px in data.items():
    dates = sorted(px.keys())
    for i in range(1, len(dates)):
        prev, curr = px[dates[i-1]], px[dates[i]]
        if prev <= 0: continue
        r = curr / prev
        if r > 1.5 or r < 0.67:
            E(f"price-jump: {t} {dates[i-1]}={prev} → {dates[i]}={curr} ({r:.2f}×)")

if "BRK.A" in data:
    for k, v in data["BRK.A"].items():
        if v < 100000: E(f"price-sanity: BRK.A {k}={v} looks like Class B")

if errors:
    print(f"FAIL: {len(errors)} errors")
    for e in errors[:50]: print(" -", e)
    if len(errors) > 50: print(f"  ... +{len(errors)-50} more")
    sys.exit(1)
print(f"OK: {len(referenced)} tickers up to date through {TARGET}, years {years_on_disk[0]}..{years_on_disk[-1]}")
```

---

## Done condition

1. `python3 /tmp/verify-stocks.py` exits 0 with `OK: …`. Checks: year-files
   scoped to their year, `meta.priceYears` matches the directory,
   `lastStocksUpdateAt` set, all keys `YYYY-MM-01`, all prices positive, every
   referenced ticker reaches target, no absurd MoM jumps, BRK.A in Class-A range.
2. `git diff --stat` shows mutations only in `public/data/prices/` and
   `public/data/meta.json`.
3. `/tmp/stocks-update-log.txt` printed: `(N tickers updated, M new tickers
   added, K failed, Y year-files written)`.
