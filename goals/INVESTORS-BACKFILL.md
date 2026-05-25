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
> satisfied — it reads the spec each turn and uses that section as the
> completion check, so you don't need to paste it into the command. Run it
> interactively: open `claude --dangerously-skip-permissions`, then type
> `/goal Follow goals/INVESTORS-BACKFILL.md.` (plus any `--params`) inside the
> session. Avoid headless `claude -p` for hand-launched runs; it hides progress
> until the very end. See `goals/README.md` for the command catalog.

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
- Do NOT touch `public/data/prices/*.json` — that's `STOCKS-UPDATE.md`'s job.
  Run it after this one to fill new ticker prices.
- Do NOT touch `public/default-data.json`, `public/default-data.backup-*.json`,
  source code, vite config, package.json.
- Save snapshot before first mutation: `tar -cf /tmp/investors-base.pre-backfill.tar public/data/investors-index.json public/data/investors/ public/data/meta.json`.
- Polite pacing: 1-2s between requests to the same domain. Retry 3× on 429/503.
- **Concurrency:** up to 3 investors in parallel **iff each maps to a different
  primary source** (e.g., one DataRoma + one 13F.info + one Web Archive). All
  same-source work stays serial. See `goals/README.md → Concurrency`.
- **Ticker hygiene** (see `goals/README.md → Ticker hygiene` — non-negotiable):
  - Normalize `BRK-B` → `BRK.B` (DOT separator for dual-class) before writing.
  - Drop tickers matching `-OLD$` / `Q-OLD$` — parser-internal markers, never
    enter the data. Log each drop to `/tmp/investors-backfill-log.txt`.
  - Don't switch established positions between US listing (`BN`, `CP`, `ENB`,
    `BAM`, `FNV`, `IMO`, `NTR`, `OVV`, `WPM`, …) and foreign variants (`.TO`,
    `.L`, `.MX`, `.SW`, `.DE`, `.MI`). If the pre-run file has the US form,
    keep US form when re-fetching.
- No git commits, no PRs.

---

## What the goal does

### Phase A — Determine work

1. Read `public/data/meta.json` for `latestQuarter` (e.g. `"2026-03-31"`).
2. Determine `dataromaLatestQuarter` — the newest quarter actually available on
   DataRoma right now (13F lag: a quarter Q is "available" 45 days after Q ends).
   e.g. `today = 2026-05-19` → newest available is `2026-03-31`.
3. Read `public/data/investors-index.json` for the investor list.
4. Build the work plan per investor:
   - If `--investors=` is set, restrict to that list.
   - For each investor compute `existingLatest = max(history[].asOf)` and the
     "implicit current asOf" (one quarter after `existingLatest`).
   - Compare existing coverage against the target window (newest available
     quarter, or N years back if `--years` given).
   - Skip if already complete (no `--force`).

> **Idempotency guard — DON'T create duplicate quarters.**
>
> A common failure mode is: a previous run already stored Qx as `holdings`
> (current), but a later run reads the file, sees `history.max < Qx`, "pushes"
> the current into history (now Qx in both `history` and as the data behind
> `holdings`), then re-fetches Qx for `holdings` because nothing newer exists
> yet. Result: Qx appears twice — once in `history`, once as the duplicate
> implicit-current. The chart compensates but the data is dirty and
> `verify-backfill.py` will flag it (see "duplicate asOf in history" check
> below — adapted to also catch current==last-history).
>
> **Rule:** before pushing `holdings` to `history`, check whether
> `dataromaLatestQuarter == existingLatest + 1 quarter` AND the current
> `holdings` already matches what a fresh fetch would return. If both hold →
> there is no new data to record; **leave the file unchanged and skip this
> investor**. Only push current → history when a strictly newer quarter is
> actually available.

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

**Shares are NOT optional inside the window. The Goal is not done until every
investor's last `activityWindowQuarters` snapshots have shares filled, OR the
explicit failure log lists why a specific (investor, quarter) pair couldn't be
filled after exhausting every source below.**

A common failure mode in past runs: shares were filled for the first investor
(usually Buffett, who has the cleanest 13F.info match) but skipped for everyone
else. That happens when the goal treats shares as "best effort, move on" instead
of "required, exhaust sources." Don't repeat that. Pseudocode for the inner
loop:

```
for investor in workPlan:
  for quarter in last N (= activityWindowQuarters) snapshots of this investor:
    for source in [dataroma-current, dataroma-historic, web-archive,
                   13f-info, stockzoa, valuesider, gurufocus,
                   whalewisdom, hedgefollow, stockcircle]:
      shares = try_fetch_shares(source, investor, quarter)
      if shares: break
    if not shares:
      append (investor, quarter, "exhausted all sources") to /tmp/shares-failures.txt
    else:
      write shares into the snapshot's holdings
```

**Source priority for shares (try in this order, don't give up before reaching
the bottom):**

1. **DataRoma current quarter:** `holdings.php?m=<code>` has a `Shares` column.
2. **DataRoma historic quarter:** check if the page accepts a quarter parameter
   (e.g. `?q=YYYY-QN`); if it does, use it.
3. **Web Archive of DataRoma:** captures of `holdings.php?m=<code>` taken near
   each 13F deadline (15 May / 14 Aug / 14 Nov / 14 Feb). Pick the capture
   closest to deadline+30 days for that quarter.
4. **13F.info:** per-quarter pages list shares (`https://13f.info/manager/...`).
5. **Other priority sources** from README.md: stockzoa, valuesider, GuruFocus,
   WhaleWisdom, HedgeFollow, StockCircle.

Weight is fetched from the primary source as before — only `shares` triggers
the multi-source search.

The `_provenance.sharesSource` field on each investor file records which source
finally filled shares (the last one tried that returned data). If a different
quarter inside the window used a different source, just record the *most
common* one. Never write `null` here — either shares were filled (record source)
or they weren't (no `sharesSource` field, and the failure goes to the log).

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
   - **Normalize tickers before writing** (see `goals/README.md → Ticker hygiene`):
     ```
     # DOT separator for dual-class
     ticker = re.sub(r'^([A-Z]+)-([A-Z])$', r'\1.\2', ticker)

     # Drop parser-internal markers
     if re.search(r'-OLD$', ticker):
         log_drop(investor, quarter, ticker); continue

     # Preserve established US listing — don't switch to .TO/.L/.MX/etc.
     existing_ticker_for_position = lookup_by_company_in_prior_holdings(...)
     if existing_ticker_for_position and ticker != existing_ticker_for_position:
         if (existing has no dot suffix) and (ticker has .TO/.L/.MX/.SW/.DE/.MI):
             ticker = existing_ticker_for_position  # keep US form
     ```
   - Log each ticker drop and each US-preservation override to
     `/tmp/investors-backfill-log.txt`.
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

### Phase C — Update `meta.json` (REQUIRED, not optional)

When all work in Phase B is done, `meta.json` MUST be rewritten with:

1. **`lastBackfillAt`** = ISO timestamp of the moment this run finished
   (e.g. `"2026-05-24T00:51:29Z"`). Always set — this is the one timestamp
   that lets the user/UI tell when the base was last refreshed. Never leave
   `null` after a successful Phase B.

2. **`latestQuarter`** = newest quarter every investor in the base now covers,
   following this rule:
   - If every investor in the work plan reached the new target quarter (or was
     already there) → bump to the new value.
   - If some didn't (e.g. DataRoma hasn't posted their 13F yet) → do NOT bump.
     Log the holdouts to `/tmp/investors-backfill-log.txt` and leave
     `latestQuarter` at the previous value.

   This preserves the invariant: **`meta.latestQuarter` == the quarter every
   investor in the base has data for**.

3. **`oldestHistoryAsOf`** = `min(asOf)` across every snapshot in every
   investor file (`history[].asOf` union, restricted to investors whose
   primarySource is NOT `dataroma-aggregate`). Recompute and write
   unconditionally after Phase B — even on a no-op run, this guarantees
   meta and disk stay in sync. The field is the contract that `INVESTORS-ADD`
   reads to default-match base depth.

4. Leave other meta fields untouched (`version`, `activityWindowQuarters`,
   `generatedBy`, `generatedAt`).

Failing to update `meta.lastBackfillAt` is treated as goal-not-done by the
verify script (`/tmp/verify-backfill.py` checks for non-null
`lastBackfillAt`).

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

# Every investor file: structure + weights + ticker hygiene
DASH_DUAL = re.compile(r"^[A-Z]+-[A-Z]$")     # BRK-B style — should be BRK.B
OLD_MARKER = re.compile(r"-OLD$")             # parser-internal leak

def check_holdings(iid, tag, holdings):
    for x in holdings:
        t = x.get("ticker") or ""
        if DASH_DUAL.match(t):
            E(f"{iid} {tag}: dash-separator dual-class {t!r} — must be DOT (see ticker hygiene)")
        if OLD_MARKER.search(t):
            E(f"{iid} {tag}: leaked -OLD parser marker {t!r}")

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
        check_holdings(iid, s["asOf"], s.get("holdings", []))
    check_holdings(iid, "current", h)
    for x in h:
        if (x.get("weight") or 0) < 0.95:
            E(f"{iid}: holding {x.get('ticker')} weight {x.get('weight')} below 1.0 threshold")

# meta.latestQuarter is a valid quarter-end ISO date
lq = meta.get("latestQuarter")
if not lq or not re.match(r"^\d{4}-(03-31|06-30|09-30|12-31)$", lq):
    E(f"meta.latestQuarter invalid: {lq!r}")

# meta.lastBackfillAt MUST be set after a successful run (Phase C)
if not meta.get("lastBackfillAt"):
    E("meta.lastBackfillAt is null — Phase C didn't record the run timestamp")

# meta.oldestHistoryAsOf must match min(asOf) across all non-aggregate investors
non_agg_asofs = []
for path in glob.glob(INVESTORS_GLOB):
    iid = os.path.basename(path)[:-5]
    idx_entry = next((i for i in index["investors"] if i.get("id") == iid), {})
    if (idx_entry.get("primarySource") or "").startswith("dataroma-aggregate"):
        continue
    with open(path) as f: inv = json.load(f)
    for s in (inv.get("history") or []):
        if s.get("asOf"): non_agg_asofs.append(s["asOf"])
if non_agg_asofs:
    actual_oldest = min(non_agg_asofs)
    declared = meta.get("oldestHistoryAsOf")
    if declared != actual_oldest:
        E(f"meta.oldestHistoryAsOf={declared!r} doesn't match disk min={actual_oldest!r} — Phase C step 3 drifted")

# Every investor's history covers up to latestQuarter (or is intentionally shorter)
window_n = meta.get("activityWindowQuarters", 6)
for path in glob.glob(INVESTORS_GLOB):
    with open(path) as f: inv = json.load(f)
    iid = inv.get("id")
    asofs = sorted([s.get("asOf") for s in (inv.get("history") or [])])
    if asofs and max(asofs) < lq:
        # Allow if investor was added mid-stream — index should mark them
        idx_entry = next((i for i in index.get("investors", []) if i.get("id") == iid), None)
        if not idx_entry or idx_entry.get("historyRange", {}).get("to") != max(asofs):
            E(f"{iid}: history.max ({max(asofs)}) < meta.latestQuarter ({lq})")

    # No duplicate between last history snapshot and current holdings (the
    # idempotency-bug failure mode — same data ends up in both places).
    if (inv.get("history") and inv.get("holdings")):
        last_snap = sorted(inv["history"], key=lambda s: s["asOf"])[-1]
        # Build a comparable signature: ticker → weight, ticker → shares.
        def sig(holdings):
            return tuple(sorted((h.get("ticker"), h.get("weight"), h.get("shares"))
                                for h in holdings))
        if sig(last_snap["holdings"]) == sig(inv["holdings"]):
            E(f"{iid}: current holdings duplicate last history snapshot ({last_snap['asOf']}) — "
              f"either skip the push or fetch a strictly newer quarter")

    # Shares must be filled inside the activity window — for aggregates
    # (primarySource = 'dataroma-aggregate') shares aren't applicable, skip.
    idx_entry = next((i for i in index.get("investors", []) if i.get("id") == iid), None)
    primary = (idx_entry or {}).get("primarySource") or ""
    if primary.startswith("dataroma-aggregate"):
        continue
    # Window = last N history snapshots + current.
    # If history is shorter than N, the window is just whatever exists.
    last_window = (inv.get("history") or [])[-window_n + 1:]  # +1 because current counts
    for snap in last_window:
        missing = [h["ticker"] for h in snap["holdings"] if "shares" not in h]
        if missing:
            E(f"{iid} {snap['asOf']}: missing shares for {len(missing)} holding(s): {missing[:3]}")
    current_missing = [h["ticker"] for h in (inv.get("holdings") or []) if "shares" not in h]
    if current_missing:
        E(f"{iid} current: missing shares for {len(current_missing)} holding(s): {current_missing[:3]}")

if errors:
    print(f"FAIL: {len(errors)} errors")
    for e in errors[:50]: print(" -", e)
    sys.exit(1)
print(f"OK: {len(index_ids)} investors, latestQuarter={lq}")
```

---

## Done condition

1. `python3 /tmp/verify-backfill.py` exits 0. This checks **all** of:
   - Index ↔ files consistency
   - Weight sums 99-101 per snapshot
   - No duplicate `asOf` in history
   - No duplicate between last history snapshot and current holdings
     (the idempotency-bug catch)
   - `meta.latestQuarter` set + valid quarter-end
   - **`meta.lastBackfillAt` is non-null** (Phase C ran)
   - Every investor's last `activityWindowQuarters` snapshots have `shares`
     filled on every holding (except `dataroma-aggregate` investors, where
     shares aren't applicable)
   - **Ticker hygiene**: no `BRK-B`-style dash-separator dual-class tickers,
     no `-OLD` parser markers anywhere in `holdings[]` or `history[].holdings[]`
   - **`meta.oldestHistoryAsOf` matches disk**: equal to `min(asOf)` across all
     non-aggregate investors. Phase C step 3 must keep this in sync.
2. `git status -s public/data/` shows changes only in `investors-index.json`,
   `investors/*.json`, and `meta.json`. (No `src/`, no `public/default-data.*`.)
3. `/tmp/investors-backfill-log.txt` lists per-investor status (OK / SKIPPED /
   FAILED) and any source-fallback events or >5pp diffs.
4. `/tmp/shares-failures.txt` exists (may be empty). Every (investor, quarter)
   pair where shares couldn't be filled after exhausting all sources is logged
   here with a reason. **Empty file = ideal; populated file = the goal still
   completed but you should review which gaps are acceptable.**
5. Print all log paths so the user can review.
