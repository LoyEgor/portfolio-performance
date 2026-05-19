# Goal: Stocks Update

Refresh **prices only** for tickers already in the system. Run between
quarters when there's no new 13F to process but stock prices have moved.

Holdings, history, and weights are **not** touched. For quarterly portfolio
refreshes, use `PORTFOLIO-UPDATE.md`.

---

## When to run

Whenever the latest price keys lag behind the most-recently-completed calendar
month. On any `today`:

- Target date: first-of-month of the prior calendar month relative to `today`.
  Examples:
  - `2026-05-19` → target `2026-05-01` (May is in progress, May 1 close is known)
  - `2026-06-03` → target `2026-06-01`
  - `2026-12-31` → target `2026-12-01`
- If for any referenced ticker `max(price_keys) < target` → there's work to do.

---

## Hard constraints

- Mutate **only the `prices` block** of `public/default-data.json`. The
  `portfolios` array stays byte-identical to the pre-update snapshot.
- **Do NOT touch** `public/default-data.backup-1.json`, `backup-2.json`,
  `backup-3.json`. They are app-managed snapshots.
- **MANDATORY first step: copy current `public/default-data.json` to
  `/tmp/default-data.pre-stocks-update.json` BEFORE making any change.**
  The verify script reads this file to detect forbidden mutations. If you
  forget this step, verify will FAIL.
- The entire `data.portfolios` array — every field of every portfolio
  including `color`, `name`, `subtitle`, `visible`, `locked`, `holdings`,
  `history`, AND the array order — must be **byte-identical** to the snapshot.
  Even reordering counts as a violation.
- **Do NOT change** `src/portfolio_tracker.jsx` or any other source file.
- No git commits, no PRs.

---

## What to do

**Step 0 — mandatory, before any mutation:**

```bash
cp public/default-data.json /tmp/default-data.pre-stocks-update.json
```

The verify script reads this file to confirm that `data.portfolios` is
byte-identical after the run. If you skip this step, verify will fail with
"snapshot does not exist" and you cannot pass the done condition.

**Step 1 — update prices.** For each `T in data["prices"]`:

1. Compute target as defined above (first-of-month of the prior calendar month).
2. If `max(data["prices"][T].keys()) >= target` → already up to date, skip.
3. Otherwise, fetch monthly history from:
   - Primary: `https://stockanalysis.com/stocks/<lower>/history/`
     (or `/etf/<lower>/history/` for ETFs)
   - Use the "Monthly" view and Adjusted Close.
4. Append all missing months between the current `max(price_keys) + 1 month`
   and `target` (inclusive) into `data["prices"][T]`. Keys are strictly
   `YYYY-MM-01`.
   - If source returns end-of-month (e.g. `2026-04-30`) → map to next-month-01
     (`2026-05-01`).
   - If source returns arbitrary mid-month → map to same-month-01.
   - If two source rows map to the same `YYYY-MM-01`, keep the value from the
     first trading day of that month.

**Ticker quirks** (same as in PORTFOLIO-UPDATE.md):

| Ticker      | Notes                                                          |
|-------------|----------------------------------------------------------------|
| `BRK.A`     | Class A trades at ~$700k. Do NOT use BRK.B's $500 here.        |
| `REMEDY.HE` | Helsinki — try `stockanalysis.com/quote/hel/REMEDY/`           |
| `SGOV`      | iShares 0-3 Month Treasury ETF                                 |
| ADRs        | Use US-listed ADR price for `SONY, ASML, DEO, TSM, PDD`, etc.  |

**Stock splits:** stockanalysis.com Adjusted Close handles this automatically.
If you see a >50% gap between adjacent months in the existing data, that's a
real split or a wrong value — investigate (don't paper over by smoothing).

---

## Verification

Write to `/tmp/verify_stocks.py`, run, must exit 0.

```python
#!/usr/bin/env python3
"""Verify a Stocks Update run."""
import json, sys, re, os
from datetime import datetime, timedelta

DATA = "public/default-data.json"
SNAPSHOT = "/tmp/default-data.pre-stocks-update.json"

def target_date():
    t = datetime.fromisoformat("__TODAY__")  # substituted by Goal
    first_of_this_month = t.replace(day=1)
    prev = first_of_this_month - timedelta(days=1)
    return f"{prev.year}-{prev.month:02d}-01"
TARGET = target_date()

errors = []
def E(m): errors.append(m)

with open(DATA) as f: data = json.load(f)

# ----- MANDATORY: pre-update snapshot must exist -----
if not os.path.exists(SNAPSHOT):
    print(f"FAIL: snapshot {SNAPSHOT} does not exist. Goal must copy public/default-data.json "
          f"to this path BEFORE making any change.")
    sys.exit(1)
with open(SNAPSHOT) as f: snap = json.load(f)

# ----- portfolios block must be byte-identical (every field, every order) -----
cur_portfolios_json = json.dumps(data["portfolios"], sort_keys=False)
snap_portfolios_json = json.dumps(snap["portfolios"], sort_keys=False)
if cur_portfolios_json != snap_portfolios_json:
    # Find which portfolio(s) differ to give a useful error
    cur_by_id = {p["id"]: p for p in data["portfolios"]}
    snap_by_id = {p["id"]: p for p in snap["portfolios"]}
    cur_ids = [p["id"] for p in data["portfolios"]]
    snap_ids = [p["id"] for p in snap["portfolios"]]
    if cur_ids != snap_ids:
        E(f"portfolios: order/set changed: snap={snap_ids} cur={cur_ids}")
    for pid in set(cur_ids) & set(snap_ids):
        cj = json.dumps(cur_by_id[pid], sort_keys=True)
        sj = json.dumps(snap_by_id[pid], sort_keys=True)
        if cj != sj:
            # Find which field
            for fld in set(cur_by_id[pid].keys()) | set(snap_by_id[pid].keys()):
                if cur_by_id[pid].get(fld) != snap_by_id[pid].get(fld):
                    E(f"portfolios: {pid}.{fld} changed (this Goal must not touch portfolios)")

# Referenced tickers from portfolios (we don't expand here, just enumerate)
referenced = set()
for p in data["portfolios"]:
    for h in p["holdings"]: referenced.add(h["ticker"].upper())
    for s in p.get("history", []):
        for h in s["holdings"]: referenced.add(h["ticker"].upper())

# ----- All keys must be YYYY-MM-01 -----
for t, px in data["prices"].items():
    bad = [k for k in px if not re.match(r"^\d{4}-\d{2}-01$", k)]
    if bad: E(f"price-key: {t} has non-monthly keys: {bad[:3]}")
    if not px: E(f"price: {t} empty"); continue
    for k, v in px.items():
        if v is None or v <= 0 or v != v:
            E(f"price-bad: {t}/{k} = {v}")

# ----- Every referenced ticker reaches target date -----
for t in sorted(referenced):
    if t not in data["prices"]:
        E(f"price: missing for referenced ticker {t}"); continue
    last = max(data["prices"][t].keys())
    if last < TARGET:
        E(f"price-stale: {t} latest is {last}, target {TARGET}")

# ----- No absurd month-over-month jumps -----
for t, px in data["prices"].items():
    dates = sorted(px.keys())
    for i in range(1, len(dates)):
        prev, curr = px[dates[i-1]], px[dates[i]]
        if prev <= 0: continue
        r = curr / prev
        if r > 1.5 or r < 0.67:
            E(f"price-jump: {t} {dates[i-1]}={prev} → {dates[i]}={curr} ({r:.2f}×)")

# ----- BRK.A sanity (Class A always > $400k) -----
if "BRK.A" in data["prices"]:
    for k, v in data["prices"]["BRK.A"].items():
        if v < 100000: E(f"price-sanity: BRK.A {k}={v} looks like Class B")

# ----- Portfolios block must be unchanged structurally (no new keys / drops) -----
# Compare against /tmp/default-data.pre-stocks-update.json if Goal saved one;
# otherwise skip this check.

if errors:
    print(f"FAIL: {len(errors)} errors")
    for e in errors[:50]: print(" -", e)
    if len(errors) > 50: print(f"  ... +{len(errors)-50} more")
    sys.exit(1)
print(f"OK: {len(referenced)} tickers up to date through {TARGET}")
```

---

## Done condition

1. `python3 /tmp/verify_stocks.py` exits 0 with `OK: <N> tickers up to date…`
2. `npm run dev` + `curl http://localhost:5173` returns 200 (smoke test that
   dev server still boots; this Goal didn't touch source code so it should).
3. Optional: diff `data.portfolios` against `/tmp/default-data.pre-stocks-update.json`
   if you wrote one — they must be byte-equal.

Print a short summary (count of tickers updated, target date) and exit.

---

## What NOT to do

- Do not touch `default-data.backup-*.json`.
- Do not touch any field of `data.portfolios` — not `holdings`, not `history`,
  not `color`, not `subtitle`, not `name`, not `visible`, not `locked`. This
  Goal is prices-only.
- Do not change the order of portfolios in the `portfolios[]` array.
- Do not add or remove portfolios.
- Do not edit `src/portfolio_tracker.jsx` or any other source file.
- Do not store daily prices. Only `YYYY-MM-01`, one per month.
- Do not relax verify tolerances.
- Do not commit / open PRs.
