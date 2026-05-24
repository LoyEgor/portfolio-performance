# Goal: Investors Backfill

Refresh the investor base. Two main use cases under one goal:

1. **Quarterly update** (no params) — catch every existing investor up to the
   latest quarter available on DataRoma. This is the regular cadence after
   every 13F deadline.
2. **History expansion** (`--years=N` or `--years=max`) — extend each investor's
   history N years back (or to whatever DataRoma offers, typically 5).

Idempotent: only fetches what's missing unless `--force`.

> **How this file is used.** This is a goal specification consumed by Claude
> Code's `/goal` command (introduced in Claude Code 2.1.139). The harness keeps
> looping turns until the **Done condition** at the bottom of this file is
> satisfied. Don't run this file with plain `claude -p` (single turn) — it
> won't iterate. See `goals/README.md` for the full `/goal` invocation form.

---

## Parameters

| Param | Default | Effect |
|---|---|---|
| `--years=N` | (none) | Ensure each investor's history covers the last N years. |
| `--years=max` | — | Take everything the source has (~5y on DataRoma). |
| `--investors=<id>,<id>,...` | all | Process only this subset. |
| `--force` | off | Re-fetch even if data is already present. |

No params → "advance everyone to the latest available quarter" (most common
case, runs after a 13F deadline).

---

## Hard constraints

- Mutate ONLY:
  - `public/data/investors-index.json`
  - `public/data/investors/*.json`
  - `public/data/meta.json` (to bump `latestQuarter` when the run advances it)
- Do NOT touch `prices.json` — that's `STOCKS-UPDATE.md`'s job. Run it after
  this one to fill new ticker prices.
- Do NOT touch `public/default-data.json`, `public/default-data.backup-*.json`,
  source code, vite config, package.json.
- Save snapshot before first mutation: `tar -cf /tmp/investors-base.pre-backfill.tar public/data/investors-index.json public/data/investors/ public/data/meta.json`.
- Polite pacing: 1-2s between requests to the same domain. Retry 3× on 429/503.
- No git commits, no PRs.

---

## What the goal does

### Phase A — Determine work

1. Read `public/data/meta.json` for `latestQuarter` (e.g. `"2026-Q1"`).
2. Determine the new target quarter from `today` (13F lag: a quarter Q is
   "available" 45 days after Q ends). e.g. `today = 2026-05-19` → newest
   available quarter is `2026-Q1`.
3. Read `public/data/investors-index.json` for the investor list.
4. Build the work plan per investor:
   - If `--investors=` is set, restrict to that list.
   - For each investor: compare existing `history[].asOf` against target window
     (newest available quarter, or N years back if `--years` given).
   - Skip if already complete (no `--force`).

### Activity data (shares) — rolling window

For the `meta.json.activityWindowQuarters` most recent quarters (currently 6),
holdings must include a `shares` field alongside `weight`. This lets the UI
compute real buy/sell activity (`Δshares / prev_shares`) instead of weight
delta — which mixes actual trading with price drift.

Schema for a holding in any snapshot inside the window:

```json
{ "ticker": "AAPL", "weight": 22.91, "shares": 227917808 }
```

Outside the window, `shares` is omitted — that data isn't kept and the UI shows
a `~` marker on its weight-based fallback.

**Source priority for shares (try until something works — don't give up early):**

1. **DataRoma current quarter:** `holdings.php?m=<code>` has a `Shares` column.
2. **DataRoma historic quarter:** check if the page accepts a quarter parameter
   (e.g. `?q=YYYY-QN`); if it does, use it.
3. **Web Archive of DataRoma:** captures of `holdings.php?m=<code>` taken near
   each 13F deadline (15 May / 14 Aug / 14 Nov / 14 Feb). Pick the capture
   closest to deadline+30 days for that quarter.
4. **13F.info:** per-quarter pages list shares (`https://13f.info/manager/...`).
5. **Other priority sources** from README.md: stockzoa, valuesider, GuruFocus,
   WhaleWisdom, HedgeFollow, StockCircle.

For each quarter inside the window, try every source in order until shares is
filled for every position. Log a warning only if all sources failed; never
leave the quarter without an attempt at every source. Weight is fetched from
the primary source as before — only `shares` triggers the multi-source search.

**Cleanup when the window advances:**

When `meta.latestQuarter` is bumped to a new quarter, the oldest quarter that
just fell out of the window must lose its `shares` fields. e.g. when window
moves from `[Q1 2025 … Q1 2026]` to `[Q2 2025 … Q2 2026]`, every holding in
the `2025-03-31` snapshot of every investor file gets `shares` deleted (weight
stays). This keeps disk usage flat over time.

### Phase B — Fetch (paced)

For each investor in the work plan:

1. Determine `primarySource` from `investors-index.json[id].primarySource`.
   The three possible values today:
   - `'dataroma'` — individual manager profile on DataRoma. Fetch URL is
     `https://www.dataroma.com/m/holdings.php?m=<code>` where `<code>` is
     `sourceCodes.dataroma` (e.g. `BRK` for Buffett).
   - `'dataroma-aggregate'` — synthetic aggregate computed from every DataRoma
     guru, not an individual manager. See "Aggregate handling" below.
   - other (`'13f-info'`, `'stockzoa'`, …) — fall back to the source-priority
     chain in `README.md`.
2. Fetch the missing quarters from that source.
3. If primary source fails (404 / network / blocked) → fall back to next source
   in priority order, but **don't change `primarySource` permanently** (one-shot
   fallback to avoid silent drift).
4. Parse holdings:
   - Keep positions with `weight ≥ 1.0%` per the source.
   - Renormalize the kept weights to sum to 100 (mirrors existing convention).
   - Dual-class shares (BRK.A/BRK.B, GOOG/GOOGL, etc.) stay separate — display
     merging is the app's job.
5. Update `investors/<id>.json`:
   - Append new `history` entries (sorted ascending by `asOf`).
   - Replace `holdings` with the newest quarter's data.
   - Bump `_provenance.lastFetchedAt`.
6. Update `investors-index.json[id].historyRange.to` to the new latest quarter.

#### Aggregate handling: `primarySource: "dataroma-aggregate"`

This source represents synthetic portfolios computed from the entire DataRoma
guru pool, not from any one manager's 13F. Current example: `dataroma-top20`.

**Fetch URL:** `https://www.dataroma.com/m/g/portfolio.php`

This page shows the consensus across every guru tracked by DataRoma, sorted by
% of Portfolio (aggregated weight). The `sourceCodes['dataroma-aggregate']`
value (e.g. `'top-20'`) tells the goal how many top rows to keep — `top-20`
means "take the first 20 rows by % of Portfolio."

**Parse and write rules (specific to aggregates):**
- Keep the top N positions per `sourceCodes['dataroma-aggregate']` regardless
  of the ≥1% floor (the floor doesn't apply — these are already consensus picks
  with non-trivial weight).
- Renormalize the kept weights to sum to 100 — same convention as gurus.
- Dual-class shares stay separate (no merging).
- Historical aggregate snapshots are **not** available on DataRoma directly —
  the page only shows current state. To populate `history` for previous
  quarters, the goal should use Web Archive captures of the same URL,
  picked near each 13F deadline (`+0 to +60 days` from the quarter-end):
    - `2026-Q1` (asOf `2026-03-31`) → archive capture between 2026-05-15 and 2026-07-15
    - `2025-Q4` (asOf `2025-12-31`) → archive capture between 2026-02-14 and 2026-04-14
    - etc.
  If a quarter has no archive capture in the window, widen by ±30 days. If
  still missing, skip that snapshot and log it (don't fail the whole run).
- Always write the canonical quarter-end `asOf` (`YYYY-03-31` / `06-30` /
  `09-30` / `12-31`), even if the actual archive capture is from a few weeks
  later — the app's chain-link math uses "closest available price ≤ asOf"
  and the ~1-month offset stays within 5% precision.

### Phase C — Advance `latestQuarter`

If every investor successfully reached the new target quarter (or was already
there) → bump `meta.json.latestQuarter` to the new value.

If some investors didn't reach the new target quarter (e.g. DataRoma hasn't
posted them yet) → do NOT bump `latestQuarter`. Instead, log them and the user
re-runs later.

This guarantees the invariant: **`meta.latestQuarter` == the quarter every
investor in the base has data for**.

---

## Source reconciliation (recap)

- Single primary source per investor (recorded in index).
- Fallback to next priority source only on transient failure (don't switch
  permanently).
- Diff vs prior quarter > 5pp on a position → log warning (might be a real
  rebalance, or might be source flake — user inspects).

---

## Verification script

Write to `/tmp/verify-backfill.py`. Run after the backfill completes.

```python
#!/usr/bin/env python3
"""Strict verify for INVESTORS-BACKFILL.md goal."""
import json, sys, re, os, glob
from datetime import datetime

INDEX = "public/data/investors-index.json"
INVESTORS_GLOB = "public/data/investors/*.json"
META = "public/data/meta.json"

errors = []
def E(m): errors.append(m)

with open(INDEX) as f: index = json.load(f)
with open(META) as f: meta = json.load(f)

# Index ↔ files consistency
index_ids = {inv["id"] for inv in index.get("investors", [])}
file_ids = set()
for path in glob.glob(INVESTORS_GLOB):
    inv_id = os.path.basename(path)[:-5]
    file_ids.add(inv_id)

if index_ids != file_ids:
    E(f"index/files mismatch — in index only: {index_ids - file_ids}; on disk only: {file_ids - index_ids}")

# Every investor file: structure + weights
for path in glob.glob(INVESTORS_GLOB):
    with open(path) as f: inv = json.load(f)
    iid = inv.get("id")
    h = inv.get("holdings", [])
    ws = sum((x.get("weight") or 0) for x in h)
    if h and not (95 <= ws <= 101):
        E(f"{iid}: current weights sum {ws:.2f}")
    asofs = [s.get("asOf") for s in (inv.get("history") or [])]
    if len(set(asofs)) != len(asofs):
        E(f"{iid}: duplicate asOf in history")
    for a in asofs:
        if not re.match(r"^\d{4}-\d{2}-\d{2}$", a or ""):
            E(f"{iid}: bad asOf format {a!r}")
    for s in (inv.get("history") or []):
        sw = sum((x.get("weight") or 0) for x in s.get("holdings", []))
        if not (95 <= sw <= 101):
            E(f"{iid} {s['asOf']}: weights sum {sw:.2f}")
    for x in h:
        if (x.get("weight") or 0) < 0.95:
            E(f"{iid}: holding {x.get('ticker')} weight {x.get('weight')} below 1.0 threshold")

# meta.latestQuarter is a valid quarter-end ISO date
lq = meta.get("latestQuarter")
if not lq or not re.match(r"^\d{4}-(03-31|06-30|09-30|12-31)$", lq):
    E(f"meta.latestQuarter invalid: {lq!r}")

# Every investor's history covers up to latestQuarter (or is intentionally shorter)
for path in glob.glob(INVESTORS_GLOB):
    with open(path) as f: inv = json.load(f)
    asofs = [s.get("asOf") for s in (inv.get("history") or [])]
    if asofs and max(asofs) < lq:
        # Allow if investor was added mid-stream — index should mark them
        idx_entry = next((i for i in index.get("investors", []) if i.get("id") == inv.get("id")), None)
        if not idx_entry or idx_entry.get("historyRange", {}).get("to") != max(asofs):
            E(f"{inv.get('id')}: history.max ({max(asofs)}) < meta.latestQuarter ({lq})")

if errors:
    print(f"FAIL: {len(errors)} errors")
    for e in errors[:50]: print(" -", e)
    sys.exit(1)
print(f"OK: {len(index_ids)} investors, latestQuarter={lq}")
```

---

## Done condition

1. `python3 /tmp/verify-backfill.py` exits 0.
2. `git status -s public/data/` shows changes only in
   `investors-index.json`, `investors/*.json`, and `meta.json`.
3. `/tmp/investors-backfill-log.txt` lists per-investor status (OK / SKIPPED /
   FAILED) and any source-fallback events or >5pp diffs.
4. Print the log path so the user can review.
