# Goal: Stocks Update

Refresh `public/data/prices.json` so every ticker referenced by **any** investor
in the base (or by `myPortfolio`) is current through the latest fully-completed
calendar month.

This goal **only touches prices.** Holdings, history, and investor metadata are
out of scope (use `INVESTORS-BACKFILL.md` for those).

> **How this file is used.** This is a goal specification consumed by Claude
> Code's `/goal` command (introduced in Claude Code 2.1.139). The harness keeps
> looping turns until the **Done condition** at the bottom is satisfied. Don't
> run this file with plain `claude -p` (single turn) — it won't iterate. See
> `goals/README.md` for the full `/goal` invocation form.

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

- Mutate only `public/data/prices.json` and `public/data/meta.json`.
- Do NOT touch `public/data/investors/`, `public/data/investors-index.json`,
  `public/default-data.json`, `public/default-data.backup-*.json`, or any
  source file.
- Save a snapshot before first mutation:
  `cp public/data/prices.json /tmp/prices.pre-stocks-update.json`
  Verify reads this on completion to detect forbidden mutations.
- All price keys are strictly `YYYY-MM-01`. No off-day keys.
- No git commits, no PRs.

---

## Source ticker universe

The set of tickers to ensure coverage for is the **union** of:

1. Every `ticker` in every `investors/*.json` → `holdings` and `history[*].holdings`.
2. Every `ticker` in `public/default-data.json` → `myPortfolio.holdings`
   (the user's own portfolio).

Note: this is **broader** than the old `STOCKS-UPDATE.md` (which only looked at
the legacy `default-data.json portfolios[]`). The new base may have 800+ unique
tickers vs. the old ~143.

---

## What the goal does (step by step)

1. **Pre-flight:**
   - Read `public/data/meta.json` for `latestQuarter` (purely informational).
   - Compute target last date from "today".
   - Compute referenced-ticker set (union as above).
   - Read existing `prices.json`; for each referenced ticker note its current
     `max(keys)`.

2. **Decide work:**
   - Tickers with no entry in `prices.json` → fetch from scratch, default range
     last 18 months (or longer if `meta.latestQuarter` implies we have older
     holdings — fetch enough history to cover all quarters in any
     `investors/*.json`).
   - Tickers with stale entry (max < target) → fetch only the missing months.

3. **Fetch (paced):**
   - Primary: `https://stockanalysis.com/stocks/<lower>/history/` (or
     `/etf/<lower>/history/` for ETFs).
   - Fallback: Yahoo Finance, Google Finance, MarketWatch, Investing.com.
   - Sleep 1-2s between requests to the same domain.
   - Retry 3× with exponential backoff on 429/503.
   - Adjusted Close only (split/dividend-aware).

4. **Write:**
   - Append missing `YYYY-MM-01` keys for each ticker.
   - If source gives end-of-month (e.g. `2026-04-30`) → store as `2026-05-01`.
   - If source gives mid-month → store as same-month-01 (typical for the very
     last month in progress).
   - Drop duplicate keys: first trading day of the month wins.

5. **Verify** (see below).

6. **Update `meta.json`:** bump `lastStocksUpdate` timestamp and add a line to
   the log.

---

## Verification script

Write to `/tmp/verify-stocks.py` (Python — substitute today's ISO date in the
`__TODAY__` placeholder before running):

```python
#!/usr/bin/env python3
"""Strict verify for STOCKS-UPDATE.md goal."""
import json, sys, re, os, glob
from datetime import datetime, timedelta

PRICES = "public/data/prices.json"
SNAPSHOT = "/tmp/prices.pre-stocks-update.json"
INVESTORS_GLOB = "public/data/investors/*.json"
USER_CONFIG = "public/default-data.json"

def target_date():
    t = datetime.fromisoformat("__TODAY__")
    first_of_this_month = t.replace(day=1)
    prev = first_of_this_month - timedelta(days=1)
    return f"{prev.year}-{prev.month:02d}-01"

TARGET = target_date()
errors = []
def E(m): errors.append(m)

# Snapshot must exist
if not os.path.exists(SNAPSHOT):
    print(f"FAIL: {SNAPSHOT} missing — goal didn't save a pre-run snapshot.")
    sys.exit(1)

with open(PRICES) as f: data = json.load(f)
with open(SNAPSHOT) as f: snap = json.load(f)

# Referenced tickers = union of all investor holdings + user portfolio
referenced = set()
for path in glob.glob(INVESTORS_GLOB):
    with open(path) as f: inv = json.load(f)
    for h in (inv.get("holdings") or []): referenced.add(h["ticker"].upper())
    for s in (inv.get("history") or []):
        for h in s.get("holdings", []): referenced.add(h["ticker"].upper())

if os.path.exists(USER_CONFIG):
    with open(USER_CONFIG) as f: cfg = json.load(f)
    for h in (cfg.get("myPortfolio", {}).get("holdings") or []):
        referenced.add(h["ticker"].upper())

# All keys must be YYYY-MM-01 and positive
for t, px in data.items():
    bad = [k for k in px if not re.match(r"^\d{4}-\d{2}-01$", k)]
    if bad: E(f"price-key: {t} has non-monthly keys: {bad[:3]}")
    for k, v in px.items():
        if v is None or v <= 0 or v != v:
            E(f"price-bad: {t}/{k} = {v}")

# Every referenced ticker reaches target date
for t in sorted(referenced):
    if t not in data:
        E(f"price: missing for referenced ticker {t}"); continue
    last = max(data[t].keys()) if data[t] else None
    if not last or last < TARGET:
        E(f"price-stale: {t} latest is {last}, target {TARGET}")

# No absurd month-over-month jumps (catches wrong-period values like CVNA 2023 prices in a 2025 slot)
for t, px in data.items():
    dates = sorted(px.keys())
    for i in range(1, len(dates)):
        prev, curr = px[dates[i-1]], px[dates[i]]
        if prev <= 0: continue
        r = curr / prev
        if r > 1.5 or r < 0.67:
            E(f"price-jump: {t} {dates[i-1]}={prev} → {dates[i]}={curr} ({r:.2f}×)")

# BRK.A sanity (always > $400k — never confuse with BRK.B)
if "BRK.A" in data:
    for k, v in data["BRK.A"].items():
        if v < 100000: E(f"price-sanity: BRK.A {k}={v} looks like Class B")

if errors:
    print(f"FAIL: {len(errors)} errors")
    for e in errors[:50]: print(" -", e)
    if len(errors) > 50: print(f"  ... +{len(errors)-50} more")
    sys.exit(1)
print(f"OK: {len(referenced)} tickers up to date through {TARGET}")
```

---

## Done condition

1. `python3 /tmp/verify-stocks.py` exits 0 with `OK: …`.
2. `git diff --stat` against snapshot shows mutations only in
   `public/data/prices.json` and `public/data/meta.json` — no other files
   touched.
3. `/tmp/stocks-update-log.txt` summary printed: `(N tickers updated, M new
   tickers added, K failed)`.
